package dock

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
)

func buildPostAssistSystemPrompt(botPrompt, instruction string) string {
	base := []string{
		"你是一个中文社交帖子写作助手。你的任务是基于用户草稿润色或生成帖子正文，保持用户的核心观点、语气和立场。",
		"必须遵循：",
		"1) 保留用户的关键事实、观点与结论，不擅自新增未提及的事实。",
		"2) 输出控制在 280 字以内，适合社交平台发布；段落短，观点清晰。",
		"3) 如果用户给了明确风格要求按要求润色；否则默认自然、真诚。",
		"4) 仅输出最终可直接发布的正文，不要前后缀、不要解释、不要引号包裹。",
	}
	if strings.TrimSpace(botPrompt) != "" {
		base = append(base, "Bot 额外写作偏好：\n"+strings.TrimSpace(botPrompt))
	}
	if strings.TrimSpace(instruction) != "" {
		base = append(base, "本次写作要求：\n"+strings.TrimSpace(instruction))
	}
	return strings.Join(base, "\n\n")
}

func buildReplyAssistSystemPrompt(botPrompt, instruction string) string {
	base := []string{
		"你是一个中文评论写作助手。你的任务是基于原帖与用户草稿生成一条简洁、得体、真诚的评论。",
		"必须遵循：",
		"1) 先理解原帖内容与作者立场，评论要具体、不空泛。",
		"2) 长度 20-140 字之间，语气友好，避免说教，避免过度敬语。",
		"3) 保留用户草稿中的核心观点；若草稿为空，根据原帖给出一个合理角度。",
		"4) 仅输出最终可直接发布的评论内容，不要前后缀、不要解释。",
	}
	if strings.TrimSpace(botPrompt) != "" {
		base = append(base, "Bot 额外写作偏好：\n"+strings.TrimSpace(botPrompt))
	}
	if strings.TrimSpace(instruction) != "" {
		base = append(base, "本次评论要求：\n"+strings.TrimSpace(instruction))
	}
	return strings.Join(base, "\n\n")
}

// handlePostAssistWithBot drafts or refines a post body using an LLM bot.
// Mirrors /api/markdown/assist-with-bot but targets short-form posts.
func (s *Server) handlePostAssistWithBot(c *gin.Context) {
	userID, _ := c.Get("user_id")
	userIDStr, ok := userID.(string)
	if !ok || userIDStr == "" {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	if s.aiAgent == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "AI Agent 未初始化"})
		return
	}

	var req struct {
		BotID       int64  `json:"bot_id" binding:"required"`
		LLMConfigID int64  `json:"llm_config_id"`
		Content     string `json:"content"`
		Topic       string `json:"topic"`
		Instruction string `json:"instruction"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的输入数据"})
		return
	}
	if req.BotID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效 Bot"})
		return
	}
	draft := strings.TrimSpace(req.Content)
	topic := strings.TrimSpace(req.Topic)
	if draft == "" && topic == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "草稿或选题至少需要填一个"})
		return
	}

	runtimeConfig, bot, llmConfig, err := s.resolveAssistBot(userIDStr, req.BotID, req.LLMConfigID)
	if err != nil {
		writeAssistError(c, err)
		return
	}
	runtimeConfig.SystemPrompt = buildPostAssistSystemPrompt(bot.SystemPrompt, req.Instruction)

	promptLines := []string{"请基于以下信息写一条帖子正文："}
	if topic != "" {
		promptLines = append(promptLines, "选题：\n"+topic)
	}
	if draft != "" {
		promptLines = append(promptLines,
			"--- 草稿开始 ---",
			draft,
			"--- 草稿结束 ---",
		)
	}
	payload := aiChatCompletionRequest{
		Model: runtimeConfig.Model,
		Messages: []aiChatCompletionMessage{
			{Role: "system", Content: runtimeConfig.SystemPrompt},
			{Role: "user", Content: strings.Join(promptLines, "\n")},
		},
	}

	result, err := s.aiAgent.requestChatCompletion(runtimeConfig, payload)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if len(result.Choices) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "模型返回为空"})
		return
	}
	refined := strings.TrimSpace(result.Choices[0].Message.Content)
	if refined == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "模型返回为空"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "草稿已生成",
		"content": refined,
		"bot": gin.H{
			"id":   bot.ID,
			"name": bot.Name,
		},
		"llm": gin.H{
			"config_id": llmConfig.ID,
			"model":     llmConfig.Model,
		},
	})
}

// handleReplyAssistWithBot drafts a reply to the given post using an LLM bot.
func (s *Server) handleReplyAssistWithBot(c *gin.Context) {
	userID, _ := c.Get("user_id")
	userIDStr, ok := userID.(string)
	if !ok || userIDStr == "" {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	if s.aiAgent == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "AI Agent 未初始化"})
		return
	}

	postID, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || postID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的帖子"})
		return
	}
	post, err := s.getPostByID(userIDStr, postID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	if post == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "帖子不存在"})
		return
	}

	var req struct {
		BotID       int64  `json:"bot_id" binding:"required"`
		LLMConfigID int64  `json:"llm_config_id"`
		Content     string `json:"content"`
		Instruction string `json:"instruction"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的输入数据"})
		return
	}
	if req.BotID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效 Bot"})
		return
	}

	runtimeConfig, bot, llmConfig, err := s.resolveAssistBot(userIDStr, req.BotID, req.LLMConfigID)
	if err != nil {
		writeAssistError(c, err)
		return
	}
	runtimeConfig.SystemPrompt = buildReplyAssistSystemPrompt(bot.SystemPrompt, req.Instruction)

	userPrompt := strings.Join([]string{
		"原帖作者：@" + post.Username,
		"原帖内容：",
		post.Content,
		"",
		"用户草稿（可能为空）：",
		strings.TrimSpace(req.Content),
	}, "\n")

	payload := aiChatCompletionRequest{
		Model: runtimeConfig.Model,
		Messages: []aiChatCompletionMessage{
			{Role: "system", Content: runtimeConfig.SystemPrompt},
			{Role: "user", Content: userPrompt},
		},
	}

	result, err := s.aiAgent.requestChatCompletion(runtimeConfig, payload)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if len(result.Choices) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "模型返回为空"})
		return
	}
	refined := strings.TrimSpace(result.Choices[0].Message.Content)
	if refined == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "模型返回为空"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "评论草稿已生成",
		"content": refined,
		"post_id": post.ID,
		"bot": gin.H{
			"id":   bot.ID,
			"name": bot.Name,
		},
		"llm": gin.H{
			"config_id": llmConfig.ID,
			"model":     llmConfig.Model,
		},
	})
}

