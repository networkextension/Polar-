package dock

// HTTP handlers for the video-studio module. All handlers verify the
// session user owns the project before touching shots / assets / render.
// Background work (provider polling and ffmpeg rendering) is delegated to
// the workers in video_poll_worker.go and video_render.go; these handlers
// only persist state and enqueue.

import (
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

const (
	videoAssetMaxFileSize = int64(50 << 20) // 50 MB; voiceovers and BGM rarely need more
)

// requireUserID is a tiny shared guard that pulls the session user id from
// the gin context the auth middleware sets. Returns ("", false) and writes
// a 500 if the context is malformed (would indicate a middleware misorder
// rather than a user error).
func requireUserID(c *gin.Context) (string, bool) {
	v, _ := c.Get("user_id")
	id, ok := v.(string)
	if !ok || id == "" {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return "", false
	}
	return id, true
}

func parseInt64Param(c *gin.Context, name string) (int64, bool) {
	raw := c.Param(name)
	id, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的输入数据"})
		return 0, false
	}
	return id, true
}

// ---- Video LLM config picker ---------------------------------------------

// handleVideoLLMConfigList returns video-kind configs the user can use.
// The chat module has its own bot picker; this is the parallel path for
// the video studio so the two don't interfere.
func (s *Server) handleVideoLLMConfigList(c *gin.Context) {
	userID, ok := requireUserID(c)
	if !ok {
		return
	}
	configs, err := s.listVideoLLMConfigsForUser(userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"configs": configs})
}

// ---- Project CRUD ---------------------------------------------------------

func (s *Server) handleVideoProjectList(c *gin.Context) {
	userID, ok := requireUserID(c)
	if !ok {
		return
	}
	projects, err := s.listVideoProjects(userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"projects": projects})
}

type videoProjectCreateRequest struct {
	Title              string `json:"title"`
	DefaultLLMConfigID *int64 `json:"default_llm_config_id"`
}

func (s *Server) handleVideoProjectCreate(c *gin.Context) {
	userID, ok := requireUserID(c)
	if !ok {
		return
	}
	var req videoProjectCreateRequest
	_ = c.ShouldBindJSON(&req)
	title := strings.TrimSpace(req.Title)
	if title == "" {
		title = "Untitled video"
	}
	// If a default config was supplied, make sure it's video-kind and
	// owned/shared with the user before saving.
	if req.DefaultLLMConfigID != nil && *req.DefaultLLMConfigID > 0 {
		cfg, _, err := s.getVideoLLMConfigWithAPIKey(userID, *req.DefaultLLMConfigID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
			return
		}
		if cfg == nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "选择的视频配置无效"})
			return
		}
	}
	project, err := s.createVideoProject(userID, title, req.DefaultLLMConfigID, time.Now())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"project": project})
}

func (s *Server) handleVideoProjectDetail(c *gin.Context) {
	userID, ok := requireUserID(c)
	if !ok {
		return
	}
	id, ok := parseInt64Param(c, "id")
	if !ok {
		return
	}
	project, err := s.getVideoProject(userID, id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	if project == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "项目不存在"})
		return
	}
	shots, err := s.listVideoShotsForProject(project.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	assets, err := s.listVideoAssetsForProject(project.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"project": project,
		"shots":   shots,
		"assets":  assets,
	})
}

type videoProjectUpdateRequest struct {
	Title              *string `json:"title"`
	DefaultLLMConfigID *int64  `json:"default_llm_config_id"`
}

func (s *Server) handleVideoProjectUpdate(c *gin.Context) {
	userID, ok := requireUserID(c)
	if !ok {
		return
	}
	id, ok := parseInt64Param(c, "id")
	if !ok {
		return
	}
	existing, err := s.getVideoProject(userID, id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	if existing == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "项目不存在"})
		return
	}
	var req videoProjectUpdateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的输入数据"})
		return
	}
	title := existing.Title
	if req.Title != nil {
		title = strings.TrimSpace(*req.Title)
		if title == "" {
			title = existing.Title
		}
	}
	defaultCfg := existing.DefaultLLMConfigID
	if req.DefaultLLMConfigID != nil {
		if *req.DefaultLLMConfigID > 0 {
			cfg, _, err := s.getVideoLLMConfigWithAPIKey(userID, *req.DefaultLLMConfigID)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
				return
			}
			if cfg == nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": "选择的视频配置无效"})
				return
			}
			defaultCfg = req.DefaultLLMConfigID
		} else {
			defaultCfg = nil
		}
	}
	project, err := s.updateVideoProject(userID, id, title, defaultCfg, time.Now())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"project": project})
}

