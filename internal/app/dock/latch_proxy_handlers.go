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
	"ss":            true,
	"ss3":           true,
	"kcp_over_http": true,
	"kcp_over_ss":   true,
	"kcp_over_ss3":  true,
	"wireguard":     true,
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

type latchServiceNodeRequest struct {
	Name      string          `json:"name" binding:"required"`
	IP        string          `json:"ip" binding:"required"`
	Port      int             `json:"port" binding:"required"`
	ProxyType string          `json:"proxy_type" binding:"required"`
	Config    json.RawMessage `json:"config"`
	Status    string          `json:"status"`
}

func parseLatchServiceNodeRequest(c *gin.Context) (name, ip string, port int, proxyType string, configJSON []byte, status string, ok bool) {
	var req latchServiceNodeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的输入数据"})
		return
	}

	name = strings.TrimSpace(req.Name)
	ip = strings.TrimSpace(req.IP)
	port = req.Port
	proxyType = strings.TrimSpace(req.ProxyType)
	status = strings.TrimSpace(req.Status)
	if status == "" {
		status = "unknown"
	}
	if name == "" || ip == "" || proxyType == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "name / ip / proxy_type 不能为空"})
		return
	}
	if port <= 0 || port > 65535 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "port 必须在 1-65535"})
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

// GET /api/latch/admin/service-nodes
func (s *Server) handleLatchServiceNodeList(c *gin.Context) {
	includeDeleted := false
	if raw := strings.TrimSpace(c.Query("include_deleted")); raw != "" {
		parsed, err := strconv.ParseBool(raw)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "include_deleted 参数无效"})
			return
		}
		includeDeleted = parsed
	}

	items, err := s.listLatchServiceNodes(includeDeleted)
	if err != nil {
		log.Printf("latch service node list: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"nodes": items})
}

// POST /api/latch/admin/service-nodes
func (s *Server) handleLatchServiceNodeCreate(c *gin.Context) {
	name, ip, port, proxyType, configJSON, status, ok := parseLatchServiceNodeRequest(c)
	if !ok {
		return
	}
	item, err := s.createLatchServiceNode(name, ip, port, proxyType, configJSON, status, time.Now())
	if err != nil {
		log.Printf("latch service node create: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "创建失败"})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"node": item, "message": "服务节点已创建"})
}

// PUT /api/latch/admin/service-nodes/:id
func (s *Server) handleLatchServiceNodeUpdate(c *gin.Context) {
	id := strings.TrimSpace(c.Param("id"))
	if id == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的 id"})
		return
	}
	name, ip, port, proxyType, configJSON, status, ok := parseLatchServiceNodeRequest(c)
	if !ok {
		return
	}
	item, err := s.updateLatchServiceNode(id, name, ip, port, proxyType, configJSON, status, time.Now())
	if err != nil {
		log.Printf("latch service node update %s: %v", id, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "更新失败"})
		return
	}
	if item == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "服务节点不存在"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"node": item, "message": "服务节点已更新"})
}

// DELETE /api/latch/admin/service-nodes/:id
func (s *Server) handleLatchServiceNodeDelete(c *gin.Context) {
	id := strings.TrimSpace(c.Param("id"))
	if id == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的 id"})
		return
	}
	ok, err := s.softDeleteLatchServiceNode(id, time.Now())
	if err != nil {
		log.Printf("latch service node delete %s: %v", id, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "删除失败"})
		return
	}
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "服务节点不存在"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "服务节点已删除"})
}

// POST /api/latch/admin/service-nodes/:id/agent-token
func (s *Server) handleLatchServiceNodeIssueAgentToken(c *gin.Context) {
	nodeID := strings.TrimSpace(c.Param("id"))
	if nodeID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的 id"})
		return
	}
	userID, _ := c.Get("user_id")
	userIDStr, _ := userID.(string)
	token, meta, err := s.issueLatchServiceNodeAgentToken(nodeID, userIDStr, time.Now())
	if err != nil {
		log.Printf("latch service node issue token %s: %v", nodeID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "生成 token 失败"})
		return
	}
	if meta == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "服务节点不存在"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"message": "agent token 已生成（仅显示一次）",
		"token":   token,
		"meta":    meta,
	})
}

