package dock

import (
	"bytes"
	"context"
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
	streaming    bool
	tasks        chan aiAgentTask
	stopCh       chan struct{}
	stopOnce     sync.Once
	httpClient   *http.Client
	streamClient *http.Client

	// streams tracks in-flight streaming generations keyed by chat_messages.id
	// so a revoke handler can cancel the LLM HTTP call mid-stream.
	streamsMu sync.Mutex
	streams   map[int64]context.CancelFunc
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
	Streaming    bool
}

type aiChatCompletionRequest struct {
	Model              string                    `json:"model"`
	Messages           []aiChatCompletionMessage `json:"messages"`
	MaxTokens          int                       `json:"max_tokens,omitempty"`
	Stream             bool                      `json:"stream,omitempty"`
	ChatTemplateKwargs map[string]any            `json:"chat_template_kwargs,omitempty"`
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
		streaming:    cfg.AIAgentStreaming,
		tasks:        make(chan aiAgentTask, 64),
		stopCh:       make(chan struct{}),
		streams:      make(map[int64]context.CancelFunc),
		httpClient: &http.Client{
			Timeout: 180 * time.Second,
		},
		// streamClient has no overall timeout; the per-stream idle-gap
		// watchdog cancels the request context instead. A 180s wall-clock
		// limit would hard-kill long generations on slow self-hosted
		// inference, defeating the point of streaming.
		streamClient: &http.Client{Timeout: 0},
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
	cfg, err := a.runtimeConfig(task.ThreadID, task.LLMThreadID, task.ResponderUserID)
	if err != nil {
		log.Printf("ai agent resolve runtime config failed: %v", err)
		latency := int64(0)
		if _, sendErr := a.server.sendFailedBotMessage(task.ThreadID, task.LLMThreadID, task.ResponderUserID, task.ResponderName, "AI 助理配置无法加载，请联系管理员。", &latency, time.Now()); sendErr != nil {
			log.Printf("send failed ai agent chat message failed: %v", sendErr)
		}
		return
	}
	if cfg.Streaming {
		a.handleStreamingTask(task, cfg)
		return
	}
	a.handleSyncTask(task, cfg)
}

// handleSyncTask is the original non-streaming flow: one HTTP call, save
// markdown, send the shared_markdown message. Kept verbatim so flipping
// streaming=false is a true regression gate.
func (a *aiAgent) handleSyncTask(task aiAgentTask, cfg aiRuntimeConfig) {
	start := time.Now()
	reply, err := a.generateReply(task, cfg)
	latencyMs := time.Since(start).Milliseconds()
	latencyPtr := &latencyMs
	if err != nil {
		log.Printf("ai agent reply failed after %dms: %v", latencyMs, err)
		reply = "我暂时无法完成这次处理，请稍后再试。"
		if _, sendErr := a.server.sendFailedBotMessage(task.ThreadID, task.LLMThreadID, task.ResponderUserID, task.ResponderName, reply, latencyPtr, time.Now()); sendErr != nil {
			log.Printf("send failed ai agent chat message failed: %v", sendErr)
		}
		return
	}
	reply = strings.TrimSpace(reply)
	if reply == "" {
		reply = "我暂时没有可返回的结果。"
	}
	log.Printf("ai agent reply ok in %dms (thread=%d)", latencyMs, task.ThreadID)
	now := time.Now()
	title := buildSystemMarkdownTitle(reply, now)
	entry, _, err := a.server.saveMarkdownDocument(task.ResponderUserID, title, reply, "markdown", false, now)
	if err != nil {
		log.Printf("save ai markdown failed: %v", err)
		if _, sendErr := a.server.sendBotChatMessage(task.ThreadID, task.LLMThreadID, task.ResponderUserID, task.ResponderName, reply, latencyPtr, now); sendErr != nil {
			log.Printf("send fallback ai agent chat message failed: %v", sendErr)
		}
		return
	}
	if _, err := a.server.sendSharedMarkdownMessage(task.ThreadID, task.LLMThreadID, task.ResponderUserID, task.ResponderName, entry.ID, entry.Title, buildMarkdownPreview(reply, 120), latencyPtr, now); err != nil {
		log.Printf("send ai shared markdown message failed: %v", err)
	}
}

