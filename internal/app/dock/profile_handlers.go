package dock

import (
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

func (s *Server) handleUserProfileGet(c *gin.Context) {
	viewerID, _ := c.Get("user_id")
	viewerIDStr, ok := viewerID.(string)
	if !ok || viewerIDStr == "" {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}

	targetUserID := strings.TrimSpace(c.Param("id"))
	if targetUserID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的用户"})
		return
	}

	profile, err := s.getUserProfileDetail(targetUserID, viewerIDStr)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	if profile == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "用户不存在"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"profile": profile})
}

func (s *Server) handleMyProfileUpdate(c *gin.Context) {
	userID, _ := c.Get("user_id")
	userIDStr, ok := userID.(string)
	if !ok || userIDStr == "" {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}

	var req struct {
		Bio string `json:"bio"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的输入数据"})
		return
	}
	bio := strings.TrimSpace(req.Bio)
	if len([]rune(bio)) > 500 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "自我介绍不能超过 500 字"})
		return
	}

	if err := s.updateUserBio(userIDStr, bio); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "保存失败"})
		return
	}

	profile, err := s.getUserProfileDetail(userIDStr, userIDStr)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"message": "保存成功",
		"profile": profile,
	})
}

func (s *Server) handleProfileRecommendationUpsert(c *gin.Context) {
	authorID, _ := c.Get("user_id")
	authorIDStr, ok := authorID.(string)
	if !ok || authorIDStr == "" {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}

	targetUserID := strings.TrimSpace(c.Param("id"))
	if targetUserID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的用户"})
		return
	}
	if targetUserID == authorIDStr {
		c.JSON(http.StatusBadRequest, gin.H{"error": "不能给自己写 Recommendation"})
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
		c.JSON(http.StatusBadRequest, gin.H{"error": "Recommendation 不能为空"})
		return
	}
	if len([]rune(content)) > 1000 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Recommendation 不能超过 1000 字"})
		return
	}

	targetUser, err := s.getUserByID(targetUserID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	if targetUser == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "用户不存在"})
		return
	}
	iBlockedUser, blockedMe, err := s.getUserBlockState(authorIDStr, targetUserID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	if iBlockedUser {
		c.JSON(http.StatusForbidden, gin.H{"error": "你已拉黑对方，不能继续提交 Recommendation"})
		return
	}
	if blockedMe {
		c.JSON(http.StatusForbidden, gin.H{"error": "对方已拉黑你，不能继续提交 Recommendation"})
		return
	}

	if err := s.upsertProfileRecommendation(targetUserID, authorIDStr, content, time.Now()); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "保存失败"})
		return
	}

	profile, err := s.getUserProfileDetail(targetUserID, authorIDStr)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "Recommendation 已保存",
		"profile": profile,
	})
}

func (s *Server) handleUserBlockCreate(c *gin.Context) {
	userID, _ := c.Get("user_id")
	userIDStr, ok := userID.(string)
	if !ok || userIDStr == "" {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}

	targetUserID := strings.TrimSpace(c.Param("id"))
	if targetUserID == "" || targetUserID == userIDStr {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的用户"})
		return
	}

	targetUser, err := s.getUserByID(targetUserID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	if targetUser == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "用户不存在"})
		return
	}

	if err := s.blockUser(userIDStr, targetUserID, time.Now()); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}

	profile, err := s.getUserProfileDetail(targetUserID, userIDStr)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"message": "已拉黑该用户",
		"profile": profile,
	})
}

func (s *Server) handleUserBlockDelete(c *gin.Context) {
	userID, _ := c.Get("user_id")
	userIDStr, ok := userID.(string)
	if !ok || userIDStr == "" {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}

	targetUserID := strings.TrimSpace(c.Param("id"))
	if targetUserID == "" || targetUserID == userIDStr {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的用户"})
		return
	}

	targetUser, err := s.getUserByID(targetUserID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	if targetUser == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "用户不存在"})
		return
	}

	if _, err := s.unblockUser(userIDStr, targetUserID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}

	profile, err := s.getUserProfileDetail(targetUserID, userIDStr)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"message": "已取消拉黑",
		"profile": profile,
	})
}
