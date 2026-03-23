package dock

import (
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

func (s *Server) handleTaskApply(c *gin.Context) {
	userID, _ := c.Get("user_id")
	userIDStr, ok := userID.(string)
	if !ok || userIDStr == "" {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}

	postID, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || postID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的任务"})
		return
	}

	if err := s.applyTask(postID, userIDStr, time.Now()); err != nil {
		switch {
		case errors.Is(err, errTaskNotFound):
			c.JSON(http.StatusNotFound, gin.H{"error": "任务不存在"})
		case errors.Is(err, errTaskSelfApply):
			c.JSON(http.StatusBadRequest, gin.H{"error": "发布者不能申请自己的任务"})
		case errors.Is(err, errTaskClosed):
			c.JSON(http.StatusConflict, gin.H{"error": "该任务已停止申请"})
		case errors.Is(err, errTaskApplyEnded):
			c.JSON(http.StatusConflict, gin.H{"error": "申请截止时间已过"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		}
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "申请成功"})
}

func (s *Server) handleTaskWithdraw(c *gin.Context) {
	userID, _ := c.Get("user_id")
	userIDStr, ok := userID.(string)
	if !ok || userIDStr == "" {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}

	postID, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || postID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的任务"})
		return
	}

	ok, err = s.withdrawTaskApplication(postID, userIDStr, time.Now())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "未找到有效申请"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "已撤销申请"})
}

func (s *Server) handleTaskApplications(c *gin.Context) {
	userID, _ := c.Get("user_id")
	userIDStr, ok := userID.(string)
	if !ok || userIDStr == "" {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}

	postID, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || postID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的任务"})
		return
	}

	task, ownerID, err := s.getTaskPostByID(postID, userIDStr)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	if task == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "任务不存在"})
		return
	}
	if ownerID != userIDStr {
		c.JSON(http.StatusForbidden, gin.H{"error": "只有发布者可以查看申请者"})
		return
	}

	applications, err := s.listTaskApplications(postID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"applications": applications})
}

func (s *Server) handleTaskClose(c *gin.Context) {
	userID, _ := c.Get("user_id")
	userIDStr, ok := userID.(string)
	if !ok || userIDStr == "" {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}

	postID, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || postID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的任务"})
		return
	}

	ok, err = s.closeTaskApplications(postID, userIDStr)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "任务不存在或无权限"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "已关闭申请"})
}

func (s *Server) handleTaskSelectCandidate(c *gin.Context) {
	userID, _ := c.Get("user_id")
	userIDStr, ok := userID.(string)
	if !ok || userIDStr == "" {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}

	postID, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || postID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的任务"})
		return
	}

	var req struct {
		ApplicantUserID string `json:"applicant_user_id" binding:"required"`
		MessageTemplate string `json:"message_template"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的输入数据"})
		return
	}

	applicantID := strings.TrimSpace(req.ApplicantUserID)
	if applicantID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "候选人不能为空"})
		return
	}

	now := time.Now()
	threadID, messageID, usedTemplate, err := s.selectTaskApplicant(postID, userIDStr, applicantID, req.MessageTemplate, now)
	if err != nil {
		switch {
		case errors.Is(err, errTaskNotFound):
			c.JSON(http.StatusNotFound, gin.H{"error": "任务不存在"})
		case errors.Is(err, errTaskClosed):
			c.JSON(http.StatusConflict, gin.H{"error": "候选人未申请该任务或任务已关闭"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		}
		return
	}

	if s.wsHub != nil {
		username, _ := c.Get("username")
		senderName, _ := username.(string)
		s.broadcastChatEvent([]string{userIDStr, applicantID}, chatEvent{
			Type:   "message",
			ChatID: threadID,
			Message: &ChatMessage{
				ID:             messageID,
				ThreadID:       threadID,
				SenderID:       userIDStr,
				SenderUsername: senderName,
				Content:        usedTemplate,
				CreatedAt:      now,
			},
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"message":          "候选人已确认，私信已发送",
		"chat_id":          threadID,
		"message_id":       messageID,
		"message_template": usedTemplate,
	})
}
