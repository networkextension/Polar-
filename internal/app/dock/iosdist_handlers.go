package dock

// HTTP handlers for the iOS distribution module.
//
// Owner-scoped CRUD on apps + versions, IPA upload via the same
// AttachmentStorage used by chat (local fs or R2), and unauthenticated
// OTA endpoints (manifest.plist + IPA download) that gate on a short-lived
// token. Signing pipeline lands in M2 — for now we accept already-signed
// IPAs and just shuttle bits + metadata.

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"html"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

const (
	iosdistMaxIPASize         = int64(2 << 30) // 2 GiB ceiling — Apple's hard limit is 4 GiB but most test builds are well under 1 GiB
	iosdistMaxResourceSize    = int64(20 << 20) // 20 MiB — generous; .p12 + .mobileprovision are typically <1 MiB
	iosdistTokenTTL           = 7 * 24 * time.Hour
	iosdistTokenByteLen       = 24
	iosdistMaxBundleIDLen     = 200
	iosdistMaxNameLen         = 120
)

// Apple distribution channels we recognize. The first three are OTA-installable
// via itms-services; app_store builds get refused at install-token issue time
// because the App Store distribution profile blocks Ad-hoc / itms-services
// installs.
var iosdistAllowedDistTypes = map[string]bool{
	"ad_hoc":      true,
	"enterprise":  true,
	"development": true,
	"app_store":   true,
}

func iosdistDistTypeOTAInstallable(t string) bool {
	return t == "ad_hoc" || t == "enterprise" || t == "development"
}

var iosdistAllowedCertKinds = map[string]bool{
	"distribution": true,
	"development":  true,
	"enterprise":   true,
	"adhoc":        true,
}

var iosdistAllowedProfileKinds = map[string]bool{
	"app_store":   true,
	"ad_hoc":      true,
	"enterprise":  true,
	"development": true,
}

// ---- Helpers --------------------------------------------------------------

func generateIOSInstallToken() string {
	b := make([]byte, iosdistTokenByteLen)
	if _, err := rand.Read(b); err != nil {
		// Fall back to time-based randomness; the token is still 1) only
		// useful for the bound version and 2) bounded by expiry.
		return fmt.Sprintf("t%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(b)
}

func bundleIDLooksValid(id string) bool {
	if id == "" || len(id) > iosdistMaxBundleIDLen {
		return false
	}
	// Apple bundle IDs are dotted reverse-DNS: alphanumerics, '-', '.'
	for _, r := range id {
		switch {
		case r >= 'a' && r <= 'z':
		case r >= 'A' && r <= 'Z':
		case r >= '0' && r <= '9':
		case r == '-' || r == '.':
		default:
			return false
		}
	}
	if strings.HasPrefix(id, ".") || strings.HasSuffix(id, ".") {
		return false
	}
	return strings.Contains(id, ".")
}

// installPublicBaseURL returns the absolute URL prefix for OTA links.
// Apple requires HTTPS with a valid certificate for itms-services to
// work, so we always honour the configured PUBLIC_BASE_URL when set;
// otherwise we fall back to the request's own scheme + host (useful in
// local dev when reaching the box from a phone over LAN HTTPS proxy).
func (s *Server) installPublicBaseURL(c *gin.Context) string {
	if s.publicBaseURL != "" {
		return s.publicBaseURL
	}
	scheme := "https"
	if c.Request.TLS == nil && c.GetHeader("X-Forwarded-Proto") == "" {
		scheme = "http"
	}
	host := c.Request.Host
	return fmt.Sprintf("%s://%s", scheme, host)
}

// ---- App CRUD -------------------------------------------------------------

func (s *Server) handleIOSAppList(c *gin.Context) {
	userID, ok := requireUserID(c)
	if !ok {
		return
	}
	apps, err := s.listIOSApps(userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"apps": apps})
}

type iosAppCreateRequest struct {
	Name        string `json:"name"`
	BundleID    string `json:"bundle_id"`
	Description string `json:"description"`
}

func (s *Server) handleIOSAppCreate(c *gin.Context) {
	userID, ok := requireUserID(c)
	if !ok {
		return
	}
	var req iosAppCreateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的输入数据"})
		return
	}
	name := strings.TrimSpace(req.Name)
	bundleID := strings.TrimSpace(req.BundleID)
	if name == "" || len(name) > iosdistMaxNameLen {
		c.JSON(http.StatusBadRequest, gin.H{"error": "应用名不能为空且不超过 120 字"})
		return
	}
	if !bundleIDLooksValid(bundleID) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Bundle ID 无效，需为反向 DNS 格式（如 com.example.app）"})
		return
	}
	app := &IOSApp{
		OwnerUserID: userID,
		Name:        name,
		BundleID:    bundleID,
		Description: strings.TrimSpace(req.Description),
	}
	if err := s.createIOSApp(app); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"app": app})
}

