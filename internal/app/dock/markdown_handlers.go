package dock

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

func (s *Server) handleMarkdownSubmit(c *gin.Context) {
	var req struct {
		Title   string `json:"title" binding:"required"`
		Content string `json:"content" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的输入数据"})
		return
	}

	userID, _ := c.Get("user_id")
	username, _ := c.Get("username")

	if err := os.MkdirAll(s.markdownDir, 0o755); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}

	safeTitle := sanitizeFilename(req.Title)
	now := time.Now()
	timestamp := now.Format("20060102_150405")
	filename := safeTitle + "_" + timestamp + "_" + sanitizeFilename(fmt.Sprintf("%v", userID)) + ".md"
	path := filepath.Join(s.markdownDir, filename)

	content := req.Content
	if !strings.HasPrefix(strings.TrimSpace(content), "#") {
		content = "# " + req.Title + "\n\n" + content
	}

	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}

	userIDStr, ok := userID.(string)
	if !ok || userIDStr == "" {
		_ = os.Remove(path)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}

	entryID, err := s.createMarkdownEntryReturningID(userIDStr, req.Title, path, now)
	if err != nil {
		_ = os.Remove(path)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"message":  "保存成功",
		"id":       entryID,
		"file":     path,
		"username": username,
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

	entry, err := s.getMarkdownEntry(userIDStr, entryID)
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
		"entry":   entry,
		"content": string(content),
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
		Title   string `json:"title" binding:"required"`
		Content string `json:"content" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的输入数据"})
		return
	}

	entry, err := s.getMarkdownEntry(userIDStr, entryID)
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

	if err := s.updateMarkdownEntry(userIDStr, entryID, req.Title, entry.FilePath); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "更新成功",
		"id":      entryID,
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

	entry, err := s.getMarkdownEntry(userIDStr, entryID)
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