func (s *Server) handleVideoProjectDelete(c *gin.Context) {
	userID, ok := requireUserID(c)
	if !ok {
		return
	}
	id, ok := parseInt64Param(c, "id")
	if !ok {
		return
	}
	deleted, err := s.deleteVideoProject(userID, id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	if !deleted {
		c.JSON(http.StatusNotFound, gin.H{"error": "项目不存在"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ---- Shot CRUD ------------------------------------------------------------

type videoShotCreateRequest struct {
	Prompt        string `json:"prompt"`
	Ratio         string `json:"ratio"`
	Duration      int    `json:"duration"`
	GenerateAudio *bool  `json:"generate_audio"`
	Watermark     *bool  `json:"watermark"`
	LLMConfigID   *int64 `json:"llm_config_id"`
}

func (s *Server) handleVideoShotCreate(c *gin.Context) {
	userID, ok := requireUserID(c)
	if !ok {
		return
	}
	id, ok := parseInt64Param(c, "id")
	if !ok {
		return
	}
	project, err := s.getVideoProject(userID, id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	if project == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "项目不存在"})
		return
	}
	var req videoShotCreateRequest
	_ = c.ShouldBindJSON(&req)
	if strings.TrimSpace(req.Prompt) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Prompt 不能为空"})
		return
	}
	defaults := SeedanceDefaults()
	ratio := req.Ratio
	if ratio == "" {
		ratio = defaults.Ratio
	}
	duration := req.Duration
	if duration <= 0 {
		duration = defaults.Duration
	}
	genAudio := defaults.GenerateAudio
	if req.GenerateAudio != nil {
		genAudio = *req.GenerateAudio
	}
	watermark := defaults.Watermark
	if req.Watermark != nil {
		watermark = *req.Watermark
	}
	cfgID := req.LLMConfigID
	if cfgID == nil {
		cfgID = project.DefaultLLMConfigID
	}
	// Resolve next ord by counting existing shots (cheap, len()-based; we
	// don't need a max() query because shots are append-only on this path).
	existing, err := s.listVideoShotsForProject(project.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	nextOrd := 0
	for _, sh := range existing {
		if sh.Ord >= nextOrd {
			nextOrd = sh.Ord + 1
		}
	}
	shot, err := s.createVideoShot(CreateVideoShotInput{
		ProjectID:     project.ID,
		Ord:           nextOrd,
		Prompt:        strings.TrimSpace(req.Prompt),
		Ratio:         ratio,
		Duration:      duration,
		GenerateAudio: genAudio,
		Watermark:     watermark,
		LLMConfigID:   cfgID,
	}, time.Now())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"shot": shot})
}

type videoShotUpdateRequest struct {
	Prompt        *string `json:"prompt"`
	Ratio         *string `json:"ratio"`
	Duration      *int    `json:"duration"`
	GenerateAudio *bool   `json:"generate_audio"`
	Watermark     *bool   `json:"watermark"`
	Ord           *int    `json:"ord"`
	LLMConfigID   *int64  `json:"llm_config_id"`
	TrimStartMs   *int    `json:"trim_start_ms"`
	TrimEndMs     *int    `json:"trim_end_ms"`
}

func (s *Server) handleVideoShotUpdate(c *gin.Context) {
	userID, ok := requireUserID(c)
	if !ok {
		return
	}
	projectID, ok := parseInt64Param(c, "id")
	if !ok {
		return
	}
	shotID, ok := parseInt64Param(c, "shotId")
	if !ok {
		return
	}
	project, err := s.getVideoProject(userID, projectID)
	if err != nil || project == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "项目不存在"})
		return
	}
	var req videoShotUpdateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的输入数据"})
		return
	}
	in := UpdateVideoShotInput{
		Prompt:        req.Prompt,
		Ratio:         req.Ratio,
		Duration:      req.Duration,
		GenerateAudio: req.GenerateAudio,
		Watermark:     req.Watermark,
		Ord:           req.Ord,
		LLMConfigID:   req.LLMConfigID,
		TrimStartMs:   req.TrimStartMs,
		TrimEndMs:     req.TrimEndMs,
	}
	shot, err := s.updateVideoShotFields(project.ID, shotID, in, time.Now())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	if shot == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "镜头不存在"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"shot": shot})
}

