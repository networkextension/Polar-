package dock

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const (
	systemUserID    = "system"
	systemUsername  = "system"
	systemUserEmail = "system@local.polar"
)

type aiAgent struct {
	server       *Server
	apiKey       string
	baseURL      string
	model        string
	systemPrompt string
	tasks        chan aiAgentTask
	stopCh       chan struct{}
	stopOnce     sync.Once
	httpClient   *http.Client
}

type aiAgentTask struct {
	ThreadID        int64
	LLMThreadID     *int64
	UserID          string
	ResponderUserID string
	ResponderName   string
	Content         string
}

type aiRuntimeConfig struct {
	APIKey       string
	BaseURL      string
	Model        string
	SystemPrompt string
}

type aiChatCompletionRequest struct {
	Model    string                    `json:"model"`
	Messages []aiChatCompletionMessage `json:"messages"`
}

type aiChatCompletionMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type aiChatCompletionResponse struct {
	Choices []struct {
		Message aiChatCompletionMessage `json:"message"`
	} `json:"choices"`
	Error json.RawMessage `json:"error,omitempty"`
}

type aiProvider string

const (
	aiProviderOpenAICompatible aiProvider = "openai_compatible"
	aiProviderGemini           aiProvider = "gemini"
	aiProviderXAIResponses     aiProvider = "xai_responses"
	aiProviderAnthropic        aiProvider = "anthropic_messages"
)

type geminiGenerateContentRequest struct {
	SystemInstruction *geminiContent  `json:"systemInstruction,omitempty"`
	Contents          []geminiContent `json:"contents"`
}

type geminiGenerateContentResponse struct {
	Candidates []struct {
		Content geminiContent `json:"content"`
	} `json:"candidates"`
	Error json.RawMessage `json:"error,omitempty"`
}

type geminiContent struct {
	Role  string       `json:"role,omitempty"`
	Parts []geminiPart `json:"parts"`
}

type geminiPart struct {
	Text string `json:"text,omitempty"`
}

type xAIResponsesRequest struct {
	Model string                 `json:"model"`
	Input []xAIResponsesMessage  `json:"input"`
	Tools []xAIResponsesToolSpec `json:"tools,omitempty"`
}

type xAIResponsesMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type xAIResponsesToolSpec struct {
	Type string `json:"type"`
}

type xAIResponsesResponse struct {
	OutputText string               `json:"output_text,omitempty"`
	Output     []xAIResponsesOutput `json:"output,omitempty"`
	Error      json.RawMessage      `json:"error,omitempty"`
}

type xAIResponsesOutput struct {
	Type    string                      `json:"type,omitempty"`
	Text    string                      `json:"text,omitempty"`
	Content []xAIResponsesOutputContent `json:"content,omitempty"`
}

type xAIResponsesOutputContent struct {
	Type string `json:"type,omitempty"`
	Text string `json:"text,omitempty"`
}

type anthropicMessagesRequest struct {
	Model     string                     `json:"model"`
	System    string                     `json:"system,omitempty"`
	Messages  []anthropicMessagesMessage `json:"messages"`
	MaxTokens int                        `json:"max_tokens"`
}

type anthropicMessagesMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type anthropicMessagesResponse struct {
	Content []anthropicMessagesContent `json:"content,omitempty"`
	Error   json.RawMessage            `json:"error,omitempty"`
}

type anthropicMessagesContent struct {
	Type string `json:"type,omitempty"`
	Text string `json:"text,omitempty"`
}

func newAIAgent(server *Server, cfg Config) *aiAgent {
	if server == nil {
		return nil
	}
	return &aiAgent{
		server:       server,
		apiKey:       strings.TrimSpace(cfg.AIAgentAPIKey),
		baseURL:      strings.TrimSpace(cfg.AIAgentBaseURL),
		model:        strings.TrimSpace(cfg.AIAgentModel),
		systemPrompt: strings.TrimSpace(cfg.AIAgentSystemPrompt),
		tasks:        make(chan aiAgentTask, 64),
		stopCh:       make(chan struct{}),
		httpClient: &http.Client{
			Timeout: 90 * time.Second,
		},
	}
}

func (a *aiAgent) stop() {
	if a == nil {
		return
	}
	a.stopOnce.Do(func() {
		close(a.stopCh)
	})
}