func (s *Server) handleIOSAppDetail(c *gin.Context) {
	userID, ok := requireUserID(c)
	if !ok {
		return
	}
	id, ok := parseInt64Param(c, "id")
	if !ok {
		return
	}
	app, err := s.getIOSApp(id, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	if app == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "应用不存在"})
		return
	}
	versions, err := s.listIOSVersions(app.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"app": app, "versions": versions})
}

func (s *Server) handleIOSAppDelete(c *gin.Context) {
	userID, ok := requireUserID(c)
	if !ok {
		return
	}
	id, ok := parseInt64Param(c, "id")
	if !ok {
		return
	}
	app, err := s.getIOSApp(id, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	if app == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "应用不存在"})
		return
	}
	if err := s.deleteIOSApp(id, userID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// handleIOSAppIconUpload accepts a multipart image and overrides the app
// icon. icon_source is set to 'manual' so subsequent IPA uploads won't
// overwrite it. 5 MiB cap is plenty for 1024×1024 PNG/JPEG.
func (s *Server) handleIOSAppIconUpload(c *gin.Context) {
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
	if s.uploadDir == "" {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "上传目录未配置"})
		return
	}
	file, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请选择图标文件"})
		return
	}
	if file.Size > int64(5<<20) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "图标大小超过 5 MiB"})
		return
	}
	mimeType := file.Header.Get("Content-Type")
	if !strings.HasPrefix(mimeType, "image/") {
		c.JSON(http.StatusBadRequest, gin.H{"error": "仅支持图片文件"})
		return
	}
	if err := os.MkdirAll(s.uploadDir, 0o755); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	storedName := fmt.Sprintf("iosdist_appicon_%d_%s%s", app.ID, generateSessionID()[:8], filepath.Ext(file.Filename))
	dstPath := filepath.Join(s.uploadDir, storedName)
	if err := c.SaveUploadedFile(file, dstPath); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "文件保存失败"})
		return
	}
	publicURL, err := s.chatStorage.Store(c.Request.Context(), dstPath, storedName, mimeType)
	if err != nil {
		removeLocalFile(dstPath)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "文件上传失败"})
		return
	}
	if s.chatStorage.IsRemote() {
		removeLocalFile(dstPath)
	}
	if err := s.setIOSAppIcon(app.ID, userID, publicURL, "manual"); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	updated, _ := s.getIOSApp(app.ID, userID)
	c.JSON(http.StatusOK, gin.H{"app": updated})
}

// handleIOSAppVisibilityUpdate toggles the public share page on/off.
// The slug itself stays put — turning it back on resurrects the same
// URL (so printed flyers / pre-shared QR codes keep working).
type iosAppVisibilityRequest struct {
	IsPublic bool `json:"is_public"`
}

func (s *Server) handleIOSAppVisibilityUpdate(c *gin.Context) {
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
	var req iosAppVisibilityRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的输入数据"})
		return
	}
	if err := s.setIOSAppPublicVisibility(app.ID, userID, req.IsPublic); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	updated, _ := s.getIOSApp(app.ID, userID)
	c.JSON(http.StatusOK, gin.H{"app": updated})
}

func (s *Server) handleIOSAppTestRequestList(c *gin.Context) {
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
	requests, err := s.listIOSTestRequests(app.ID, 100)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"requests": requests})
}

// handleIOSAppTestFlightURL stores a TestFlight invite URL on the app.
// Validation is intentionally light — we only check the URL parses and
// the host is testflight.apple.com so the front-end can confidently
// surface it as a "TestFlight 邀请" link without checking again.
type iosAppTestFlightRequest struct {
	URL string `json:"url"`
}