type assistError struct {
	status  int
	message string
}

func (e *assistError) Error() string { return e.message }

// resolveAssistBot loads the bot and its LLM config for the given owner.
// It returns a ready-to-use aiRuntimeConfig (with SystemPrompt empty — the
// caller sets it based on the specific task).
func (s *Server) resolveAssistBot(ownerUserID string, botID, llmConfigID int64) (aiRuntimeConfig, *BotUser, *LLMConfig, error) {
	bot, err := s.getBotUserForOwner(ownerUserID, botID)
	if err != nil {
		return aiRuntimeConfig{}, nil, nil, &assistError{http.StatusInternalServerError, "服务器错误"}
	}
	if bot == nil {
		return aiRuntimeConfig{}, nil, nil, &assistError{http.StatusNotFound, "Bot 不存在"}
	}

	var (
		llmConfig *LLMConfig
		apiKey    string
	)
	if llmConfigID > 0 {
		llmConfig, apiKey, err = s.getAvailableLLMConfigWithAPIKey(ownerUserID, llmConfigID)
		if err != nil {
			return aiRuntimeConfig{}, nil, nil, &assistError{http.StatusInternalServerError, "服务器错误"}
		}
		if llmConfig == nil {
			return aiRuntimeConfig{}, nil, nil, &assistError{http.StatusBadRequest, "所选 LLM 配置不可用"}
		}
	} else {
		llmConfig, apiKey, err = s.getLLMConfigForBot(bot.BotUserID)
		if err != nil {
			return aiRuntimeConfig{}, nil, nil, &assistError{http.StatusInternalServerError, "服务器错误"}
		}
	}
	if llmConfig == nil || strings.TrimSpace(apiKey) == "" {
		return aiRuntimeConfig{}, nil, nil, &assistError{http.StatusBadRequest, "这个 Bot 的模型配置不可用，请先检查 API Key 和模型配置"}
	}

	return aiRuntimeConfig{
		APIKey:  strings.TrimSpace(apiKey),
		BaseURL: strings.TrimSpace(llmConfig.BaseURL),
		Model:   strings.TrimSpace(llmConfig.Model),
	}, bot, llmConfig, nil
}

func writeAssistError(c *gin.Context, err error) {
	if ae, ok := err.(*assistError); ok {
		c.JSON(ae.status, gin.H{"error": ae.message})
		return
	}
	c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
}
