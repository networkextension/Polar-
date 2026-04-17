package dock

import (
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

func buildMarkdownAssistSystemPrompt(botPrompt, instruction string) string {
	base := []string{
		"你是一个中文写作润色助手。你的任务是基于用户原文做改写与润色，而不是替用户重新发明核心观点。",
		"必须遵循：",
		"1) 保留用户核心事实、观点、立场与结论，不擅自新增关键事实。",
		"2) 优先做表达优化：结构、语序、逻辑、可读性、措辞、语法。",
		"3) 如果用户给了明确风格要求，按要求润色；若无要求，默认清晰、自然、专业。",
		"4) 输出只返回最终可直接粘贴的正文内容，不要解释、不要前后缀。",
	}
	if strings.TrimSpace(botPrompt) != "" {
		base = append(base, "Bot 额外写作偏好：\n"+strings.TrimSpace(botPrompt))
	}
	if strings.TrimSpace(instruction) != "" {
		base = append(base, "本次润色要求：\n"+strings.TrimSpace(instruction))
	}
	return strings.Join(base, "\n\n")
}

func (s *Server) handleMarkdownAssistWithBot(c *gin.Context) {
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
		Title       string `json:"title"`
		Content     string `json:"content" binding:"required"`
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
	sourceContent := strings.TrimSpace(req.Content)
	if sourceContent == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "内容不能为空"})
		return
	}

	bot, err := s.getBotUserForOwner(userIDStr, req.BotID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	if bot == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Bot 不存在"})
		return
	}

	var (
		llmConfig *LLMConfig
		apiKey    string
	)
	if req.LLMConfigID > 0 {
		llmConfig, apiKey, err = s.getAvailableLLMConfigWithAPIKey(userIDStr, req.LLMConfigID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
			return
		}
		if llmConfig == nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "所选 LLM 配置不可用"})
			return
		}
	} else {
		llmConfig, apiKey, err = s.getLLMConfigForBot(bot.BotUserID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
			return
		}
	}
	if llmConfig == nil || strings.TrimSpace(apiKey) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "这个 Bot 的模型配置不可用，请先检查 API Key 和模型配置"})
		return
	}

	runtimeConfig := aiRuntimeConfig{
		APIKey:       strings.TrimSpace(apiKey),
		BaseURL:      strings.TrimSpace(llmConfig.BaseURL),
		Model:        strings.TrimSpace(llmConfig.Model),
		SystemPrompt: buildMarkdownAssistSystemPrompt(bot.SystemPrompt, req.Instruction),
	}

	userPrompt := strings.TrimSpace(strings.Join([]string{
		"请润色以下正文，保持核心内容不变：",
		"标题：" + strings.TrimSpace(req.Title),
		"--- 原文开始 ---",
		sourceContent,
		"--- 原文结束 ---",
	}, "\n"))

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
		"message": "润色完成",
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