// handleVideoShotDuplicate copies an existing shot's prompt + params into a
// new pending shot at the end of the project. Mode-1 iteration helper:
// "make a tweaked variant" without retyping. The new row's task_id is empty
// and its status is pending so the user must explicitly Submit it before
// it costs a provider call.
func (s *Server) handleVideoShotDuplicate(c *gin.Context) {
	userID, ok := requireUserID(c)
	if !ok {
		return
	}
	projectID, ok := parseInt64Param(c, "id")
	if !ok {
		return
	}
	shotID, ok := parseInt64Param(c, "shotId")
	if !ok {
		return
	}
	project, err := s.getVideoProject(userID, projectID)
	if err != nil || project == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "项目不存在"})
		return
	}
	src, err := s.getVideoShot(project.ID, shotID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	if src == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "镜头不存在"})
		return
	}
	siblings, err := s.listVideoShotsForProject(project.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	nextOrd := 0
	for _, sh := range siblings {
		if sh.Ord >= nextOrd {
			nextOrd = sh.Ord + 1
		}
	}
	clone, err := s.createVideoShot(CreateVideoShotInput{
		ProjectID:     project.ID,
		Ord:           nextOrd,
		Prompt:        src.Prompt,
		Ratio:         src.Ratio,
		Duration:      src.Duration,
		GenerateAudio: src.GenerateAudio,
		Watermark:     src.Watermark,
		LLMConfigID:   src.LLMConfigID,
		TrimStartMs:   src.TrimStartMs,
		TrimEndMs:     src.TrimEndMs,
	}, time.Now())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"shot": clone})
}

func (s *Server) handleVideoShotDelete(c *gin.Context) {
	userID, ok := requireUserID(c)
	if !ok {
		return
	}
	projectID, ok := parseInt64Param(c, "id")
	if !ok {
		return
	}
	shotID, ok := parseInt64Param(c, "shotId")
	if !ok {
		return
	}
	project, err := s.getVideoProject(userID, projectID)
	if err != nil || project == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "项目不存在"})
		return
	}
	deleted, err := s.deleteVideoShot(project.ID, shotID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	if !deleted {
		c.JSON(http.StatusNotFound, gin.H{"error": "镜头不存在"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ---- Shot submission ------------------------------------------------------

func (s *Server) submitShotToProvider(userID string, project *VideoProject, shot *VideoShot) error {
	cfgID := shot.LLMConfigID
	if cfgID == nil {
		cfgID = project.DefaultLLMConfigID
	}
	if cfgID == nil || *cfgID <= 0 {
		return errors.New("未选择视频生成配置")
	}
	cfg, apiKey, err := s.getVideoLLMConfigWithAPIKey(userID, *cfgID)
	if err != nil {
		return err
	}
	if cfg == nil {
		return errors.New("视频配置不存在或无权使用")
	}
	if strings.TrimSpace(apiKey) == "" {
		return errors.New("视频配置缺少 API Key")
	}
	override := SeedanceParams{
		Ratio:         shot.Ratio,
		Duration:      shot.Duration,
		GenerateAudio: shot.GenerateAudio,
		Watermark:     shot.Watermark,
	}
	taskID, err := s.videoProvider.submitVideoTask(s.videoProviderCtx, cfg, apiKey, shot.Prompt, override)
	if err != nil {
		return err
	}
	if err := s.markVideoShotSubmitted(shot.ID, taskID, time.Now()); err != nil {
		return err
	}
	return nil
}

func (s *Server) handleVideoShotSubmit(c *gin.Context) {
	userID, ok := requireUserID(c)
	if !ok {
		return
	}
	projectID, ok := parseInt64Param(c, "id")
	if !ok {
		return
	}
	shotID, ok := parseInt64Param(c, "shotId")
	if !ok {
		return
	}
	project, err := s.getVideoProject(userID, projectID)
	if err != nil || project == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "项目不存在"})
		return
	}
	shot, err := s.getVideoShot(project.ID, shotID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	if shot == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "镜头不存在"})
		return
	}
	if err := s.submitShotToProvider(userID, project, shot); err != nil {
		_ = s.markVideoShotStatus(shot.ID, VideoShotStatusFailed, "", err.Error(), time.Now())
		s.broadcastVideoShotEvent(project, shot.ID, VideoShotStatusFailed, "", err.Error())
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	s.broadcastVideoShotEvent(project, shot.ID, VideoShotStatusQueued, "", "")
	updated, _ := s.getVideoShot(project.ID, shot.ID)
	c.JSON(http.StatusOK, gin.H{"shot": updated})
}

