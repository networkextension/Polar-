package dock

// HTTP handlers for the App Store Connect bridge.
//
// Five endpoints; all owner-scoped:
//   GET    /api/iosdist/asc/config                  → status (no secrets in body)
//   POST   /api/iosdist/asc/config                  → multipart: issuer_id, key_id, p8 file
//   DELETE /api/iosdist/asc/config                  → wipe
//   GET    /api/iosdist/asc/apps?bundle_id=…        → forward to ASC for the picker
//   GET    /api/iosdist/asc/beta-groups?asc_app_id= → forward to ASC for the picker
//   PUT    /api/iosdist/apps/:id/asc-binding        → set asc_app_id + asc_beta_group_id
//   POST   /api/iosdist/apps/:id/invite-tester      → email invite, ASC handles the email send

import (
	"fmt"
	"io"
	"log"
	"net/http"
	"net/mail"
	"os"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"
)

// ---- Config CRUD ---------------------------------------------------------

func (s *Server) handleIOSASCConfigGet(c *gin.Context) {
	userID, ok := requireUserID(c)
	if !ok {
		return
	}
	cfg, err := s.getIOSASCConfig(userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	if cfg == nil {
		c.JSON(http.StatusOK, gin.H{
			"configured":       false,
			"encryption_ready": len(s.iosdistResourceKey) == iosdistResourceKeyBytes,
		})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"configured":       true,
		"config":           cfg,
		"encryption_ready": len(s.iosdistResourceKey) == iosdistResourceKeyBytes,
	})
}

func (s *Server) handleIOSASCConfigUpsert(c *gin.Context) {
	userID, ok := requireUserID(c)
	if !ok {
		return
	}
	issuer := sanitizeASCIDInput(c.PostForm("issuer_id"))
	keyID := sanitizeASCIDInput(c.PostForm("key_id"))
	if issuer == "" || keyID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Issuer ID 与 Key ID 不能为空"})
		return
	}
	// Apple Key IDs are 10 alphanumeric chars; if anything snuck through
	// after sanitize (e.g. zero-width chars), reject loudly so the user
	// fixes the paste rather than ending up with a silent 401 later.
	if len(keyID) != 10 {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": fmt.Sprintf("Key ID 必须是 10 位字符（实际 %d 位）。检查复制时是否带了多余的引号 / 空格 / 冒号。", len(keyID)),
		})
		return
	}
	file, err := c.FormFile("p8")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请选择 .p8 私钥文件"})
		return
	}
	if file.Size > int64(64<<10) { // 64 KiB — Apple p8 files are ~250 bytes
		c.JSON(http.StatusBadRequest, gin.H{"error": "p8 文件过大"})
		return
	}
	src, err := file.Open()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "文件读取失败"})
		return
	}
	defer src.Close()
	// io.ReadAll guarantees all bytes are consumed regardless of how
	// the underlying multipart.File chunks reads. Cap is paranoid.
	pemBytes, err := io.ReadAll(io.LimitReader(src, int64(64<<10)))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "文件读取失败"})
		return
	}
	if len(pemBytes) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": ".p8 文件为空"})
		return
	}

	// Sanity-check the PEM by parsing through the same code path the
	// ASC client would. This way a bad upload fails fast with a clear
	// 400 instead of silently breaking later invite calls.
	probe := &IOSASCConfig{p8Cipher: string(pemBytes)}
	if _, _, err := s.loadASCConfigPrivateKey(probe); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "p8 解析失败：" + err.Error()})
		return
	}

	cipher, encrypted, err := s.encryptIOSDistSecret(string(pemBytes))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "p8 加密失败"})
		return
	}
	stored := cipher
	if !encrypted {
		stored = string(pemBytes)
	}

	cfg := &IOSASCConfig{
		OwnerUserID: userID,
		IssuerID:    issuer,
		KeyID:       keyID,
		P8Filename:  file.Filename,
		P8Encrypted: encrypted,
		p8Cipher:    stored,
	}
	if err := s.upsertIOSASCConfig(cfg); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}

	// Best-effort: pull the team's account holder email so the topbar
	// pill can show "ASC 已配置 · me@example.com". Failures here just
	// mean the email stays empty — the config itself is already saved
	// and the operator can re-trigger via re-upload.
	if users, err := s.ascListUsers(c.Request.Context(), cfg); err == nil {
		email := ascAccountHolderEmail(users)
		log.Printf("[iosdist asc-config] user=%s saved config; resolved account holder email=%q (%d users total)", userID, email, len(users))
		if email != "" {
			if dbErr := s.setIOSASCConfigAccountInfo(userID, email, ""); dbErr == nil {
				cfg.AccountHolderEmail = email
			}
		}
	} else {
		log.Printf("[iosdist asc-config] user=%s saved config but ascListUsers failed: %v", userID, err)
	}

	c.JSON(http.StatusOK, gin.H{"config": cfg})
}