func (s *Server) handleMarkdownSubmit(c *gin.Context) {
	var req struct {
		Title      string `json:"title" binding:"required"`
		Content    string `json:"content" binding:"required"`
		IsPublic   bool   `json:"is_public"`
		EditorMode string `json:"editor_mode"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的输入数据"})
		return
	}

	userID, _ := c.Get("user_id")
	username, _ := c.Get("username")

	now := time.Now()
	userIDStr, ok := userID.(string)
	if !ok || userIDStr == "" {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}

	entry, _, err := s.saveMarkdownDocument(userIDStr, req.Title, req.Content, req.EditorMode, req.IsPublic, now)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"message":     "保存成功",
		"id":          entry.ID,
		"file":        entry.FilePath,
		"username":    username,
		"is_public":   req.IsPublic,
		"editor_mode": entry.EditorMode,
	})
}

func (s *Server) handleMarkdownList(c *gin.Context) {
	userID, _ := c.Get("user_id")
	userIDStr, ok := userID.(string)
	if !ok || userIDStr == "" {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}

	limit := 0
	if limitStr := c.Query("limit"); limitStr != "" {
		parsed, err := strconv.Atoi(limitStr)
		if err != nil || parsed <= 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "无效的输入数据"})
			return
		}
		limit = parsed
	}

	offset := 0
	if offsetStr := c.Query("offset"); offsetStr != "" {
		parsed, err := strconv.Atoi(offsetStr)
		if err != nil || parsed < 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "无效的输入数据"})
			return
		}
		offset = parsed
	}

	entries, hasMore, err := s.listMarkdownEntries(userIDStr, limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}

	nextOffset := offset + len(entries)
	c.JSON(http.StatusOK, gin.H{
		"entries":     entries,
		"has_more":    hasMore,
		"next_offset": nextOffset,
	})
}

func (s *Server) handlePublicMarkdownList(c *gin.Context) {
	limit := 0
	if limitStr := c.Query("limit"); limitStr != "" {
		parsed, err := strconv.Atoi(limitStr)
		if err != nil || parsed <= 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "无效的输入数据"})
			return
		}
		limit = parsed
	}

	offset := 0
	if offsetStr := c.Query("offset"); offsetStr != "" {
		parsed, err := strconv.Atoi(offsetStr)
		if err != nil || parsed < 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "无效的输入数据"})
			return
		}
		offset = parsed
	}

	entries, hasMore, err := s.listPublicMarkdownEntries(limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}

	nextOffset := offset + len(entries)
	c.JSON(http.StatusOK, gin.H{
		"entries":     entries,
		"has_more":    hasMore,
		"next_offset": nextOffset,
	})
}

func (s *Server) handleMarkdownRead(c *gin.Context) {
	userID, _ := c.Get("user_id")
	userIDStr, ok := userID.(string)
	if !ok || userIDStr == "" {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}

	entryID, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || entryID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的输入数据"})
		return
	}

	entry, canEdit, err := s.getMarkdownEntryForUser(userIDStr, entryID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	if entry == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "未找到记录"})
		return
	}

	content, err := os.ReadFile(entry.FilePath)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "文件不存在"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"entry":    entry,
		"content":  string(content),
		"can_edit": canEdit,
	})
}

func (s *Server) handleMarkdownUpdate(c *gin.Context) {
	userID, _ := c.Get("user_id")
	userIDStr, ok := userID.(string)
	if !ok || userIDStr == "" {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}

	entryID, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || entryID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的输入数据"})
		return
	}

	var req struct {
		Title      string `json:"title" binding:"required"`
		Content    string `json:"content" binding:"required"`
		IsPublic   bool   `json:"is_public"`
		EditorMode string `json:"editor_mode"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的输入数据"})
		return
	}

	entry, err := s.getOwnedMarkdownEntry(userIDStr, entryID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	if entry == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "未找到记录"})
		return
	}

	content := req.Content
	if !strings.HasPrefix(strings.TrimSpace(content), "#") {
		content = "# " + req.Title + "\n\n" + content
	}

	if err := os.WriteFile(entry.FilePath, []byte(content), 0o644); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}

	editorMode := strings.TrimSpace(req.EditorMode)
	if editorMode == "" {
		editorMode = entry.EditorMode
	}
	editorMode = normalizeEditorMode(editorMode)
	summary, coverURL := extractMarkdownMeta(content)
	if err := s.updateMarkdownEntry(userIDStr, entryID, req.Title, entry.FilePath, summary, coverURL, editorMode, req.IsPublic); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message":     "更新成功",
		"id":          entryID,
		"is_public":   req.IsPublic,
		"editor_mode": editorMode,
	})
}

func (s *Server) handleMarkdownDelete(c *gin.Context) {
	userID, _ := c.Get("user_id")
	userIDStr, ok := userID.(string)
	if !ok || userIDStr == "" {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}

	entryID, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || entryID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的输入数据"})
		return
	}

	entry, err := s.getOwnedMarkdownEntry(userIDStr, entryID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	if entry == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "未找到记录"})
		return
	}

	_ = os.Remove(entry.FilePath)
	if err := s.deleteMarkdownEntry(userIDStr, entryID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "删除成功"})
}

