package dock

import (
	"encoding/json"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// ---------------------------------------------------------------------------
// Request / validation helpers
// ---------------------------------------------------------------------------

type latchProxyRequest struct {
	Name   string          `json:"name" binding:"required"`
	Type   string          `json:"type" binding:"required"`
	Config json.RawMessage `json:"config"`
}

var validLatchProxyTypes = map[string]bool{
	"ss":           true,
	"ss3":          true,
	"kcp_over_http": true,
	"kcp_over_ss":  true,
	"kcp_over_ss3": true,
}

func parseLatchProxyRequest(c *gin.Context) (name, proxyType string, configJSON []byte, ok bool) {
	var req latchProxyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的输入数据"})
		return
	}
	name = strings.TrimSpace(req.Name)
	proxyType = strings.TrimSpace(req.Type)
	if name == "" || proxyType == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "name 和 type 不能为空"})
		return
	}
	if !validLatchProxyTypes[proxyType] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "不支持的代理类型: " + proxyType})
		return
	}
	configJSON = req.Config
	if len(configJSON) == 0 {
		configJSON = []byte(`{}`)
	}
	ok = true
	return
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

// GET /api/latch/proxies — list latest version of every proxy
func (s *Server) handleLatchProxyList(c *gin.Context) {
	items, err := s.listLatchProxies()
	if err != nil {
		log.Printf("latch proxy list: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"proxies": items})
}

// POST /api/latch/proxies — create new proxy
func (s *Server) handleLatchProxyCreate(c *gin.Context) {
	name, proxyType, configJSON, ok := parseLatchProxyRequest(c)
	if !ok {
		return
	}
	created, err := s.createLatchProxy(name, proxyType, configJSON, time.Now())
	if err != nil {
		log.Printf("latch proxy create: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "创建失败"})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"proxy": created, "message": "代理已创建"})
}

// GET /api/latch/proxies/:group_id — latest version
func (s *Server) handleLatchProxyGet(c *gin.Context) {
	groupID := strings.TrimSpace(c.Param("group_id"))
	if groupID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的 group_id"})
		return
	}
	p, err := s.getLatchProxy(groupID)
	if err != nil {
		log.Printf("latch proxy get %s: %v", groupID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	if p == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "代理不存在"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"proxy": p})
}

// PUT /api/latch/proxies/:group_id — update (versioned)
func (s *Server) handleLatchProxyUpdate(c *gin.Context) {
	groupID := strings.TrimSpace(c.Param("group_id"))
	if groupID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的 group_id"})
		return
	}
	name, proxyType, configJSON, ok := parseLatchProxyRequest(c)
	if !ok {
		return
	}
	updated, err := s.updateLatchProxy(groupID, name, proxyType, configJSON, time.Now())
	if err != nil {
		log.Printf("latch proxy update %s: %v", groupID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "更新失败"})
		return
	}
	if updated == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "代理不存在"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"proxy": updated, "message": "代理已更新"})
}

// DELETE /api/latch/proxies/:group_id — delete all versions
func (s *Server) handleLatchProxyDelete(c *gin.Context) {
	groupID := strings.TrimSpace(c.Param("group_id"))
	if groupID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的 group_id"})
		return
	}
	ok, err := s.deleteLatchProxy(groupID)
	if err != nil {
		log.Printf("latch proxy delete %s: %v", groupID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "删除失败"})
		return
	}
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "代理不存在"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "代理已删除"})
}

// GET /api/latch/proxies/:group_id/versions — all versions
func (s *Server) handleLatchProxyVersions(c *gin.Context) {
	groupID := strings.TrimSpace(c.Param("group_id"))
	if groupID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的 group_id"})
		return
	}
	versions, err := s.getLatchProxyVersions(groupID)
	if err != nil {
		log.Printf("latch proxy versions %s: %v", groupID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"versions": versions})
}

// PUT /api/latch/proxies/:group_id/rollback/:version — rollback
func (s *Server) handleLatchProxyRollback(c *gin.Context) {
	groupID := strings.TrimSpace(c.Param("group_id"))
	versionStr := strings.TrimSpace(c.Param("version"))
	if groupID == "" || versionStr == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的参数"})
		return
	}
	version, err := strconv.Atoi(versionStr)
	if err != nil || version < 1 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的版本号"})
		return
	}
	p, err := s.rollbackLatchProxy(groupID, version, time.Now())
	if err != nil {
		log.Printf("latch proxy rollback %s v%d: %v", groupID, version, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "回滚失败"})
		return
	}
	if p == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "目标版本不存在"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"proxy": p, "message": "回滚成功"})
}