func (s *Server) handleIOSAppTestFlightUpdate(c *gin.Context) {
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
	var req iosAppTestFlightRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的输入数据"})
		return
	}
	cleaned := strings.TrimSpace(req.URL)
	if cleaned != "" {
		parsed, perr := url.Parse(cleaned)
		if perr != nil || parsed.Scheme != "https" || !strings.EqualFold(parsed.Host, "testflight.apple.com") {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": "TestFlight 链接需以 https://testflight.apple.com/ 开头",
			})
			return
		}
	}
	if err := s.setIOSAppTestFlightURL(app.ID, userID, cleaned); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	updated, _ := s.getIOSApp(app.ID, userID)
	c.JSON(http.StatusOK, gin.H{"app": updated})
}

// ---- Version upload + delete ---------------------------------------------

func (s *Server) handleIOSVersionUpload(c *gin.Context) {
	userID, ok := requireUserID(c)
	if !ok {
		return
	}
	appID, ok := parseInt64Param(c, "id")
	if !ok {
		return
	}
	app, err := s.getIOSApp(appID, userID)
	if err != nil || app == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "应用不存在"})
		return
	}
	if s.uploadDir == "" {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "上传目录未配置"})
		return
	}

	version := strings.TrimSpace(c.PostForm("version"))
	if version == "" || len(version) > 60 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "版本号不能为空"})
		return
	}
	build := strings.TrimSpace(c.PostForm("build_number"))
	notes := strings.TrimSpace(c.PostForm("release_notes"))
	distType := strings.TrimSpace(c.PostForm("distribution_type"))
	if distType == "" {
		distType = "ad_hoc"
	}
	if !iosdistAllowedDistTypes[distType] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "签名类型必须是 ad_hoc / enterprise / development / app_store 之一"})
		return
	}

	file, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请选择 IPA 文件"})
		return
	}
	if file.Size > iosdistMaxIPASize {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("IPA 大小超过限制（最大 %d MiB）", iosdistMaxIPASize>>20)})
		return
	}
	if !strings.HasSuffix(strings.ToLower(file.Filename), ".ipa") {
		c.JSON(http.StatusBadRequest, gin.H{"error": "仅支持 .ipa 文件"})
		return
	}

	if err := os.MkdirAll(s.uploadDir, 0o755); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	storedName := "iosdist_" + buildUploadFilename(file.Filename)
	dstPath := filepath.Join(s.uploadDir, storedName)
	if err := c.SaveUploadedFile(file, dstPath); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "文件保存失败"})
		return
	}

	// Introspect the IPA before shipping bytes anywhere. We do this
	// against the local on-disk copy because zip.OpenReader needs random
	// access and the chatStorage URL is opaque (could be R2). A failure
	// here is non-fatal — many things masquerade as IPAs (e.g. unsigned
	// archives from CI) and we'd rather store the file with empty
	// metadata than reject it. Bundle-id mismatch is the only hard fail.
	parsedIPA, parseErr := parseIPA(dstPath)
	if parseErr != nil {
		log.Printf("iosdist: ipa parse failed for %q: %v", file.Filename, parseErr)
	}
	if parsedIPA != nil && parsedIPA.BundleID != "" && app.BundleID != "" {
		if !strings.EqualFold(parsedIPA.BundleID, app.BundleID) {
			removeLocalFile(dstPath)
			c.JSON(http.StatusBadRequest, gin.H{
				"error": fmt.Sprintf(
					"IPA 内部 bundle id (%s) 与应用 bundle id (%s) 不一致；如果确实想换 bundle，请先在 App 设置中改名，再上传。",
					parsedIPA.BundleID, app.BundleID,
				),
			})
			return
		}
	}

	sum, err := sha256File(dstPath)
	if err != nil {
		removeLocalFile(dstPath)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "校验文件失败"})
		return
	}

	publicURL, err := s.chatStorage.Store(c.Request.Context(), dstPath, storedName, "application/octet-stream")
	if err != nil {
		removeLocalFile(dstPath)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "文件上传失败"})
		return
	}
	if s.chatStorage.IsRemote() {
		removeLocalFile(dstPath)
	}

	v := &IOSVersion{
		AppID:            app.ID,
		Version:          version,
		BuildNumber:      build,
		IPAUrl:           publicURL,
		IPAFilename:      file.Filename,
		IPASize:          file.Size,
		IPASHA256:        sum,
		ReleaseNotes:     notes,
		IsSigned:         true,
		DistributionType: distType,
	}
	if parsedIPA != nil {
		v.IPABundleID = parsedIPA.BundleID
		v.IPAShortVersion = parsedIPA.BundleShortVersion
		v.IPABuildNumber = parsedIPA.BundleVersion
		v.IPADisplayName = parsedIPA.BundleDisplayName
		v.IPAMinOS = parsedIPA.MinimumOSVersion
		v.IPAHasEmbeddedPP = parsedIPA.HasEmbeddedProvProf
		// Auto-fill the user-facing version + build when the form was
		// left at default. Manual entry wins so an operator can override
		// IPAs that ship with weird internal numbering.
		if v.Version == "" || v.Version == "0" {
			if parsedIPA.BundleShortVersion != "" {
				v.Version = parsedIPA.BundleShortVersion
			}
		}
		if v.BuildNumber == "" {
			v.BuildNumber = parsedIPA.BundleVersion
		}
	}
	if err := s.createIOSVersion(v); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	_ = s.touchIOSApp(app.ID)

	// Auto-set the app icon from the IPA when we extracted one and the
	// operator hasn't explicitly uploaded a manual icon. Manual wins
	// permanently — we never trample it.
	if parsedIPA != nil && len(parsedIPA.IconBytes) > 0 && app.IconSource != "manual" {
		if iconURL, err := s.persistIOSExtractedIcon(c, app.ID, parsedIPA); err == nil {
			_ = s.setIOSAppIcon(app.ID, userID, iconURL, "ipa")
		} else {
			log.Printf("iosdist: persist extracted icon for app %d failed: %v", app.ID, err)
		}
	}

	c.JSON(http.StatusOK, gin.H{"version": v})
}