// handleStreamingTask:
//  1. Insert an empty placeholder shared_markdown row (streaming=true) and
//     broadcast it so the UI can show a "thinking…" bubble immediately.
//  2. Call requestStreamingChatCompletion with an onDelta that accumulates
//     text in memory and flushes to DB at most once per second (republishing
//     the message-created event each time so WS subscribers see the growth).
//  3. On success: saveMarkdownDocument + finalizeChatMessage with the
//     markdown link, latency, streaming=false. Republish.
//  4. On error: finalizeChatMessage with failed=true and partial text.
//
// Cancellation is honored via context: revoke handler can call
// aiAgent.cancelStream(messageID) which fires the stored CancelFunc.
func (a *aiAgent) handleStreamingTask(task aiAgentTask, cfg aiRuntimeConfig) {
	if strings.TrimSpace(cfg.APIKey) == "" || strings.TrimSpace(cfg.BaseURL) == "" || strings.TrimSpace(cfg.Model) == "" {
		// Fall back to the synchronous error message — same UX as before.
		a.handleSyncTask(task, cfg)
		return
	}

	now := time.Now()
	placeholderID, err := a.server.sendStreamingPlaceholder(task.ThreadID, task.LLMThreadID, task.ResponderUserID, task.ResponderName, now)
	if err != nil {
		log.Printf("ai agent placeholder insert failed: %v", err)
		a.handleSyncTask(task, cfg)
		return
	}

	contextText, ctxErr := a.buildContext(task.ThreadID, task.LLMThreadID)
	if ctxErr != nil {
		log.Printf("build ai context failed: %v", ctxErr)
	}

	payload := aiChatCompletionRequest{
		Model: cfg.Model,
		Messages: []aiChatCompletionMessage{
			{Role: "system", Content: cfg.SystemPrompt},
			{Role: "system", Content: contextText},
			{Role: "user", Content: task.Content},
		},
		MaxTokens:          32768,
		ChatTemplateKwargs: map[string]any{"enable_thinking": false},
	}

	streamCtx, cancel := context.WithCancel(context.Background())
	a.registerStream(placeholderID, cancel)
	defer a.unregisterStream(placeholderID)

	var (
		accumulator   strings.Builder
		lastFlushed   time.Time
		lastFlushLen  int
		flushInterval = time.Second
		streamStart   = time.Now()
	)

	flush := func(force bool) {
		current := accumulator.String()
		if !force && (len(current) == lastFlushLen || time.Since(lastFlushed) < flushInterval) {
			return
		}
		ok, err := a.server.updateChatMessageContent(placeholderID, current)
		if err != nil {
			log.Printf("ai agent update streaming content failed: %v", err)
			return
		}
		if !ok {
			log.Printf("ai agent stream flush row not updated (id=%d, len=%d) — finalized or revoked", placeholderID, len(current))
			cancel()
			return
		}
		lastFlushed = time.Now()
		lastFlushLen = len(current)
		log.Printf("ai agent stream flush id=%d len=%d", placeholderID, len(current))
		a.republishMessageCreatedSilent(task.ThreadID, placeholderID, task.ResponderUserID)
	}

	final, streamErr := a.requestStreamingChatCompletion(streamCtx, cfg, payload, func(delta string) {
		accumulator.WriteString(delta)
		flush(false)
	})

	// Drain any unflushed tail so the user sees the last chunks before we
	// transition to the finalized markdown card.
	flush(true)

	totalLatency := time.Since(streamStart).Milliseconds()
	totalLatencyPtr := &totalLatency

	if streamErr != nil {
		partial := strings.TrimSpace(accumulator.String())
		if partial == "" {
			partial = strings.TrimSpace(final)
		}
		if partial == "" {
			partial = "我暂时无法完成这次处理，请稍后再试。"
		} else {
			partial += "\n\n（生成被中断：" + streamErr.Error() + "）"
		}
		log.Printf("ai agent stream failed after %dms (thread=%d): %v", totalLatency, task.ThreadID, streamErr)
		if err := a.server.finalizeChatMessage(placeholderID, partial, nil, "", totalLatencyPtr, true); err != nil {
			log.Printf("finalize streaming failed: %v", err)
		}
		a.republishMessageCreated(task.ThreadID, placeholderID, task.ResponderUserID)
		return
	}

	finalText := strings.TrimSpace(final)
	if finalText == "" {
		finalText = strings.TrimSpace(accumulator.String())
	}
	if finalText == "" {
		finalText = "我暂时没有可返回的结果。"
	}
	log.Printf("ai agent stream ok in %dms (thread=%d, bytes=%d)", totalLatency, task.ThreadID, len(finalText))

	completedAt := time.Now()
	title := buildSystemMarkdownTitle(finalText, completedAt)
	entry, _, err := a.server.saveMarkdownDocument(task.ResponderUserID, title, finalText, "markdown", false, completedAt)
	if err != nil {
		log.Printf("save ai markdown failed: %v", err)
		// Finalize without a markdown link; the streaming bubble keeps the
		// final text and just loses the "expand" button.
		if finalErr := a.server.finalizeChatMessage(placeholderID, finalText, nil, "", totalLatencyPtr, false); finalErr != nil {
			log.Printf("finalize streaming (no markdown) failed: %v", finalErr)
		}
		a.republishMessageCreated(task.ThreadID, placeholderID, task.ResponderUserID)
		return
	}

	preview := buildMarkdownPreview(finalText, 120)
	if err := a.server.finalizeChatMessage(placeholderID, preview, &entry.ID, entry.Title, totalLatencyPtr, false); err != nil {
		log.Printf("finalize streaming success failed: %v", err)
	}
	a.republishMessageCreated(task.ThreadID, placeholderID, task.ResponderUserID)
}

