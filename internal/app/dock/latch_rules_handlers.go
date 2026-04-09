package dock

import (
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// ---------------------------------------------------------------------------
// Handlers — Rules
// ---------------------------------------------------------------------------

// GET /api/latch/rules — list latest version of every rule file
func (s *Server) handleLatchRuleList(c *gin.Context) {
	items, err := s.listLatchRules()
	if err != nil {
		log.Printf("latch rule list: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"rules": items})
}

// POST /api/latch/rules — create rule with inline text body
//
//	{ "name": "...", "content": "..." }
func (s *Server) handleLatchRuleCreate(c *gin.Context) {
	var req struct {
		Name    string `json:"name" binding:"required"`
		Content string `json:"content"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的输入数据"})
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "name 不能为空"})
		return
	}
	created, err := s.createLatchRule(req.Name, req.Content, time.Now())
	if err != nil {
		log.Printf("latch rule create: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "创建失败"})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"rule": created, "message": "规则已创建"})
}

// POST /api/latch/rules/upload — create rule from uploaded text file
func (s *Server) handleLatchRuleCreateUpload(c *gin.Context) {
	name := strings.TrimSpace(c.PostForm("name"))
	if name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "name 不能为空"})
		return
	}

	file, _, err := c.Request.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "缺少 file 字段"})
		return
	}
	defer file.Close()

	rawBytes, err := io.ReadAll(io.LimitReader(file, 10<<20)) // 10 MB limit
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "读取文件失败"})
		return
	}
	content := string(rawBytes)

	created, err := s.createLatchRule(name, content, time.Now())
	if err != nil {
		log.Printf("latch rule create upload: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "创建失败"})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"rule": created, "message": "规则已上传创建"})
}

// GET /api/latch/rules/:group_id — latest version
func (s *Server) handleLatchRuleGet(c *gin.Context) {
	groupID := strings.TrimSpace(c.Param("group_id"))
	if groupID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的 group_id"})
		return
	}
	r, err := s.getLatchRule(groupID)
	if err != nil {
		log.Printf("latch rule get %s: %v", groupID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	if r == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "规则不存在"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"rule": r})
}

// GET /api/latch/rules/:group_id/content — download raw text content
func (s *Server) handleLatchRuleContent(c *gin.Context) {
	groupID := strings.TrimSpace(c.Param("group_id"))
	if groupID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的 group_id"})
		return
	}
	r, err := s.getLatchRule(groupID)
	if err != nil {
		log.Printf("latch rule content %s: %v", groupID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	if r == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "规则不存在"})
		return
	}
	c.Header("Content-Type", "text/plain; charset=utf-8")
	c.Header("Content-Disposition", `attachment; filename="`+r.Name+`"`)
	c.String(http.StatusOK, r.Content)
}

// PUT /api/latch/rules/:group_id — inline edit (versioned)
//
//	{ "name": "...", "content": "..." }
func (s *Server) handleLatchRuleUpdate(c *gin.Context) {
	groupID := strings.TrimSpace(c.Param("group_id"))
	if groupID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的 group_id"})
		return
	}
	var req struct {
		Name    string `json:"name" binding:"required"`
		Content string `json:"content"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的输入数据"})
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "name 不能为空"})
		return
	}
	updated, err := s.updateLatchRule(groupID, req.Name, req.Content, time.Now())
	if err != nil {
		log.Printf("latch rule update %s: %v", groupID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "更新失败"})
		return
	}
	if updated == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "规则不存在"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"rule": updated, "message": "规则已更新"})
}

// POST /api/latch/rules/:group_id/upload — update rule via file upload (versioned)
func (s *Server) handleLatchRuleUpload(c *gin.Context) {
	groupID := strings.TrimSpace(c.Param("group_id"))
	if groupID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的 group_id"})
		return
	}

	name := strings.TrimSpace(c.PostForm("name"))

	file, _, err := c.Request.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "缺少 file 字段"})
		return
	}
	defer file.Close()

	rawBytes, err := io.ReadAll(io.LimitReader(file, 10<<20))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "读取文件失败"})
		return
	}
	content := string(rawBytes)

	// If no name provided in form, keep the existing name.
	if name == "" {
		current, err := s.getLatchRule(groupID)
		if err != nil || current == nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "规则不存在"})
			return
		}
		name = current.Name
	}

	updated, err := s.updateLatchRule(groupID, name, content, time.Now())
	if err != nil {
		log.Printf("latch rule upload %s: %v", groupID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "更新失败"})
		return
	}
	if updated == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "规则不存在"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"rule": updated, "message": "规则已上传更新"})
}

// DELETE /api/latch/rules/:group_id
func (s *Server) handleLatchRuleDelete(c *gin.Context) {
	groupID := strings.TrimSpace(c.Param("group_id"))
	if groupID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的 group_id"})
		return
	}
	ok, err := s.deleteLatchRule(groupID)
	if err != nil {
		log.Printf("latch rule delete %s: %v", groupID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "删除失败"})
		return
	}
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "规则不存在"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "规则已删除"})
}

// GET /api/latch/rules/:group_id/versions
func (s *Server) handleLatchRuleVersions(c *gin.Context) {
	groupID := strings.TrimSpace(c.Param("group_id"))
	if groupID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的 group_id"})
		return
	}
	versions, err := s.getLatchRuleVersions(groupID)
	if err != nil {
		log.Printf("latch rule versions %s: %v", groupID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"versions": versions})
}

// PUT /api/latch/rules/:group_id/rollback/:version
func (s *Server) handleLatchRuleRollback(c *gin.Context) {
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
	r, err := s.rollbackLatchRule(groupID, version, time.Now())
	if err != nil {
		log.Printf("latch rule rollback %s v%d: %v", groupID, version, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "回滚失败"})
		return
	}
	if r == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "目标版本不存在"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"rule": r, "message": "回滚成功"})
}