// persistIOSExtractedIcon writes the in-memory icon bytes to the
// AttachmentStorage. We stage it through the upload dir because the
// storage interface expects an on-disk path (it reuses the chat upload
// path for R2 streaming).
func (s *Server) persistIOSExtractedIcon(c *gin.Context, appID int64, info *ipaInfo) (string, error) {
	if s.uploadDir == "" {
		return "", fmt.Errorf("upload dir not configured")
	}
	if err := os.MkdirAll(s.uploadDir, 0o755); err != nil {
		return "", err
	}
	ext := ".png"
	if info.IconContentType == "image/jpeg" {
		ext = ".jpg"
	}
	storedName := fmt.Sprintf("iosdist_appicon_%d_%s%s", appID, generateSessionID()[:8], ext)
	dstPath := filepath.Join(s.uploadDir, storedName)
	if err := os.WriteFile(dstPath, info.IconBytes, 0o644); err != nil {
		return "", err
	}
	publicURL, err := s.chatStorage.Store(c.Request.Context(), dstPath, storedName, info.IconContentType)
	if err != nil {
		removeLocalFile(dstPath)
		return "", err
	}
	if s.chatStorage.IsRemote() {
		removeLocalFile(dstPath)
	}
	return publicURL, nil
}

func (s *Server) handleIOSVersionDelete(c *gin.Context) {
	userID, ok := requireUserID(c)
	if !ok {
		return
	}
	appID, ok := parseInt64Param(c, "id")
	if !ok {
		return
	}
	versionID, ok := parseInt64Param(c, "versionId")
	if !ok {
		return
	}
	app, err := s.getIOSApp(appID, userID)
	if err != nil || app == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "应用不存在"})
		return
	}
	v, err := s.getIOSVersion(versionID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	if v == nil || v.AppID != app.ID {
		c.JSON(http.StatusNotFound, gin.H{"error": "版本不存在"})
		return
	}
	if err := s.deleteIOSVersion(versionID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ---- Install token + OTA endpoints ---------------------------------------

type iosInstallTokenResponse struct {
	Token       string    `json:"token"`
	ExpiresAt   time.Time `json:"expires_at"`
	InstallURL  string    `json:"install_url"`   // safari-friendly landing page
	ManifestURL string    `json:"manifest_url"`  // raw manifest.plist URL
	ItmsURL     string    `json:"itms_services"` // itms-services://?action=download-manifest&url=...
}

func (s *Server) handleIOSVersionInstallToken(c *gin.Context) {
	userID, ok := requireUserID(c)
	if !ok {
		return
	}
	appID, ok := parseInt64Param(c, "id")
	if !ok {
		return
	}
	versionID, ok := parseInt64Param(c, "versionId")
	if !ok {
		return
	}
	app, err := s.getIOSApp(appID, userID)
	if err != nil || app == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "应用不存在"})
		return
	}
	v, err := s.getIOSVersion(versionID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	if v == nil || v.AppID != app.ID {
		c.JSON(http.StatusNotFound, gin.H{"error": "版本不存在"})
		return
	}
	if v.IPAUrl == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "该版本尚未上传 IPA"})
		return
	}
	if !iosdistDistTypeOTAInstallable(v.DistributionType) {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "该版本是 App Store 类型，OTA 不可安装；请走 ASC / TestFlight 分发",
		})
		return
	}

	tok := &IOSInstallToken{
		Token:     generateIOSInstallToken(),
		VersionID: v.ID,
		CreatedBy: userID,
		ExpiresAt: time.Now().Add(iosdistTokenTTL),
	}
	if err := s.createIOSInstallToken(tok); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}

	base := s.installPublicBaseURL(c)
	installURL := base + "/iosdist/install/" + tok.Token
	manifestURL := base + "/iosdist/manifest/" + tok.Token + ".plist"
	itms := "itms-services://?action=download-manifest&url=" + manifestURL

	c.JSON(http.StatusOK, gin.H{
		"token":         tok.Token,
		"expires_at":    tok.ExpiresAt,
		"install_url":   installURL,
		"manifest_url":  manifestURL,
		"itms_services": itms,
	})
}