// republishMessageCreated re-fires the chatEventMessageCreated event so the
// WS hub re-fetches the row and broadcasts the updated state. The hub uses
// getChatMessageByID, so each republish carries the latest content/seq.
// Mid-stream republishes are marked silent so we don't fire push-prep work
// once per second; the final post-finalize republish leaves silent=false so
// the receiver still gets a notification for the completed reply.
func (a *aiAgent) republishMessageCreated(threadID, messageID int64, senderID string) {
	a.server.publishChatInternalEvent(chatInternalEvent{
		Event:     chatEventMessageCreated,
		ChatID:    threadID,
		MessageID: messageID,
		SenderID:  senderID,
	})
}

func (a *aiAgent) republishMessageCreatedSilent(threadID, messageID int64, senderID string) {
	a.server.publishChatInternalEvent(chatInternalEvent{
		Event:     chatEventMessageCreated,
		ChatID:    threadID,
		MessageID: messageID,
		SenderID:  senderID,
		Silent:    true,
	})
}

func (a *aiAgent) registerStream(messageID int64, cancel context.CancelFunc) {
	if a == nil || messageID <= 0 || cancel == nil {
		return
	}
	a.streamsMu.Lock()
	defer a.streamsMu.Unlock()
	if a.streams == nil {
		a.streams = make(map[int64]context.CancelFunc)
	}
	a.streams[messageID] = cancel
}

func (a *aiAgent) unregisterStream(messageID int64) {
	if a == nil || messageID <= 0 {
		return
	}
	a.streamsMu.Lock()
	defer a.streamsMu.Unlock()
	delete(a.streams, messageID)
}

// cancelStream aborts an in-flight streaming generation for the given
// placeholder message id. Safe to call when no stream is active. Used by
// the revoke handler so deleting a streaming bubble immediately tears down
// the upstream LLM connection.
func (a *aiAgent) cancelStream(messageID int64) {
	if a == nil || messageID <= 0 {
		return
	}
	a.streamsMu.Lock()
	cancel, ok := a.streams[messageID]
	delete(a.streams, messageID)
	a.streamsMu.Unlock()
	if ok && cancel != nil {
		cancel()
	}
}

func (a *aiAgent) generateReply(task aiAgentTask, runtimeConfig aiRuntimeConfig) (string, error) {
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
		MaxTokens:          32768,
		ChatTemplateKwargs: map[string]any{"enable_thinking": false},
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
			Streaming:    a.streaming,
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
		Streaming:    item.Streaming,
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