func (s *Server) handleVideoShotRetry(c *gin.Context) {
	// Same flow as submit; the markVideoShotSubmitted helper resets
	// task_id + clears any stale error_message on re-entry.
	s.handleVideoShotSubmit(c)
}

// handleVideoProjectSubmitAll kicks off submission of every pending/failed
// shot in the project and returns immediately. The actual submissions run
// in a background goroutine so a 10-shot script doesn't block the HTTP
// request for ~20s (provider rate-limit pacing × N). Status flows back to
// the UI via WS broadcasts as each shot lands in the queued state.
func (s *Server) handleVideoProjectSubmitAll(c *gin.Context) {
	userID, ok := requireUserID(c)
	if !ok {
		return
	}
	projectID, ok := parseInt64Param(c, "id")
	if !ok {
		return
	}
	project, err := s.getVideoProject(userID, projectID)
	if err != nil || project == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "项目不存在"})
		return
	}
	shots, err := s.listVideoShotsForProject(project.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	pending := make([]VideoShot, 0, len(shots))
	pendingIDs := make([]int64, 0, len(shots))
	for i := range shots {
		shot := shots[i]
		// Only auto-submit shots that haven't been sent yet OR that previously
		// failed — succeeded/queued/running shots are left alone so the user
		// doesn't accidentally re-bill themselves for an in-flight task.
		if shot.Status != VideoShotStatusPending && shot.Status != VideoShotStatusFailed {
			continue
		}
		pending = append(pending, shot)
		pendingIDs = append(pendingIDs, shot.ID)
	}
	if len(pending) == 0 {
		c.JSON(http.StatusOK, gin.H{
			"queued":    0,
			"shot_ids":  pendingIDs,
			"async":     true,
		})
		return
	}
	go s.runSubmitAllInBackground(userID, project.ID, pending)
	c.JSON(http.StatusAccepted, gin.H{
		"queued":   len(pending),
		"shot_ids": pendingIDs,
		"async":    true,
	})
}

// runSubmitAllInBackground iterates the pre-filtered shot list and submits
// each one with a 2-second pause between calls (mirrors the bash script's
// sleep 2 to dodge per-account rate limits). After every state transition
// we broadcast a shot_status WS event so the studio page reflects progress
// in real time without polling. The function takes a fresh copy of the
// project pointer per shot so a concurrent rename or default-config swap
// doesn't poison submissions mid-run.
func (s *Server) runSubmitAllInBackground(userID string, projectID int64, shots []VideoShot) {
	for i := range shots {
		shot := shots[i]
		// Re-load the project on every iteration so a default-config swap
		// during the run is honored, and so a deletion mid-run aborts the
		// remaining submissions instead of erroring on each one.
		project, err := s.getVideoProjectByID(projectID)
		if err != nil || project == nil {
			return
		}
		if project.OwnerUserID != userID {
			return
		}
		if err := s.submitShotToProvider(userID, project, &shot); err != nil {
			_ = s.markVideoShotStatus(shot.ID, VideoShotStatusFailed, "", err.Error(), time.Now())
			s.broadcastVideoShotEvent(project, shot.ID, VideoShotStatusFailed, "", err.Error())
		} else {
			s.broadcastVideoShotEvent(project, shot.ID, VideoShotStatusQueued, "", "")
		}
		if i < len(shots)-1 {
			time.Sleep(2 * time.Second)
		}
	}
}

// ---- Asset upload + tweak --------------------------------------------------

var allowedAudioMimePrefix = "audio/"