// handleIOSInstallManifest renders the Apple OTA manifest.plist for a token.
// Apple requires the URL on `itms-services://?url=` to be HTTPS — that is
// enforced by the operator setting PUBLIC_BASE_URL to https://… ; here we
// just emit the XML.
func (s *Server) handleIOSInstallManifest(c *gin.Context) {
	token := strings.TrimSuffix(c.Param("token"), ".plist")
	tok, err := s.getIOSInstallToken(token)
	if err != nil {
		c.String(http.StatusInternalServerError, "server error")
		return
	}
	if tok == nil || time.Now().After(tok.ExpiresAt) {
		c.String(http.StatusGone, "link expired")
		return
	}
	v, err := s.getIOSVersion(tok.VersionID)
	if err != nil || v == nil {
		c.String(http.StatusNotFound, "not found")
		return
	}
	app, err := s.getIOSAppByID(v.AppID)
	if err != nil || app == nil {
		c.String(http.StatusNotFound, "not found")
		return
	}
	_ = s.bumpIOSInstallTokenAccess(token)

	ipaURL := absolutizeURL(s.installPublicBaseURL(c), v.IPAUrl)
	manifest := buildOTAManifest(ipaURL, app.BundleID, v.Version, app.Name)
	c.Header("Content-Type", "application/xml; charset=utf-8")
	c.Header("Cache-Control", "no-store")
	c.String(http.StatusOK, manifest)
}