func (s *Server) handleIOSASCConfigDelete(c *gin.Context) {
	userID, ok := requireUserID(c)
	if !ok {
		return
	}
	if err := s.deleteIOSASCConfig(userID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ---- Discovery helpers ---------------------------------------------------

func (s *Server) handleIOSASCAppList(c *gin.Context) {
	userID, ok := requireUserID(c)
	if !ok {
		return
	}
	cfg, _ := s.requireASCConfig(c, userID)
	if cfg == nil {
		return
	}
	bundleID := strings.TrimSpace(c.Query("bundle_id"))
	log.Printf("[iosdist asc-apps] user=%s issuer=%s key_id=%s bundle_id=%q", userID, cfg.IssuerID, cfg.KeyID, bundleID)
	apps, err := s.ascListApps(c.Request.Context(), cfg, bundleID)
	if err != nil {
		log.Printf("[iosdist asc-apps] user=%s ascListApps failed: %v", userID, err)
		s.respondASCError(c, err)
		return
	}
	log.Printf("[iosdist asc-apps] user=%s ascListApps ok: %d match(es)", userID, len(apps))
	c.JSON(http.StatusOK, gin.H{"apps": apps})
}

func (s *Server) handleIOSASCBetaGroupList(c *gin.Context) {
	userID, ok := requireUserID(c)
	if !ok {
		return
	}
	cfg, _ := s.requireASCConfig(c, userID)
	if cfg == nil {
		return
	}
	groups, err := s.ascListBetaGroups(c.Request.Context(), cfg, strings.TrimSpace(c.Query("asc_app_id")))
	if err != nil {
		s.respondASCError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"beta_groups": groups})
}

// ---- Per-app binding + invite -------------------------------------------

type iosASCBindingRequest struct {
	ASCAppID       string `json:"asc_app_id"`
	ASCBetaGroupID string `json:"asc_beta_group_id"`
}

func (s *Server) handleIOSAppASCBindingUpdate(c *gin.Context) {
	userID, ok := requireUserID(c)
	if !ok {
		return
	}
	id, ok := parseInt64Param(c, "id")
	if !ok {
		return
	}
	app, err := s.getIOSApp(id, userID)
	if err != nil || app == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "应用不存在"})
		return
	}
	var req iosASCBindingRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的输入数据"})
		return
	}
	if err := s.setIOSAppASCBinding(app.ID, userID, strings.TrimSpace(req.ASCAppID), strings.TrimSpace(req.ASCBetaGroupID)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	updated, _ := s.getIOSApp(app.ID, userID)
	c.JSON(http.StatusOK, gin.H{"app": updated})
}

type iosASCInviteRequest struct {
	Email     string `json:"email"`
	FirstName string `json:"first_name"`
	LastName  string `json:"last_name"`
}