func (a *aiAgent) enqueue(task aiAgentTask) {
	if a == nil || task.ThreadID <= 0 || task.UserID == "" || task.ResponderUserID == "" || strings.TrimSpace(task.Content) == "" {
		return
	}
	select {
	case a.tasks <- task:
	default:
		log.Printf("ai agent queue full, dropping task for thread %d", task.ThreadID)
	}
}

func (a *aiAgent) run() {
	if a == nil {
		return
	}
	for {
		select {
		case <-a.stopCh:
			return
		case task := <-a.tasks:
			a.handleTask(task)
		}
	}
}

func (a *aiAgent) handleTask(task aiAgentTask) {
	reply, err := a.generateReply(task)
	if err != nil {
		log.Printf("ai agent reply failed: %v", err)
		reply = "我暂时无法完成这次处理，请稍后再试。"
		if _, sendErr := a.server.sendFailedBotMessage(task.ThreadID, task.LLMThreadID, task.ResponderUserID, task.ResponderName, reply, time.Now()); sendErr != nil {
			log.Printf("send failed ai agent chat message failed: %v", sendErr)
		}
		return
	}
	reply = strings.TrimSpace(reply)
	if reply == "" {
		reply = "我暂时没有可返回的结果。"
	}
	now := time.Now()
	title := buildSystemMarkdownTitle(reply, now)
	entry, _, err := a.server.saveMarkdownDocument(task.ResponderUserID, title, reply, false, now)
	if err != nil {
		log.Printf("save ai markdown failed: %v", err)
		if _, sendErr := a.server.sendChatMessage(task.ThreadID, task.LLMThreadID, task.ResponderUserID, task.ResponderName, reply, now); sendErr != nil {
			log.Printf("send fallback ai agent chat message failed: %v", sendErr)
		}
		return
	}
	if _, err := a.server.sendSharedMarkdownMessage(task.ThreadID, task.LLMThreadID, task.ResponderUserID, task.ResponderName, entry.ID, entry.Title, buildMarkdownPreview(reply, 120), now); err != nil {
		log.Printf("send ai shared markdown message failed: %v", err)
	}
}

func (a *aiAgent) generateReply(task aiAgentTask) (string, error) {
	runtimeConfig, err := a.runtimeConfig(task.ThreadID, task.LLMThreadID, task.ResponderUserID)
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(runtimeConfig.APIKey) == "" || strings.TrimSpace(runtimeConfig.BaseURL) == "" || strings.TrimSpace(runtimeConfig.Model) == "" {
		if task.ResponderUserID == systemUserID {
			return "AI 助理尚未配置完成，请联系管理员设置 `AI_AGENT_API_KEY`、`AI_AGENT_BASE_URL` 和 `AI_AGENT_MODEL`。", nil
		}
		return "这个 Bot 的模型配置还没准备好，请先补全 API Key、Base URL 和 Model。", nil
	}

	contextText, err := a.buildContext(task.ThreadID, task.LLMThreadID)
	if err != nil {
		log.Printf("build ai context failed: %v", err)
	}

	payload := aiChatCompletionRequest{
		Model: runtimeConfig.Model,
		Messages: []aiChatCompletionMessage{
			{
				Role:    "system",
				Content: runtimeConfig.SystemPrompt,
			},
			{
				Role:    "system",
				Content: contextText,
			},
			{
				Role:    "user",
				Content: task.Content,
			},
		},
	}

	result, err := a.requestChatCompletion(runtimeConfig, payload)
	if err != nil {
		return "", err
	}
	if len(result.Choices) == 0 {
		return "", errors.New("empty ai response")
	}
	return strings.TrimSpace(result.Choices[0].Message.Content), nil
}

func (a *aiAgent) testRuntimeConfig(runtimeConfig aiRuntimeConfig) error {
	if strings.TrimSpace(runtimeConfig.APIKey) == "" || strings.TrimSpace(runtimeConfig.BaseURL) == "" || strings.TrimSpace(runtimeConfig.Model) == "" {
		return errors.New("API Key、Base URL 和 Model 不能为空")
	}
	if strings.TrimSpace(runtimeConfig.SystemPrompt) == "" {
		runtimeConfig.SystemPrompt = "你是一个用于连通性验证的 AI 助手，请简短回复 ok。"
	}

	payload := aiChatCompletionRequest{
		Model: runtimeConfig.Model,
		Messages: []aiChatCompletionMessage{
			{Role: "system", Content: runtimeConfig.SystemPrompt},
			{Role: "user", Content: "请回复 ok"},
		},
	}
	result, err := a.requestChatCompletion(runtimeConfig, payload)
	if err != nil {
		return err
	}
	if len(result.Choices) == 0 || strings.TrimSpace(result.Choices[0].Message.Content) == "" {
		return errors.New("模型已连通，但返回为空")
	}
	return nil
}