func (s *Server) handlePublicMarkdownRead(c *gin.Context) {
	entryID, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || entryID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的输入数据"})
		return
	}

	viewerUserID := ""
	if sessionID, err := c.Cookie(SessionCookieName); err == nil {
		if session := s.getSession(sessionID); session != nil {
			viewerUserID = session.UserID
		}
	}

	entry, _, err := s.getMarkdownEntryForUser(viewerUserID, entryID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	if entry == nil || (!entry.IsPublic && entry.UserID != viewerUserID) {
		c.JSON(http.StatusNotFound, gin.H{"error": "未找到记录"})
		return
	}

	content, err := os.ReadFile(entry.FilePath)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "文件不存在"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"entry":    entry,
		"content":  string(content),
		"can_edit": false,
	})
}

func (s *Server) handleMarkdownLike(c *gin.Context) {
	userID, _ := c.Get("user_id")
	userIDStr, ok := userID.(string)
	if !ok || userIDStr == "" {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}

	markdownID, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || markdownID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的输入数据"})
		return
	}

	if err := s.likeMarkdown(markdownID, userIDStr, time.Now()); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}

	likeCount, likedByMe, _ := s.markdownLikeState(markdownID, userIDStr)
	c.JSON(http.StatusOK, gin.H{
		"message":      "已点赞",
		"like_count":   likeCount,
		"liked_by_me":  likedByMe,
	})
}

func (s *Server) handleMarkdownUnlike(c *gin.Context) {
	userID, _ := c.Get("user_id")
	userIDStr, ok := userID.(string)
	if !ok || userIDStr == "" {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}

	markdownID, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || markdownID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的输入数据"})
		return
	}

	if err := s.unlikeMarkdown(markdownID, userIDStr); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}

	likeCount, likedByMe, _ := s.markdownLikeState(markdownID, userIDStr)
	c.JSON(http.StatusOK, gin.H{
		"message":      "已取消点赞",
		"like_count":   likeCount,
		"liked_by_me":  likedByMe,
	})
}

func (s *Server) handleMarkdownReplyCreate(c *gin.Context) {
	userID, _ := c.Get("user_id")
	userIDStr, ok := userID.(string)
	if !ok || userIDStr == "" {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}

	markdownID, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || markdownID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的输入数据"})
		return
	}

	var req struct {
		Content string `json:"content" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的输入数据"})
		return
	}

	content := strings.TrimSpace(req.Content)
	if content == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "评论不能为空"})
		return
	}

	replyID, err := s.createMarkdownReply(markdownID, userIDStr, content, time.Now())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"message": "评论成功",
		"id":      replyID,
	})
}

func (s *Server) handleMarkdownReplyList(c *gin.Context) {
	markdownID, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || markdownID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的输入数据"})
		return
	}

	limit := 0
	if limitStr := c.Query("limit"); limitStr != "" {
		parsed, err := strconv.Atoi(limitStr)
		if err != nil || parsed <= 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "无效的输入数据"})
			return
		}
		limit = parsed
	}

	offset := 0
	if offsetStr := c.Query("offset"); offsetStr != "" {
		parsed, err := strconv.Atoi(offsetStr)
		if err != nil || parsed < 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "无效的输入数据"})
			return
		}
		offset = parsed
	}

	replies, hasMore, err := s.listMarkdownReplies(markdownID, limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}

	nextOffset := offset + len(replies)
	c.JSON(http.StatusOK, gin.H{
		"replies":     replies,
		"has_more":    hasMore,
		"next_offset": nextOffset,
	})
}

func (s *Server) handleMarkdownBookmark(c *gin.Context) {
	userID, _ := c.Get("user_id")
	userIDStr, ok := userID.(string)
	if !ok || userIDStr == "" {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}

	markdownID, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || markdownID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的输入数据"})
		return
	}

	if err := s.bookmarkMarkdown(markdownID, userIDStr, time.Now()); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "已收藏", "bookmarked_by_me": true})
}

func (s *Server) handleMarkdownUnbookmark(c *gin.Context) {
	userID, _ := c.Get("user_id")
	userIDStr, ok := userID.(string)
	if !ok || userIDStr == "" {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}

	markdownID, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || markdownID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的输入数据"})
		return
	}

	if err := s.unbookmarkMarkdown(markdownID, userIDStr); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "已取消收藏", "bookmarked_by_me": false})
}
