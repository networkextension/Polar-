package dock

import (
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// ---------------------------------------------------------------------------
// Request structs
// ---------------------------------------------------------------------------

type latchProfileRequest struct {
	Name          string   `json:"name" binding:"required"`
	Description   string   `json:"description"`
	ProxyGroupIDs []string `json:"proxy_group_ids"`
	RuleGroupID   string   `json:"rule_group_id"`
	Enabled       *bool    `json:"enabled"`
	Shareable     *bool    `json:"shareable"`
}

func buildLatchProfile(req latchProfileRequest) LatchProfile {
	enabled := true
	if req.Enabled != nil {
		enabled = *req.Enabled
	}
	shareable := false
	if req.Shareable != nil {
		shareable = *req.Shareable
	}
	proxyIDs := req.ProxyGroupIDs
	if proxyIDs == nil {
		proxyIDs = []string{}
	}
	// Deduplicate proxy IDs while preserving order.
	seen := make(map[string]bool)
	deduped := make([]string, 0, len(proxyIDs))
	for _, id := range proxyIDs {
		id = strings.TrimSpace(id)
		if id != "" && !seen[id] {
			seen[id] = true
			deduped = append(deduped, id)
		}
	}
	return LatchProfile{
		Name:          strings.TrimSpace(req.Name),
		Description:   strings.TrimSpace(req.Description),
		ProxyGroupIDs: deduped,
		RuleGroupID:   strings.TrimSpace(req.RuleGroupID),
		Enabled:       enabled,
		Shareable:     shareable,
	}
}

// ---------------------------------------------------------------------------
// Admin — Profile CRUD
// ---------------------------------------------------------------------------

// GET /api/latch/admin/profiles
func (s *Server) handleLatchAdminProfileList(c *gin.Context) {
	items, err := s.listLatchProfiles()
	if err != nil {
		log.Printf("latch admin profile list: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"profiles": items})
}

// GET /api/latch/admin/profiles/:id
func (s *Server) handleLatchAdminProfileGet(c *gin.Context) {
	id := strings.TrimSpace(c.Param("id"))
	if id == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的 id"})
		return
	}
	p, err := s.getLatchProfile(id)
	if err != nil {
		log.Printf("latch admin profile get %s: %v", id, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	if p == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "配置不存在"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"profile": p})
}

// POST /api/latch/admin/profiles
func (s *Server) handleLatchAdminProfileCreate(c *gin.Context) {
	var req latchProfileRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的输入数据"})
		return
	}
	if strings.TrimSpace(req.Name) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "name 不能为空"})
		return
	}
	p := buildLatchProfile(req)
	created, err := s.createLatchProfile(p, time.Now())
	if err != nil {
		log.Printf("latch admin profile create: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "创建失败"})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"profile": created, "message": "配置已创建"})
}

// PUT /api/latch/admin/profiles/:id
func (s *Server) handleLatchAdminProfileUpdate(c *gin.Context) {
	id := strings.TrimSpace(c.Param("id"))
	if id == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的 id"})
		return
	}
	var req latchProfileRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的输入数据"})
		return
	}
	if strings.TrimSpace(req.Name) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "name 不能为空"})
		return
	}
	p := buildLatchProfile(req)
	updated, err := s.updateLatchProfile(id, p, time.Now())
	if err != nil {
		log.Printf("latch admin profile update %s: %v", id, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "更新失败"})
		return
	}
	if updated == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "配置不存在"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"profile": updated, "message": "配置已更新"})
}

// DELETE /api/latch/admin/profiles/:id
func (s *Server) handleLatchAdminProfileDelete(c *gin.Context) {
	id := strings.TrimSpace(c.Param("id"))
	if id == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的 id"})
		return
	}
	ok, err := s.deleteLatchProfile(id)
	if err != nil {
		log.Printf("latch admin profile delete %s: %v", id, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "删除失败"})
		return
	}
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "配置不存在"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "配置已删除"})
}

// ---------------------------------------------------------------------------
// User — Get all enabled+shared profiles
// ---------------------------------------------------------------------------

// GET /api/latch/profiles
// Returns all enabled+shareable profiles with resolved proxies and rules (latest versions).
func (s *Server) handleLatchProfileList(c *gin.Context) {
	details, err := s.listSharedLatchProfiles()
	if err != nil {
		log.Printf("latch profile list shared: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"profiles": details})
}