func (a *aiAgent) requestChatCompletion(runtimeConfig aiRuntimeConfig, payload aiChatCompletionRequest) (*aiChatCompletionResponse, error) {
	switch detectAIProvider(runtimeConfig.BaseURL) {
	case aiProviderAnthropic:
		return a.requestAnthropicMessages(runtimeConfig, payload)
	case aiProviderGemini:
		return a.requestGeminiContent(runtimeConfig, payload)
	case aiProviderXAIResponses:
		return a.requestXAIResponses(runtimeConfig, payload)
	default:
		return a.requestOpenAICompatibleChatCompletion(runtimeConfig, payload)
	}
}

func (a *aiAgent) requestOpenAICompatibleChatCompletion(runtimeConfig aiRuntimeConfig, payload aiChatCompletionRequest) (*aiChatCompletionResponse, error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	log.Printf("ai agent request: url=%s model=%s payload=%s", runtimeConfig.BaseURL, runtimeConfig.Model, compactLogJSON(body))

	req, err := http.NewRequest(http.MethodPost, runtimeConfig.BaseURL, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+runtimeConfig.APIKey)

	resp, err := a.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	log.Printf("ai agent response: status=%d body=%s", resp.StatusCode, compactLogJSON(responseBody))

	var result aiChatCompletionResponse
	if err := json.Unmarshal(responseBody, &result); err != nil {
		return nil, err
	}
	if resp.StatusCode >= 400 {
		if message := parseAIErrorMessage(result.Error); message != "" {
			return nil, errors.New(message)
		}
		return nil, fmt.Errorf("ai api returned status %d: %s", resp.StatusCode, strings.TrimSpace(string(responseBody)))
	}
	if len(result.Choices) == 0 {
		// Some OpenAI-compatible gateways (e.g. api.soxai.io) proxy Claude and
		// return Anthropic-native {"content":[{"type":"text","text":"..."}]}
		// instead of {"choices":[{"message":{...}}]}. Fall back to parsing
		// that shape so callers get a usable response.
		var anthropicResult anthropicMessagesResponse
		if err := json.Unmarshal(responseBody, &anthropicResult); err == nil {
			if text := extractAnthropicResponseText(anthropicResult); text != "" {
				return &aiChatCompletionResponse{
					Choices: []struct {
						Message aiChatCompletionMessage `json:"message"`
					}{
						{Message: aiChatCompletionMessage{Role: "assistant", Content: text}},
					},
				}, nil
			}
		}
	}
	return &result, nil
}