func (s *Server) handleVideoAssetUpload(c *gin.Context) {
	userID, ok := requireUserID(c)
	if !ok {
		return
	}
	projectID, ok := parseInt64Param(c, "id")
	if !ok {
		return
	}
	project, err := s.getVideoProject(userID, projectID)
	if err != nil || project == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "项目不存在"})
		return
	}
	kind := strings.TrimSpace(c.Query("kind"))
	if kind != VideoAssetKindBGM && kind != VideoAssetKindVoiceover {
		c.JSON(http.StatusBadRequest, gin.H{"error": "kind 必须是 audio_bgm 或 voiceover"})
		return
	}
	if s.uploadDir == "" {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "上传目录未配置"})
		return
	}
	file, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请选择要上传的文件"})
		return
	}
	if file.Size > videoAssetMaxFileSize {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("文件大小超过限制（最大 %d MB）", videoAssetMaxFileSize>>20)})
		return
	}
	mimeType := file.Header.Get("Content-Type")
	if !strings.HasPrefix(mimeType, allowedAudioMimePrefix) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "仅支持音频文件"})
		return
	}
	if err := os.MkdirAll(s.uploadDir, 0o755); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	filename := "video_" + buildUploadFilename(file.Filename)
	dstPath := filepath.Join(s.uploadDir, filename)
	if err := c.SaveUploadedFile(file, dstPath); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "文件保存失败"})
		return
	}
	publicURL, err := s.chatStorage.Store(c.Request.Context(), dstPath, filename, mimeType)
	if err != nil {
		removeLocalFile(dstPath)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "文件上传失败"})
		return
	}
	asset, err := s.createVideoAsset(CreateVideoAssetInput{
		ProjectID: project.ID,
		Kind:      kind,
		URL:       publicURL,
		FileName:  file.Filename,
		MimeType:  mimeType,
		Size:      file.Size,
	}, time.Now())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"asset": asset})
}

type videoAssetUpdateRequest struct {
	BGMVolume   *float64 `json:"bgm_volume"`
	VoiceVolume *float64 `json:"voice_volume"`
}

func (s *Server) handleVideoAssetUpdate(c *gin.Context) {
	userID, ok := requireUserID(c)
	if !ok {
		return
	}
	projectID, ok := parseInt64Param(c, "id")
	if !ok {
		return
	}
	assetID, ok := parseInt64Param(c, "assetId")
	if !ok {
		return
	}
	project, err := s.getVideoProject(userID, projectID)
	if err != nil || project == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "项目不存在"})
		return
	}
	var req videoAssetUpdateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的输入数据"})
		return
	}
	asset, err := s.updateVideoAssetVolumes(project.ID, assetID, req.BGMVolume, req.VoiceVolume)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	if asset == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "音频不存在"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"asset": asset})
}

func (s *Server) handleVideoAssetDelete(c *gin.Context) {
	userID, ok := requireUserID(c)
	if !ok {
		return
	}
	projectID, ok := parseInt64Param(c, "id")
	if !ok {
		return
	}
	assetID, ok := parseInt64Param(c, "assetId")
	if !ok {
		return
	}
	project, err := s.getVideoProject(userID, projectID)
	if err != nil || project == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "项目不存在"})
		return
	}
	deleted, err := s.deleteVideoAsset(project.ID, assetID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	if !deleted {
		c.JSON(http.StatusNotFound, gin.H{"error": "音频不存在"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ---- Render ---------------------------------------------------------------

func (s *Server) handleVideoProjectRender(c *gin.Context) {
	userID, ok := requireUserID(c)
	if !ok {
		return
	}
	projectID, ok := parseInt64Param(c, "id")
	if !ok {
		return
	}
	project, err := s.getVideoProject(userID, projectID)
	if err != nil || project == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "项目不存在"})
		return
	}
	shots, err := s.listVideoShotsForProject(project.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	hasReady := false
	for _, sh := range shots {
		if sh.Status == VideoShotStatusSucceeded && sh.VideoURL != "" {
			hasReady = true
			break
		}
	}
	if !hasReady {
		c.JSON(http.StatusBadRequest, gin.H{"error": "尚无可合成的镜头，请先生成至少一个成功的镜头"})
		return
	}
	now := time.Now()
	if err := s.updateVideoProjectStatus(project.ID, VideoProjectStatusRendering, "", "", now); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	if err := s.enqueueVideoRender(project.ID); err != nil {
		_ = s.updateVideoProjectStatus(project.ID, VideoProjectStatusFailed, "", err.Error(), time.Now())
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusAccepted, gin.H{"ok": true})
}

func (s *Server) handleVideoProjectDownload(c *gin.Context) {
	userID, ok := requireUserID(c)
	if !ok {
		return
	}
	projectID, ok := parseInt64Param(c, "id")
	if !ok {
		return
	}
	project, err := s.getVideoProject(userID, projectID)
	if err != nil || project == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "项目不存在"})
		return
	}
	if project.FinalVideoURL == "" {
		c.JSON(http.StatusNotFound, gin.H{"error": "尚无最终视频"})
		return
	}
	c.Redirect(http.StatusFound, project.FinalVideoURL)
}
