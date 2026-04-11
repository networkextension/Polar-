package dock

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
)

func (s *Server) handleAdminUserList(c *gin.Context) {
	limit := 20
	if limitStr := c.Query("limit"); limitStr != "" {
		parsed, err := strconv.Atoi(limitStr)
		if err != nil || parsed <= 0 {
			jsonError(c, http.StatusBadRequest, "common.invalid_input")
			return
		}
		limit = parsed
	}

	offset := 0
	if offsetStr := c.Query("offset"); offsetStr != "" {
		parsed, err := strconv.Atoi(offsetStr)
		if err != nil || parsed < 0 {
			jsonError(c, http.StatusBadRequest, "common.invalid_input")
			return
		}
		offset = parsed
	}

	users, total, err := s.listUsersForAdmin(c.Query("q"), limit, offset)
	if err != nil {
		jsonError(c, http.StatusInternalServerError, "common.server_error")
		return
	}

	nextOffset := 0
	hasMore := offset+len(users) < total
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

func (s *Server) handleAdminUserLoginHistory(c *gin.Context) {
	userID := c.Param("id")
	if userID == "" {
		jsonError(c, http.StatusBadRequest, "common.invalid_input")
		return
	}

	exists, err := s.getUserByID(userID)
	if err != nil {
		jsonError(c, http.StatusInternalServerError, "common.server_error")
		return
	}
	if exists == nil {
		jsonError(c, http.StatusNotFound, "common.not_found")
		return
	}

	limit := 20
	if limitStr := c.Query("limit"); limitStr != "" {
		parsed, err := strconv.Atoi(limitStr)
		if err != nil || parsed <= 0 {
			jsonError(c, http.StatusBadRequest, "common.invalid_input")
			return
		}
		limit = parsed
	}

	records, err := s.listLoginRecords(userID, limit)
	if err != nil {
		jsonError(c, http.StatusInternalServerError, "common.server_error")
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"records": records,
	})
}

func (s *Server) handleAdminUserPasswordUpdate(c *gin.Context) {
	userID := c.Param("id")
	if userID == "" {
		jsonError(c, http.StatusBadRequest, "common.invalid_input")
		return
	}

	var req struct {
		NewPassword string `json:"new_password" binding:"required,min=6"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		jsonError(c, http.StatusBadRequest, "common.invalid_input")
		return
	}

	exists, err := s.getUserByID(userID)
	if err != nil {
		jsonError(c, http.StatusInternalServerError, "common.server_error")
		return
	}
	if exists == nil {
		jsonError(c, http.StatusNotFound, "common.not_found")
		return
	}

	passwordHash, err := hashPassword(req.NewPassword)
	if err != nil {
		jsonError(c, http.StatusInternalServerError, "common.server_error")
		return
	}

	ok, err := s.updateUserPasswordHash(userID, passwordHash)
	if err != nil {
		jsonError(c, http.StatusInternalServerError, "common.server_error")
		return
	}
	if !ok {
		jsonError(c, http.StatusNotFound, "common.not_found")
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "密码已更新",
		"user_id": userID,
	})
}