func (s *Server) handleIOSAppInviteTester(c *gin.Context) {
	userID, ok := requireUserID(c)
	if !ok {
		return
	}
	id, ok := parseInt64Param(c, "id")
	if !ok {
		return
	}
	app, err := s.getIOSApp(id, userID)
	if err != nil || app == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "应用不存在"})
		return
	}
	if app.ASCBetaGroupID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "尚未绑定 ASC Beta Group，请先在「App Store Connect 集成」配置"})
		return
	}
	cfg, _ := s.requireASCConfig(c, userID)
	if cfg == nil {
		return
	}

	var req iosASCInviteRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的输入数据"})
		return
	}
	email := strings.TrimSpace(req.Email)
	if _, err := mail.ParseAddress(email); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "邮箱格式无效"})
		return
	}

	if err := s.ascCreateTester(c.Request.Context(), cfg, email, strings.TrimSpace(req.FirstName), strings.TrimSpace(req.LastName), []string{app.ASCBetaGroupID}); err != nil {
		s.respondASCError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ---- Sync app meta from ASC ---------------------------------------------

// handleIOSAppASCSyncMeta pulls the ASC app's name + primary-locale
// description + latest-build icon and writes them onto the local row.
// Manual icon overrides (icon_source='manual') are preserved; everything
// else is overwritten from ASC since the user explicitly clicked sync.
//
// When asc_app_id is empty we auto-resolve via bundle_id (ASC bundle ids
// are unique within an Apple Dev account) and auto-pick the first Beta
// Group. This lets users skip the "选 ASC App / 保存绑定" step entirely
// for the common case.
func (s *Server) handleIOSAppASCSyncMeta(c *gin.Context) {
	userID, ok := requireUserID(c)
	if !ok {
		return
	}
	id, ok := parseInt64Param(c, "id")
	if !ok {
		return
	}
	app, err := s.getIOSApp(id, userID)
	if err != nil || app == nil {
		log.Printf("[iosdist asc-sync] app %d not found for user %s: %v", id, userID, err)
		c.JSON(http.StatusNotFound, gin.H{"error": "应用不存在"})
		return
	}
	cfg, _ := s.requireASCConfig(c, userID)
	if cfg == nil {
		log.Printf("[iosdist asc-sync] app %d (bundle %s): no ASC config for user %s — aborting", app.ID, app.BundleID, userID)
		return
	}
	log.Printf("[iosdist asc-sync] app=%d bundle=%q name=%q owner=%s asc_app_id=%q asc_beta_group_id=%q icon_source=%q",
		app.ID, app.BundleID, app.Name, userID, app.ASCAppID, app.ASCBetaGroupID, app.IconSource)
	log.Printf("[iosdist asc-sync] using ASC config issuer=%s key_id=%s p8_encrypted=%v", cfg.IssuerID, cfg.KeyID, cfg.P8Encrypted)

	ctx := c.Request.Context()

	// Auto-resolve ASC App via bundle_id match when no binding is set yet.
	// Same Apple Dev account can't have two apps with the same bundle id,
	// so the lookup is unambiguous.
	autoBound := false
	if app.ASCAppID == "" {
		if strings.TrimSpace(app.BundleID) == "" {
			log.Printf("[iosdist asc-sync] app=%d auto-bind aborted: empty bundle_id", app.ID)
			c.JSON(http.StatusBadRequest, gin.H{"error": "应用没有 bundle_id，无法自动绑定 ASC App"})
			return
		}
		log.Printf("[iosdist asc-sync] app=%d auto-binding via bundle_id lookup: %s", app.ID, app.BundleID)
		ascApps, lookupErr := s.ascListApps(ctx, cfg, app.BundleID)
		if lookupErr != nil {
			log.Printf("[iosdist asc-sync] app=%d ascListApps failed: %v", app.ID, lookupErr)
			s.respondASCError(c, lookupErr)
			return
		}
		log.Printf("[iosdist asc-sync] app=%d ascListApps returned %d match(es)", app.ID, len(ascApps))
		if len(ascApps) == 0 {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": fmt.Sprintf("ASC 中找不到 bundle_id 为 %s 的 App。请确认该 App 已在你的 App Store Connect 账号下创建。", app.BundleID),
			})
			return
		}
		app.ASCAppID = ascApps[0].ID
		autoBound = true
		log.Printf("[iosdist asc-sync] app=%d auto-bound to asc_app_id=%s (name=%q)", app.ID, app.ASCAppID, ascApps[0].Name)
		if err := s.setIOSAppASCBinding(app.ID, userID, app.ASCAppID, app.ASCBetaGroupID); err != nil {
			log.Printf("[iosdist asc-sync] app=%d setIOSAppASCBinding failed: %v", app.ID, err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
			return
		}
	}

	// 1. App-level attributes (name, primary locale).
	log.Printf("[iosdist asc-sync] app=%d GET /v1/apps/%s", app.ID, app.ASCAppID)
	detail, err := s.ascGetApp(ctx, cfg, app.ASCAppID)
	if err != nil {
		log.Printf("[iosdist asc-sync] app=%d ascGetApp failed: %v", app.ID, err)
		s.respondASCError(c, err)
		return
	}
	log.Printf("[iosdist asc-sync] app=%d ascGetApp ok: name=%q primaryLocale=%q sku=%q", app.ID, detail.Name, detail.PrimaryLocale, detail.SKU)

	// 2. Pick the best-matching locale and grab the full metainfo
	//    bundle. Prefer the app's primaryLocale; fall back to any "en"
	//    variant; finally first row.
	var pickedLoc *ascAppLocalization
	locs, locErr := s.ascGetLatestVersionLocalizations(ctx, cfg, app.ASCAppID)
	if locErr != nil {
		log.Printf("[iosdist asc-sync] app=%d ascGetLatestVersionLocalizations failed (continuing): %v", app.ID, locErr)
	} else {
		log.Printf("[iosdist asc-sync] app=%d ascGetLatestVersionLocalizations ok: %d locale(s)", app.ID, len(locs))
	}
	if len(locs) > 0 {
		for i := range locs {
			if strings.EqualFold(locs[i].Locale, detail.PrimaryLocale) {
				pickedLoc = &locs[i]
				break
			}
		}
		if pickedLoc == nil {
			for i := range locs {
				if strings.HasPrefix(strings.ToLower(locs[i].Locale), "en") {
					pickedLoc = &locs[i]
					break
				}
			}
		}
		if pickedLoc == nil {
			pickedLoc = &locs[0]
		}
		log.Printf("[iosdist asc-sync] app=%d picked locale=%q description_len=%d keywords_len=%d whatsnew_len=%d",
			app.ID, pickedLoc.Locale, len(pickedLoc.Description), len(pickedLoc.Keywords), len(pickedLoc.WhatsNew))
	}

	// 3. Compose the meta update. Anything ASC returned non-empty wins;
	//    empty falls back to whatever's already on the row so we don't
	//    accidentally clear fields ASC didn't include this round.
	updatedFields := []string{}
	if autoBound {
		updatedFields = append(updatedFields, "ASC 绑定")
	}
	newName := strings.TrimSpace(detail.Name)
	meta := IOSAppMetaUpdate{
		Name:            firstNonEmpty(newName, app.Name),
		Description:     app.Description,
		Keywords:        app.Keywords,
		WhatsNew:        app.WhatsNew,
		PromotionalText: app.PromotionalText,
		MarketingURL:    app.MarketingURL,
		SupportURL:      app.SupportURL,
	}
	if pickedLoc != nil {
		meta.Description = firstNonEmpty(pickedLoc.Description, app.Description)
		meta.Keywords = firstNonEmpty(pickedLoc.Keywords, app.Keywords)
		meta.WhatsNew = firstNonEmpty(pickedLoc.WhatsNew, app.WhatsNew)
		meta.PromotionalText = firstNonEmpty(pickedLoc.PromotionalText, app.PromotionalText)
		meta.MarketingURL = firstNonEmpty(pickedLoc.MarketingURL, app.MarketingURL)
		meta.SupportURL = firstNonEmpty(pickedLoc.SupportURL, app.SupportURL)
	}

	if meta.Name != app.Name {
		updatedFields = append(updatedFields, "名称")
	}
	if meta.Description != app.Description {
		updatedFields = append(updatedFields, "描述")
	}
	if meta.Keywords != app.Keywords {
		updatedFields = append(updatedFields, "关键词")
	}
	if meta.WhatsNew != app.WhatsNew {
		updatedFields = append(updatedFields, "What's New")
	}
	if meta.PromotionalText != app.PromotionalText {
		updatedFields = append(updatedFields, "推广文本")
	}
	if meta.MarketingURL != app.MarketingURL {
		updatedFields = append(updatedFields, "Marketing URL")
	}
	if meta.SupportURL != app.SupportURL {
		updatedFields = append(updatedFields, "Support URL")
	}

	if len(updatedFields) > 0 || autoBound {
		// Skip the write when only autoBound is true (binding was
		// already saved earlier) and no other field changed.
		hasMetaChange := false
		for _, f := range updatedFields {
			if f != "ASC 绑定" {
				hasMetaChange = true
				break
			}
		}
		if hasMetaChange {
			log.Printf("[iosdist asc-sync] app=%d writing meta updated_fields=%v", app.ID, updatedFields)
			if err := s.setIOSAppMeta(app.ID, userID, meta); err != nil {
				log.Printf("[iosdist asc-sync] app=%d setIOSAppMeta failed: %v", app.ID, err)
				c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
				return
			}
		} else {
			log.Printf("[iosdist asc-sync] app=%d only auto-binding updated, no meta write", app.ID)
		}
	} else {
		log.Printf("[iosdist asc-sync] app=%d meta unchanged", app.ID)
	}

	// Icon: only overwrite when ASC has one AND user hasn't manually
	// uploaded one. Manual uploads pin forever.
	if app.IconSource == "manual" {
		log.Printf("[iosdist asc-sync] app=%d skipping icon: icon_source=manual (operator-pinned)", app.ID)
	} else {
		build, buildErr := s.ascLatestBuildForApp(ctx, cfg, app.ASCAppID)
		if buildErr != nil {
			log.Printf("[iosdist asc-sync] app=%d ascLatestBuildForApp failed: %v", app.ID, buildErr)
		} else if build == nil {
			log.Printf("[iosdist asc-sync] app=%d no builds yet on ASC", app.ID)
		} else if build.IconAssetToken == nil {
			log.Printf("[iosdist asc-sync] app=%d build %s has no iconAssetToken (processingState=%s)", app.ID, build.ID, build.ProcessingState)
		} else {
			iconURLs := resolveASCIconURLs(build.IconAssetToken)
			if len(iconURLs) > 0 {
				log.Printf("[iosdist asc-sync] app=%d build=%s trying %d icon URL variant(s); first=%s", app.ID, build.ID, len(iconURLs), iconURLs[0])
			} else {
				log.Printf("[iosdist asc-sync] app=%d resolveASCIconURLs produced no URLs", app.ID)
			}
			if len(iconURLs) > 0 {
				data, ct, dlErr := s.downloadASCIconWithFallback(ctx, iconURLs)
				if dlErr != nil {
					log.Printf("[iosdist asc-sync] app=%d downloadASCIcon failed all variants: %v", app.ID, dlErr)
				} else {
					log.Printf("[iosdist asc-sync] app=%d downloaded icon %d bytes (%s)", app.ID, len(data), ct)
					persistedURL, persistErr := s.persistIOSDownloadedIcon(c, app.ID, data, ct)
					if persistErr != nil {
						log.Printf("[iosdist asc-sync] app=%d persistIOSDownloadedIcon failed: %v", app.ID, persistErr)
					} else {
						if err := s.setIOSAppIcon(app.ID, userID, persistedURL, "asc"); err != nil {
							log.Printf("[iosdist asc-sync] app=%d setIOSAppIcon failed: %v", app.ID, err)
						} else {
							log.Printf("[iosdist asc-sync] app=%d icon updated → %s", app.ID, persistedURL)
							updatedFields = append(updatedFields, "图标")
						}
					}
				}
			}
		}
	}

	log.Printf("[iosdist asc-sync] app=%d done updated_fields=%v", app.ID, updatedFields)
	updated, _ := s.getIOSApp(app.ID, userID)
	c.JSON(http.StatusOK, gin.H{"app": updated, "updated_fields": updatedFields})
}

