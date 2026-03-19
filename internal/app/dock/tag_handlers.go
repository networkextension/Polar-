package dock

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/lib/pq"
)

func (s *Server) handleTagCreate(c *gin.Context) {
	var req struct {
		Name        string `json:"name" binding:"required"`
		Slug        string `json:"slug"`
		Description string `json:"description"`
		SortOrder   int    `json:"sort_order"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的输入数据"})
		return
	}

	slug := normalizeTagSlug(req.Slug)
	if slug == "" {
		slug = normalizeTagSlug(req.Name)
	}
	if slug == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的标签标识"})
		return
	}

	tag := &Tag{
		Name:        strings.TrimSpace(req.Name),
		Slug:        slug,
		Description: strings.TrimSpace(req.Description),
		SortOrder:   req.SortOrder,
	}

	created, err := s.createTag(tag)
	if err != nil {
		var pgErr *pq.Error
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			c.JSON(http.StatusConflict, gin.H{"error": "标签标识已存在"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"message": "创建成功",
		"tag":     created,
	})
}

func (s *Server) handleTagList(c *gin.Context) {
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

	tags, hasMore, err := s.listTags(limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}

	nextOffset := offset + len(tags)
	c.JSON(http.StatusOK, gin.H{
		"tags":        tags,
		"has_more":    hasMore,
		"next_offset": nextOffset,
	})
}

func (s *Server) handleTagUpdate(c *gin.Context) {
	tagID, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || tagID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的输入数据"})
		return
	}

	var req struct {
		Name        string `json:"name" binding:"required"`
		Slug        string `json:"slug"`
		Description string `json:"description"`
		SortOrder   int    `json:"sort_order"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的输入数据"})
		return
	}

	slug := normalizeTagSlug(req.Slug)
	if slug == "" {
		slug = normalizeTagSlug(req.Name)
	}
	if slug == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的标签标识"})
		return
	}

	if err := s.updateTag(
		tagID,
		strings.TrimSpace(req.Name),
		slug,
		strings.TrimSpace(req.Description),
		req.SortOrder,
	); err != nil {
		var pgErr *pq.Error
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			c.JSON(http.StatusConflict, gin.H{"error": "标签标识已存在"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "更新成功",
		"id":      tagID,
	})
}

func (s *Server) handleTagDelete(c *gin.Context) {
	tagID, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || tagID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的输入数据"})
		return
	}

	if err := s.deleteTag(tagID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "删除成功"})
}