// handleIOSInstallPage renders a tiny HTML landing page that surfaces the
// itms-services:// link as a button. We render server-side because the
// install page is opened on a phone Safari that may not have JS enabled
// for cross-origin resources, and keeping it inline avoids an extra hop.
func (s *Server) handleIOSInstallPage(c *gin.Context) {
	token := c.Param("token")
	tok, err := s.getIOSInstallToken(token)
	if err != nil {
		c.String(http.StatusInternalServerError, "server error")
		return
	}
	if tok == nil || time.Now().After(tok.ExpiresAt) {
		c.String(http.StatusGone, "link expired")
		return
	}
	v, err := s.getIOSVersion(tok.VersionID)
	if err != nil || v == nil {
		c.String(http.StatusNotFound, "not found")
		return
	}
	app, err := s.getIOSAppByID(v.AppID)
	if err != nil || app == nil {
		c.String(http.StatusNotFound, "not found")
		return
	}

	base := s.installPublicBaseURL(c)
	manifestURL := base + "/iosdist/manifest/" + token + ".plist"
	itms := "itms-services://?action=download-manifest&url=" + manifestURL
	expiresIn := int(time.Until(tok.ExpiresAt).Hours())

	page := fmt.Sprintf(`<!DOCTYPE html>
<html lang="zh-CN"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>%s — 安装</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;margin:0;padding:24px;background:linear-gradient(135deg,#f5f7fa 0%%,#c3cfe2 100%%);min-height:100vh}
.card{max-width:480px;margin:40px auto;background:#fff;border-radius:20px;padding:32px;box-shadow:0 10px 40px rgba(0,0,0,.1)}
h1{margin:0 0 4px;font-size:22px}.muted{color:#888;font-size:13px;margin-bottom:24px}
.btn{display:block;width:100%%;padding:16px;background:#007aff;color:#fff;border:none;border-radius:12px;font-size:17px;font-weight:600;text-align:center;text-decoration:none;margin-top:16px}
.btn:active{opacity:.8}
.meta{margin-top:24px;padding:16px;background:#f5f5f7;border-radius:12px;font-size:13px;color:#555}
.meta div{margin:4px 0}.tip{margin-top:16px;padding:12px;background:#fff8e1;border-radius:8px;font-size:12px;color:#5d4e15}
</style></head><body>
<div class="card">
<h1>%s</h1>
<div class="muted">版本 %s · %.1f MB</div>
<a class="btn" href="%s">点此安装</a>
<div class="meta">
<div><b>Bundle ID:</b> %s</div>
<div><b>有效期:</b> %d 小时</div>
</div>
<div class="tip">
iOS 16.4 及以上需在「设置 → 隐私与安全性 → 开发者模式」中开启开发者模式后，方可打开本应用。<br>
请在 iPhone 自带 Safari 中打开本页面。
</div>
</div>
</body></html>`,
		html.EscapeString(app.Name),
		html.EscapeString(app.Name),
		html.EscapeString(v.Version),
		float64(v.IPASize)/(1024*1024),
		html.EscapeString(itms),
		html.EscapeString(app.BundleID),
		expiresIn,
	)
	c.Header("Content-Type", "text/html; charset=utf-8")
	c.Header("Cache-Control", "no-store")
	c.String(http.StatusOK, page)
}

// ---- helpers used only here ----------------------------------------------

func sha256File(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

// absolutizeURL turns a stored URL (which may be a relative /uploads/…
// path for local storage or a full URL for R2) into an absolute one so
// the iOS device, which is not on our origin, can resolve it.
func absolutizeURL(base, raw string) string {
	if strings.HasPrefix(raw, "http://") || strings.HasPrefix(raw, "https://") {
		return raw
	}
	if !strings.HasPrefix(raw, "/") {
		raw = "/" + raw
	}
	return strings.TrimRight(base, "/") + raw
}

// ---- Certificates ---------------------------------------------------------

func (s *Server) handleIOSCertificateList(c *gin.Context) {
	userID, ok := requireUserID(c)
	if !ok {
		return
	}
	certs, err := s.listIOSCertificates(userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"certificates":     certs,
		"encryption_ready": len(s.iosdistResourceKey) == iosdistResourceKeyBytes,
	})
}