// persistIOSDownloadedIcon writes raw icon bytes through the
// AttachmentStorage. Mirrors persistIOSExtractedIcon (which takes an
// ipaInfo) — split because callers want different ext/content-type
// hints.
func (s *Server) persistIOSDownloadedIcon(c *gin.Context, appID int64, data []byte, contentType string) (string, error) {
	if s.uploadDir == "" {
		return "", fmt.Errorf("upload dir not configured")
	}
	if err := os.MkdirAll(s.uploadDir, 0o755); err != nil {
		return "", err
	}
	ext := ".png"
	if strings.Contains(contentType, "jpeg") || strings.Contains(contentType, "jpg") {
		ext = ".jpg"
	}
	storedName := fmt.Sprintf("iosdist_appicon_%d_%s%s", appID, generateSessionID()[:8], ext)
	dstPath := filepath.Join(s.uploadDir, storedName)
	if err := os.WriteFile(dstPath, data, 0o644); err != nil {
		return "", err
	}
	publicURL, err := s.chatStorage.Store(c.Request.Context(), dstPath, storedName, contentType)
	if err != nil {
		removeLocalFile(dstPath)
		return "", err
	}
	if s.chatStorage.IsRemote() {
		removeLocalFile(dstPath)
	}
	return publicURL, nil
}