type latchAgentRegisterRequest struct {
	AgentVersion string          `json:"agent_version"`
	Hostname     string          `json:"hostname"`
	Status       string          `json:"status"`
	Payload      json.RawMessage `json:"payload"`
}

// POST /api/latch/agent/register
func (s *Server) handleLatchAgentRegister(c *gin.Context) {
	nodeValue, exists := c.Get("agent_node")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	node, ok := nodeValue.(*LatchServiceNode)
	if !ok || node == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var req latchAgentRegisterRequest
	if err := c.ShouldBindJSON(&req); err != nil && err.Error() != "EOF" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid input"})
		return
	}
	status := strings.TrimSpace(req.Status)
	if status == "" {
		status = "up"
	}
	agentVersion := strings.TrimSpace(req.AgentVersion)
	hostname := strings.TrimSpace(req.Hostname)
	payload := req.Payload
	if len(payload) == 0 {
		payload = json.RawMessage(`{}`)
	}
	now := time.Now()
	hb, err := s.appendLatchServiceNodeHeartbeat(node.ID, status, 0, 0, 0, agentVersion, hostname, payload, now, now)
	if err != nil {
		log.Printf("latch agent register %s: %v", node.ID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "register failed"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "registered",
		"node": gin.H{
			"id":         node.ID,
			"name":       node.Name,
			"ip":         node.IP,
			"port":       node.Port,
			"proxy_type": node.ProxyType,
			"config":     node.Config,
			"status":     status,
		},
		"heartbeat": hb,
	})
}

type latchAgentHeartbeatRequest struct {
	Status         string          `json:"status"`
	ConnectedPeers int             `json:"connected_peers"`
	RXBytes        int64           `json:"rx_bytes"`
	TXBytes        int64           `json:"tx_bytes"`
	AgentVersion   string          `json:"agent_version"`
	Hostname       string          `json:"hostname"`
	ReportedAt     string          `json:"reported_at"`
	Payload        json.RawMessage `json:"payload"`
}

// POST /api/latch/agent/heartbeat
func (s *Server) handleLatchAgentHeartbeat(c *gin.Context) {
	nodeIDRaw, exists := c.Get("agent_node_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	nodeID, _ := nodeIDRaw.(string)
	if strings.TrimSpace(nodeID) == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var req latchAgentHeartbeatRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid input"})
		return
	}
	status := strings.TrimSpace(req.Status)
	if status == "" {
		status = "up"
	}
	if req.ConnectedPeers < 0 {
		req.ConnectedPeers = 0
	}
	if req.RXBytes < 0 {
		req.RXBytes = 0
	}
	if req.TXBytes < 0 {
		req.TXBytes = 0
	}

	reportedAt := time.Now()
	if raw := strings.TrimSpace(req.ReportedAt); raw != "" {
		if parsed, err := time.Parse(time.RFC3339, raw); err == nil {
			reportedAt = parsed
		}
	}
	payload := req.Payload
	if len(payload) == 0 {
		payload = json.RawMessage(`{}`)
	}
	hb, err := s.appendLatchServiceNodeHeartbeat(
		nodeID,
		status,
		req.ConnectedPeers,
		req.RXBytes,
		req.TXBytes,
		strings.TrimSpace(req.AgentVersion),
		strings.TrimSpace(req.Hostname),
		payload,
		reportedAt,
		time.Now(),
	)
	if err != nil {
		log.Printf("latch agent heartbeat %s: %v", nodeID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "heartbeat failed"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"message":   "heartbeat accepted",
		"heartbeat": hb,
	})
}
