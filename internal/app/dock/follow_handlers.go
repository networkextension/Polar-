package dock

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

func parsePageParams(c *gin.Context, defaultLimit, maxLimit int) (limit, offset int, ok bool) {
	limit = defaultLimit
	if s := c.Query("limit"); s != "" {
		parsed, err := strconv.Atoi(s)
		if err != nil || parsed <= 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "无效的输入数据"})
			return 0, 0, false
		}
		limit = parsed
	}
	if maxLimit > 0 && limit > maxLimit {
		limit = maxLimit
	}
	if s := c.Query("offset"); s != "" {
		parsed, err := strconv.Atoi(s)
		if err != nil || parsed < 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "无效的输入数据"})
			return 0, 0, false
		}
		offset = parsed
	}
	return limit, offset, true
}

func (s *Server) handleUserFollow(c *gin.Context) {
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
	if targetUserID == viewerIDStr {
		c.JSON(http.StatusBadRequest, gin.H{"error": "不能关注自己"})
		return
	}

	target, err := s.getUserByID(targetUserID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	if target == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "用户不存在"})
		return
	}

	iBlockedUser, blockedMe, err := s.getUserBlockState(viewerIDStr, targetUserID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	if iBlockedUser || blockedMe {
		c.JSON(http.StatusForbidden, gin.H{"error": "由于拉黑关系，无法关注该用户"})
		return
	}

	if err := s.createUserFollow(viewerIDStr, targetUserID, time.Now()); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}

	profile, err := s.getUserProfileDetail(targetUserID, viewerIDStr)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"message": "已关注",
		"profile": profile,
	})
}

func (s *Server) handleUserUnfollow(c *gin.Context) {
	viewerID, _ := c.Get("user_id")
	viewerIDStr, ok := viewerID.(string)
	if !ok || viewerIDStr == "" {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}

	targetUserID := strings.TrimSpace(c.Param("id"))
	if targetUserID == "" || targetUserID == viewerIDStr {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的用户"})
		return
	}

	if _, err := s.deleteUserFollow(viewerIDStr, targetUserID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}

	profile, err := s.getUserProfileDetail(targetUserID, viewerIDStr)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"message": "已取消关注",
		"profile": profile,
	})
}

func (s *Server) handleUserFollowers(c *gin.Context) {
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

	limit, offset, good := parsePageParams(c, 20, 100)
	if !good {
		return
	}

	users, total, err := s.listUserFollowers(targetUserID, viewerIDStr, limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	hasMore := offset+len(users) < total
	nextOffset := 0
	if hasMore {
		nextOffset = offset + len(users)
	}
	c.JSON(http.StatusOK, gin.H{
		"users":       users,
		"total":       total,
		"has_more":    hasMore,
		"next_offset": nextOffset,
	})
}

func (s *Server) handleUserFollowing(c *gin.Context) {
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

	limit, offset, good := parsePageParams(c, 20, 100)
	if !good {
		return
	}

	users, total, err := s.listUserFollowing(targetUserID, viewerIDStr, limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	hasMore := offset+len(users) < total
	nextOffset := 0
	if hasMore {
		nextOffset = offset + len(users)
	}
	c.JSON(http.StatusOK, gin.H{
		"users":       users,
		"total":       total,
		"has_more":    hasMore,
		"next_offset": nextOffset,
	})
}

func (s *Server) handleMyFollowing(c *gin.Context) {
	viewerID, _ := c.Get("user_id")
	viewerIDStr, ok := viewerID.(string)
	if !ok || viewerIDStr == "" {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}

	limit, offset, good := parsePageParams(c, 20, 100)
	if !good {
		return
	}

	users, total, err := s.listUserFollowing(viewerIDStr, viewerIDStr, limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	hasMore := offset+len(users) < total
	nextOffset := 0
	if hasMore {
		nextOffset = offset + len(users)
	}
	c.JSON(http.StatusOK, gin.H{
		"users":       users,
		"total":       total,
		"has_more":    hasMore,
		"next_offset": nextOffset,
	})
}

func (s *Server) handleMyBookmarkList(c *gin.Context) {
	viewerID, _ := c.Get("user_id")
	viewerIDStr, ok := viewerID.(string)
	if !ok || viewerIDStr == "" {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}

	limit, offset, good := parsePageParams(c, 20, 100)
	if !good {
		return
	}

	posts, hasMore, err := s.listBookmarkedPosts(viewerIDStr, limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	nextOffset := offset + len(posts)
	c.JSON(http.StatusOK, gin.H{
		"posts":       posts,
		"has_more":    hasMore,
		"next_offset": nextOffset,
	})
}

func (s *Server) handleUserSearch(c *gin.Context) {
	viewerID, _ := c.Get("user_id")
	viewerIDStr, ok := viewerID.(string)
	if !ok || viewerIDStr == "" {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}

	limit, offset, good := parsePageParams(c, 20, 50)
	if !good {
		return
	}

	users, total, err := s.searchUsers(c.Query("q"), viewerIDStr, limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	hasMore := offset+len(users) < total
	nextOffset := 0
	if hasMore {
		nextOffset = offset + len(users)
	}
	c.JSON(http.StatusOK, gin.H{
		"users":       users,
		"total":       total,
		"has_more":    hasMore,
		"next_offset": nextOffset,
	})
}