// sanitizeASCIDInput strips common copy-paste artifacts (whitespace, ASCII
// quotes, curly quotes, backticks, surrounding angle brackets) from an
// Issuer ID / Key ID. Real Apple identifiers contain only [A-Za-z0-9-]
// so anything else is almost certainly a paste contaminant.
func sanitizeASCIDInput(s string) string {
	s = strings.TrimSpace(s)
	// Strip a known set of wrapping characters first; the second
	// TrimSpace catches whitespace inside the wrappers. Curly quotes
	// expressed via escapes to keep the source ASCII-clean.
	s = strings.Trim(s, "\"'`<>“”‘’")
	s = strings.TrimSpace(s)
	// Some users paste values prefixed with the field label, e.g.
	// "Key ID: ABCDE12345" — strip a single leading word + colon.
	if i := strings.Index(s, ":"); i > 0 && i < len(s)-1 {
		// Only do this when the prefix looks like a label: short, no
		// dashes, no spaces in the value portion. Anything else, leave alone.
		prefix := strings.TrimSpace(s[:i])
		if len(prefix) <= 16 && !strings.ContainsAny(prefix, "-") {
			s = strings.TrimSpace(s[i+1:])
		}
	}
	return s
}

// ---- shared helpers ------------------------------------------------------

func (s *Server) requireASCConfig(c *gin.Context, userID string) (*IOSASCConfig, error) {
	cfg, err := s.getIOSASCConfig(userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return nil, err
	}
	if cfg == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "尚未配置 ASC API Key（Issuer ID + Key ID + .p8）"})
		return nil, nil
	}
	return cfg, nil
}

func (s *Server) respondASCError(c *gin.Context, err error) {
	if err == nil {
		return
	}
	if strings.Contains(err.Error(), errIOSASCClient.Error()) {
		// Trim the "asc client error: " prefix the caller wrapped on, so
		// the user sees just Apple's message.
		msg := strings.TrimPrefix(err.Error(), "asc client error: ")
		c.JSON(http.StatusBadRequest, gin.H{"error": "ASC API 拒绝请求：" + msg})
		return
	}
	c.JSON(http.StatusBadGateway, gin.H{"error": "调用 ASC API 失败：" + err.Error()})
}