func (s *Server) handleIOSCertificateUpload(c *gin.Context) {
	userID, ok := requireUserID(c)
	if !ok {
		return
	}
	if s.uploadDir == "" {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "上传目录未配置"})
		return
	}
	name := strings.TrimSpace(c.PostForm("name"))
	if name == "" || len(name) > iosdistMaxNameLen {
		c.JSON(http.StatusBadRequest, gin.H{"error": "证书名称不能为空且不超过 120 字"})
		return
	}
	kind := strings.TrimSpace(c.PostForm("kind"))
	if kind == "" {
		kind = "distribution"
	}
	if !iosdistAllowedCertKinds[kind] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "证书类型无效"})
		return
	}
	password := c.PostForm("password")
	teamID := strings.TrimSpace(c.PostForm("team_id"))
	commonName := strings.TrimSpace(c.PostForm("common_name"))
	notes := strings.TrimSpace(c.PostForm("notes"))

	file, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请选择证书文件 (.p12)"})
		return
	}
	if file.Size > iosdistMaxResourceSize {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("证书大小超过限制（最大 %d MiB）", iosdistMaxResourceSize>>20)})
		return
	}
	lower := strings.ToLower(file.Filename)
	if !(strings.HasSuffix(lower, ".p12") || strings.HasSuffix(lower, ".pfx") || strings.HasSuffix(lower, ".pem") || strings.HasSuffix(lower, ".cer")) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "仅支持 .p12 / .pfx / .pem / .cer"})
		return
	}

	if err := os.MkdirAll(s.uploadDir, 0o755); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	storedName := "iosdist_cert_" + buildUploadFilename(file.Filename)
	dstPath := filepath.Join(s.uploadDir, storedName)
	if err := c.SaveUploadedFile(file, dstPath); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "文件保存失败"})
		return
	}

	// Parse the .p12 to validate the password and harvest CN / Team ID /
	// expiry. We do this before shipping bits to remote storage so a wrong
	// password fails fast without polluting R2. Non-p12 formats (.pem /
	// .cer) skip parsing — the user fills metadata manually for those.
	var parsedCert *certificateInfo
	if strings.HasSuffix(strings.ToLower(file.Filename), ".p12") || strings.HasSuffix(strings.ToLower(file.Filename), ".pfx") {
		blob, readErr := os.ReadFile(dstPath)
		if readErr != nil {
			removeLocalFile(dstPath)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
			return
		}
		info, perr := parseP12Certificate(blob, password)
		if errors.Is(perr, errIOSCertWrongPassword) {
			removeLocalFile(dstPath)
			c.JSON(http.StatusBadRequest, gin.H{"error": "证书密码错误"})
			return
		}
		if perr != nil {
			// Format error: still let the upload through but flag it so
			// the user can see something parsed-but-not-fully. The
			// signing pipeline will reject these later.
			log.Printf("iosdist: p12 parse failed for %q: %v", file.Filename, perr)
		} else {
			parsedCert = info
		}
	}

	publicURL, err := s.chatStorage.Store(c.Request.Context(), dstPath, storedName, "application/octet-stream")
	if err != nil {
		removeLocalFile(dstPath)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "文件上传失败"})
		return
	}
	if s.chatStorage.IsRemote() {
		removeLocalFile(dstPath)
	}

	cipher, encrypted, err := s.encryptIOSDistSecret(password)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "密码加密失败"})
		return
	}
	stored := cipher
	if !encrypted {
		// Plaintext fallback when no resource key configured. Mark the
		// row so the UI can warn the user. Empty password stays empty.
		stored = password
	}

	cert := &IOSCertificate{
		OwnerUserID:       userID,
		Name:              name,
		Kind:              kind,
		FileURL:           publicURL,
		FileFilename:      file.Filename,
		FileSize:          file.Size,
		PasswordEncrypted: encrypted,
		HasPassword:       password != "",
		TeamID:            teamID,
		CommonName:        commonName,
		Notes:             notes,
		passwordCipher:    stored,
	}
	// Auto-fill from parsed cert when the user left fields blank. We
	// don't override user-supplied values — manual entry wins for cases
	// where the cert lies (e.g. a renamed export).
	if parsedCert != nil {
		if cert.CommonName == "" {
			cert.CommonName = parsedCert.CommonName
		}
		if cert.TeamID == "" {
			cert.TeamID = parsedCert.TeamID
		}
		if !parsedCert.NotAfter.IsZero() {
			expiry := parsedCert.NotAfter
			cert.ExpiresAt = &expiry
		}
	}
	if err := s.createIOSCertificate(cert); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"certificate": cert})
}

func (s *Server) handleIOSCertificateDelete(c *gin.Context) {
	userID, ok := requireUserID(c)
	if !ok {
		return
	}
	id, ok := parseInt64Param(c, "id")
	if !ok {
		return
	}
	cert, err := s.getIOSCertificate(id, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	if cert == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "证书不存在"})
		return
	}
	if err := s.deleteIOSCertificate(id, userID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ---- Provisioning profiles -----------------------------------------------

func (s *Server) handleIOSProfileList(c *gin.Context) {
	userID, ok := requireUserID(c)
	if !ok {
		return
	}
	profiles, err := s.listIOSProfiles(userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"profiles": profiles})
}