func (a *aiAgent) requestGeminiContent(runtimeConfig aiRuntimeConfig, payload aiChatCompletionRequest) (*aiChatCompletionResponse, error) {
	reqURL, err := buildGeminiRequestURL(runtimeConfig.BaseURL, runtimeConfig.Model, runtimeConfig.APIKey)
	if err != nil {
		return nil, err
	}

	bodyPayload := convertToGeminiRequest(payload)
	body, err := json.Marshal(bodyPayload)
	if err != nil {
		return nil, err
	}
	log.Printf("ai agent request: provider=gemini url=%s model=%s payload=%s", reqURL, runtimeConfig.Model, compactLogJSON(body))

	req, err := http.NewRequest(http.MethodPost, reqURL, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := a.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	log.Printf("ai agent response: provider=gemini status=%d body=%s", resp.StatusCode, compactLogJSON(responseBody))

	var result geminiGenerateContentResponse
	if err := json.Unmarshal(responseBody, &result); err != nil {
		return nil, err
	}
	if resp.StatusCode >= 400 {
		if message := parseAIErrorMessage(result.Error); message != "" {
			return nil, errors.New(message)
		}
		return nil, fmt.Errorf("gemini api returned status %d: %s", resp.StatusCode, strings.TrimSpace(string(responseBody)))
	}

	text := extractGeminiResponseText(result)
	return &aiChatCompletionResponse{
		Choices: []struct {
			Message aiChatCompletionMessage `json:"message"`
		}{
			{
				Message: aiChatCompletionMessage{
					Role:    "assistant",
					Content: text,
				},
			},
		},
	}, nil
}

func (a *aiAgent) requestXAIResponses(runtimeConfig aiRuntimeConfig, payload aiChatCompletionRequest) (*aiChatCompletionResponse, error) {
	reqURL, err := buildXAIResponsesRequestURL(runtimeConfig.BaseURL)
	if err != nil {
		return nil, err
	}

	bodyPayload := convertToXAIResponsesRequest(payload)
	body, err := json.Marshal(bodyPayload)
	if err != nil {
		return nil, err
	}
	log.Printf("ai agent request: provider=xai url=%s model=%s payload=%s", reqURL, runtimeConfig.Model, compactLogJSON(body))

	req, err := http.NewRequest(http.MethodPost, reqURL, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+runtimeConfig.APIKey)

	resp, err := a.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	log.Printf("ai agent response: provider=xai status=%d body=%s", resp.StatusCode, compactLogJSON(responseBody))

	var result xAIResponsesResponse
	if err := json.Unmarshal(responseBody, &result); err != nil {
		return nil, err
	}
	if resp.StatusCode >= 400 {
		if message := parseAIErrorMessage(result.Error); message != "" {
			return nil, errors.New(message)
		}
		return nil, fmt.Errorf("xai api returned status %d: %s", resp.StatusCode, strings.TrimSpace(string(responseBody)))
	}

	text := extractXAIResponseText(result)
	return &aiChatCompletionResponse{
		Choices: []struct {
			Message aiChatCompletionMessage `json:"message"`
		}{
			{
				Message: aiChatCompletionMessage{
					Role:    "assistant",
					Content: text,
				},
			},
		},
	}, nil
}

func (a *aiAgent) requestAnthropicMessages(runtimeConfig aiRuntimeConfig, payload aiChatCompletionRequest) (*aiChatCompletionResponse, error) {
	reqURL, err := buildAnthropicMessagesRequestURL(runtimeConfig.BaseURL)
	if err != nil {
		return nil, err
	}

	bodyPayload := convertToAnthropicMessagesRequest(payload)
	body, err := json.Marshal(bodyPayload)
	if err != nil {
		return nil, err
	}
	log.Printf("ai agent request: provider=anthropic url=%s model=%s payload=%s", reqURL, runtimeConfig.Model, compactLogJSON(body))

	req, err := http.NewRequest(http.MethodPost, reqURL, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-api-key", runtimeConfig.APIKey)
	req.Header.Set("anthropic-version", "2023-06-01")

	resp, err := a.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	log.Printf("ai agent response: provider=anthropic status=%d body=%s", resp.StatusCode, compactLogJSON(responseBody))

	var result anthropicMessagesResponse
	if err := json.Unmarshal(responseBody, &result); err != nil {
		return nil, err
	}
	if resp.StatusCode >= 400 {
		if message := parseAIErrorMessage(result.Error); message != "" {
			return nil, errors.New(message)
		}
		return nil, fmt.Errorf("anthropic api returned status %d: %s", resp.StatusCode, strings.TrimSpace(string(responseBody)))
	}

	text := extractAnthropicResponseText(result)
	return &aiChatCompletionResponse{
		Choices: []struct {
			Message aiChatCompletionMessage `json:"message"`
		}{
			{
				Message: aiChatCompletionMessage{
					Role:    "assistant",
					Content: text,
				},
			},
		},
	}, nil
}

func (a *aiAgent) runtimeConfig(threadID int64, llmThreadID *int64, responderUserID string) (aiRuntimeConfig, error) {
	if responderUserID == systemUserID {
		return aiRuntimeConfig{
			APIKey:       strings.TrimSpace(a.apiKey),
			BaseURL:      strings.TrimSpace(a.baseURL),
			Model:        strings.TrimSpace(a.model),
			SystemPrompt: strings.TrimSpace(a.systemPrompt),
		}, nil
	}

	botUser, err := a.server.getBotUserByUserID(responderUserID)
	if err != nil {
		return aiRuntimeConfig{}, err
	}
	if botUser == nil {
		return aiRuntimeConfig{}, fmt.Errorf("bot config not found for %s", responderUserID)
	}

	var (
		item   *LLMConfig
		apiKey string
	)
	if llmThreadID != nil && *llmThreadID > 0 {
		item, apiKey, err = a.server.getLLMConfigForThread(threadID, *llmThreadID, responderUserID)
		if err != nil {
			return aiRuntimeConfig{}, err
		}
		if item == nil {
			return aiRuntimeConfig{}, fmt.Errorf("thread llm config not found for thread %d responder %s", *llmThreadID, responderUserID)
		}
	}
	if item == nil {
		item, apiKey, err = a.server.getLLMConfigForBot(responderUserID)
	}
	if err != nil {
		return aiRuntimeConfig{}, err
	}
	if item == nil {
		return aiRuntimeConfig{}, fmt.Errorf("bot llm config not found for %s", responderUserID)
	}
	systemPrompt := strings.TrimSpace(botUser.SystemPrompt)
	if systemPrompt == "" {
		systemPrompt = "你是站内的 AI 助手，请基于上下文和当前问题，用清晰、可靠、结构化的中文回复。"
	}
	return aiRuntimeConfig{
		APIKey:       strings.TrimSpace(apiKey),
		BaseURL:      strings.TrimSpace(item.BaseURL),
		Model:        strings.TrimSpace(item.Model),
		SystemPrompt: systemPrompt,
	}, nil
}

func compactLogJSON(body []byte) string {
	text := strings.TrimSpace(string(body))
	if text == "" {
		return ""
	}

	var decoded any
	if err := json.Unmarshal(body, &decoded); err == nil {
		if normalized, err := json.Marshal(decoded); err == nil {
			text = string(normalized)
		}
	}

	const maxLogBytes = 4000
	if len(text) > maxLogBytes {
		return text[:maxLogBytes] + "...(truncated)"
	}
	return text
}

func parseAIErrorMessage(raw json.RawMessage) string {
	if len(raw) == 0 || string(raw) == "null" {
		return ""
	}

	var asString string
	if err := json.Unmarshal(raw, &asString); err == nil {
		return strings.TrimSpace(asString)
	}

	var asObject struct {
		Message string `json:"message"`
		Error   string `json:"error"`
	}
	if err := json.Unmarshal(raw, &asObject); err == nil {
		if strings.TrimSpace(asObject.Message) != "" {
			return strings.TrimSpace(asObject.Message)
		}
		if strings.TrimSpace(asObject.Error) != "" {
			return strings.TrimSpace(asObject.Error)
		}
	}

	return strings.TrimSpace(string(raw))
}

func detectAIProvider(baseURL string) aiProvider {
	text := strings.ToLower(strings.TrimSpace(baseURL))
	if strings.Contains(text, "api.anthropic.com") {
		return aiProviderAnthropic
	}
	if strings.Contains(text, "generativelanguage.googleapis.com") || strings.Contains(text, "googleapis.com") && strings.Contains(text, "generatecontent") {
		return aiProviderGemini
	}
	if strings.Contains(text, "api.x.ai") {
		return aiProviderXAIResponses
	}
	return aiProviderOpenAICompatible
}

func buildGeminiRequestURL(baseURL, model, apiKey string) (string, error) {
	baseURL = strings.TrimSpace(baseURL)
	model = strings.TrimSpace(model)
	apiKey = strings.TrimSpace(apiKey)
	if baseURL == "" || model == "" || apiKey == "" {
		return "", errors.New("Gemini 配置缺少 Base URL、Model 或 API Key")
	}

	parsed, err := url.Parse(baseURL)
	if err != nil {
		return "", err
	}

	path := strings.TrimRight(parsed.Path, "/")
	switch {
	case strings.Contains(path, ":generateContent"):
		if idx := strings.Index(path, "/models/"); idx >= 0 {
			prefix := path[:idx+len("/models/")]
			suffix := path[strings.Index(path, ":generateContent"):]
			path = prefix + url.PathEscape(model) + suffix
		}
	case strings.HasSuffix(path, "/models"):
		path = path + "/" + url.PathEscape(model) + ":generateContent"
	case strings.Contains(path, "/models/"):
		if !strings.HasSuffix(path, "/"+model) {
			path = path + "/" + url.PathEscape(model)
		}
		path = path + ":generateContent"
	default:
		path = path + "/models/" + url.PathEscape(model) + ":generateContent"
	}
	parsed.Path = path

	query := parsed.Query()
	if query.Get("key") == "" {
		query.Set("key", apiKey)
	}
	parsed.RawQuery = query.Encode()
	return parsed.String(), nil
}

func buildXAIResponsesRequestURL(baseURL string) (string, error) {
	baseURL = strings.TrimSpace(baseURL)
	if baseURL == "" {
		return "", errors.New("xAI 配置缺少 Base URL")
	}

	parsed, err := url.Parse(baseURL)
	if err != nil {
		return "", err
	}

	path := strings.TrimRight(parsed.Path, "/")
	switch {
	case path == "":
		path = "/v1/responses"
	case strings.HasSuffix(path, "/responses"):
		// Already points to the responses endpoint.
	case strings.HasSuffix(path, "/v1"):
		path = path + "/responses"
	default:
		path = path + "/responses"
	}
	parsed.Path = path
	return parsed.String(), nil
}

func buildAnthropicMessagesRequestURL(baseURL string) (string, error) {
	baseURL = strings.TrimSpace(baseURL)
	if baseURL == "" {
		return "", errors.New("Claude 配置缺少 Base URL")
	}

	parsed, err := url.Parse(baseURL)
	if err != nil {
		return "", err
	}

	path := strings.TrimRight(parsed.Path, "/")
	switch {
	case path == "":
		path = "/v1/messages"
	case strings.HasSuffix(path, "/messages"):
		// already points to messages endpoint
	case strings.HasSuffix(path, "/v1"):
		path = path + "/messages"
	default:
		path = path + "/messages"
	}
	parsed.Path = path
	return parsed.String(), nil
}

func convertToGeminiRequest(payload aiChatCompletionRequest) geminiGenerateContentRequest {
	req := geminiGenerateContentRequest{
		Contents: make([]geminiContent, 0, len(payload.Messages)),
	}

	var systemTexts []string
	for _, msg := range payload.Messages {
		text := strings.TrimSpace(msg.Content)
		if text == "" {
			continue
		}
		switch strings.TrimSpace(msg.Role) {
		case "system":
			systemTexts = append(systemTexts, text)
		case "assistant", "model":
			req.Contents = append(req.Contents, geminiContent{
				Role: "model",
				Parts: []geminiPart{
					{Text: text},
				},
			})
		default:
			req.Contents = append(req.Contents, geminiContent{
				Role: "user",
				Parts: []geminiPart{
					{Text: text},
				},
			})
		}
	}

	if len(systemTexts) > 0 {
		req.SystemInstruction = &geminiContent{
			Parts: []geminiPart{
				{Text: strings.Join(systemTexts, "\n\n")},
			},
		}
	}
	return req
}

func convertToXAIResponsesRequest(payload aiChatCompletionRequest) xAIResponsesRequest {
	req := xAIResponsesRequest{
		Model: payload.Model,
		Input: make([]xAIResponsesMessage, 0, len(payload.Messages)),
		Tools: []xAIResponsesToolSpec{
			{Type: "web_search"},
		},
	}

	for _, msg := range payload.Messages {
		text := strings.TrimSpace(msg.Content)
		if text == "" {
			continue
		}

		role := strings.TrimSpace(msg.Role)
		switch role {
		case "system", "assistant", "user":
		default:
			role = "user"
		}

		req.Input = append(req.Input, xAIResponsesMessage{
			Role:    role,
			Content: text,
		})
	}

	return req
}

func convertToAnthropicMessagesRequest(payload aiChatCompletionRequest) anthropicMessagesRequest {
	req := anthropicMessagesRequest{
		Model:     payload.Model,
		Messages:  make([]anthropicMessagesMessage, 0, len(payload.Messages)),
		MaxTokens: 4096,
	}

	var systemParts []string
	for _, msg := range payload.Messages {
		text := strings.TrimSpace(msg.Content)
		if text == "" {
			continue
		}
		switch strings.TrimSpace(msg.Role) {
		case "system":
			systemParts = append(systemParts, text)
		case "assistant":
			req.Messages = append(req.Messages, anthropicMessagesMessage{
				Role:    "assistant",
				Content: text,
			})
		default:
			req.Messages = append(req.Messages, anthropicMessagesMessage{
				Role:    "user",
				Content: text,
			})
		}
	}

	if len(systemParts) > 0 {
		req.System = strings.Join(systemParts, "\n\n")
	}
	return req
}

func extractGeminiResponseText(result geminiGenerateContentResponse) string {
	if len(result.Candidates) == 0 {
		return ""
	}

	var parts []string
	for _, part := range result.Candidates[0].Content.Parts {
		text := strings.TrimSpace(part.Text)
		if text != "" {
			parts = append(parts, text)
		}
	}
	return strings.TrimSpace(strings.Join(parts, "\n"))
}

func extractXAIResponseText(result xAIResponsesResponse) string {
	if text := strings.TrimSpace(result.OutputText); text != "" {
		return text
	}

	var parts []string
	for _, item := range result.Output {
		if text := strings.TrimSpace(item.Text); text != "" {
			parts = append(parts, text)
		}
		for _, content := range item.Content {
			if text := strings.TrimSpace(content.Text); text != "" {
				parts = append(parts, text)
			}
		}
	}

	return strings.TrimSpace(strings.Join(parts, "\n"))
}

func extractAnthropicResponseText(result anthropicMessagesResponse) string {
	var parts []string
	for _, item := range result.Content {
		text := strings.TrimSpace(item.Text)
		if text != "" {
			parts = append(parts, text)
		}
	}
	return strings.TrimSpace(strings.Join(parts, "\n"))
}

func (a *aiAgent) buildContext(threadID int64, llmThreadID *int64) (string, error) {
	var parts []string
	if llmThreadID == nil {
		parts = append(parts, "以下是程序运行目录中的文档摘要和当前私聊上下文。")

		docText, err := a.loadRuntimeDocuments()
		if err != nil {
			parts = append(parts, "文档读取失败："+err.Error())
		} else if docText != "" {
			parts = append(parts, docText)
		}
	} else {
		parts = append(parts, "以下是当前话题的私聊上下文。")
	}

	messages, err := a.server.listRecentChatMessages(threadID, llmThreadID, 12)
	if err != nil {
		return strings.Join(parts, "\n\n"), err
	}
	if len(messages) > 0 {
		var b strings.Builder
		b.WriteString("最近会话消息：\n")
		for _, msg := range messages {
			if msg.Deleted {
				continue
			}
			name := msg.SenderUsername
			if name == "" {
				name = msg.SenderID
			}
			b.WriteString("- ")
			b.WriteString(name)
			b.WriteString(": ")
			b.WriteString(strings.TrimSpace(msg.Content))
			b.WriteString("\n")
		}
		parts = append(parts, b.String())
	}

	return strings.Join(parts, "\n\n"), nil
}

func (a *aiAgent) loadRuntimeDocuments() (string, error) {
	root := strings.TrimSpace(a.server.workDir)
	if root == "" {
		return "", nil
	}

	maxFiles := 8
	maxBytes := 24 * 1024
	used := 0
	collected := 0
	var b strings.Builder

	walkFn := func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		rel, relErr := filepath.Rel(root, path)
		if relErr != nil {
			rel = path
		}
		if d.IsDir() {
			base := d.Name()
			if base == ".git" || base == "node_modules" || base == "dist" || base == ".gocache" || base == "data" {
				return filepath.SkipDir
			}
			return nil
		}
		if collected >= maxFiles || used >= maxBytes {
			return fs.SkipAll
		}
		ext := strings.ToLower(filepath.Ext(d.Name()))
		if ext != ".md" && ext != ".txt" {
			return nil
		}
		content, readErr := os.ReadFile(path)
		if readErr != nil {
			return nil
		}
		text := strings.TrimSpace(string(content))
		if text == "" {
			return nil
		}
		remaining := maxBytes - used
		if remaining <= 0 {
			return fs.SkipAll
		}
		if len(text) > remaining {
			text = text[:remaining]
		}
		b.WriteString("文件：")
		b.WriteString(rel)
		b.WriteString("\n")
		b.WriteString(text)
		b.WriteString("\n\n")
		used += len(text)
		collected++
		return nil
	}

	if err := filepath.WalkDir(root, walkFn); err != nil && !errors.Is(err, fs.SkipAll) {
		return "", err
	}
	return strings.TrimSpace(b.String()), nil
}