func (s *Server) handleIOSProfileUpload(c *gin.Context) {
	userID, ok := requireUserID(c)
	if !ok {
		return
	}
	if s.uploadDir == "" {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "上传目录未配置"})
		return
	}
	name := strings.TrimSpace(c.PostForm("name"))
	if name == "" || len(name) > iosdistMaxNameLen {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Profile 名称不能为空"})
		return
	}
	kind := strings.TrimSpace(c.PostForm("kind"))
	if kind == "" {
		kind = "ad_hoc"
	}
	if !iosdistAllowedProfileKinds[kind] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Profile 类型无效"})
		return
	}
	appID := strings.TrimSpace(c.PostForm("app_id"))
	teamID := strings.TrimSpace(c.PostForm("team_id"))
	notes := strings.TrimSpace(c.PostForm("notes"))

	file, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请选择 .mobileprovision 文件"})
		return
	}
	if file.Size > iosdistMaxResourceSize {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("文件大小超过限制（最大 %d MiB）", iosdistMaxResourceSize>>20)})
		return
	}
	lower := strings.ToLower(file.Filename)
	if !(strings.HasSuffix(lower, ".mobileprovision") || strings.HasSuffix(lower, ".provisionprofile")) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "仅支持 .mobileprovision / .provisionprofile"})
		return
	}

	if err := os.MkdirAll(s.uploadDir, 0o755); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	storedName := "iosdist_profile_" + buildUploadFilename(file.Filename)
	dstPath := filepath.Join(s.uploadDir, storedName)
	if err := c.SaveUploadedFile(file, dstPath); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "文件保存失败"})
		return
	}

	// Parse the embedded plist before shipping to storage. Failure here
	// is non-fatal — we still accept the file but log a warning, since
	// users sometimes upload .provisionprofile blobs with quirks we
	// haven't seen yet.
	var parsedProfile *provisionInfo
	if blob, readErr := os.ReadFile(dstPath); readErr == nil {
		if info, perr := parseMobileProvision(blob); perr == nil {
			parsedProfile = info
		} else {
			log.Printf("iosdist: mobileprovision parse failed for %q: %v", file.Filename, perr)
		}
	}

	publicURL, err := s.chatStorage.Store(c.Request.Context(), dstPath, storedName, "application/octet-stream")
	if err != nil {
		removeLocalFile(dstPath)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "文件上传失败"})
		return
	}
	if s.chatStorage.IsRemote() {
		removeLocalFile(dstPath)
	}

	profile := &IOSProvisioningProfile{
		OwnerUserID:  userID,
		Name:         name,
		Kind:         kind,
		FileURL:      publicURL,
		FileFilename: file.Filename,
		FileSize:     file.Size,
		AppID:        appID,
		TeamID:       teamID,
		Notes:        notes,
	}
	if parsedProfile != nil {
		// Fill blanks from the parsed plist; classify kind from flags
		// when the user accepted the default. Trust the artifact over
		// manual entry only for derived facts (UDID count, expiry).
		if profile.AppID == "" {
			profile.AppID = parsedProfile.ApplicationID
		}
		if profile.TeamID == "" {
			profile.TeamID = parsedProfile.TeamID
		}
		profile.UDIDCount = len(parsedProfile.ProvisionedDevices)
		if parsedProfile.ExpirationDate != nil {
			expiry := *parsedProfile.ExpirationDate
			profile.ExpiresAt = &expiry
		}
		// kind defaults to "ad_hoc" from the form; only override when the
		// parsed kind differs and the user submitted the default. This is
		// a heuristic — when we add a "(auto)" sentinel to the dropdown
		// later we can stop guessing.
		if kind == "ad_hoc" && parsedProfile.Kind != "" {
			profile.Kind = parsedProfile.Kind
		}
	}
	if err := s.createIOSProfile(profile); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"profile": profile})
}

func (s *Server) handleIOSProfileDelete(c *gin.Context) {
	userID, ok := requireUserID(c)
	if !ok {
		return
	}
	id, ok := parseInt64Param(c, "id")
	if !ok {
		return
	}
	if err := s.deleteIOSProfile(id, userID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// buildOTAManifest assembles the Apple-required manifest.plist XML.
// Keep this hand-rolled — the structure is fixed by Apple, and pulling
// in a plist library for one document is overkill.
func buildOTAManifest(ipaURL, bundleID, version, title string) string {
	return fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>items</key>
  <array>
    <dict>
      <key>assets</key>
      <array>
        <dict>
          <key>kind</key><string>software-package</string>
          <key>url</key><string>%s</string>
        </dict>
      </array>
      <key>metadata</key>
      <dict>
        <key>bundle-identifier</key><string>%s</string>
        <key>bundle-version</key><string>%s</string>
        <key>kind</key><string>software</string>
        <key>title</key><string>%s</string>
      </dict>
    </dict>
  </array>
</dict>
</plist>`,
		html.EscapeString(ipaURL),
		html.EscapeString(bundleID),
		html.EscapeString(version),
		html.EscapeString(title),
	)
}
