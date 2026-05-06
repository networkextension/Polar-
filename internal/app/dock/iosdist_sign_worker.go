package dock

// Sign worker — single goroutine consuming task IDs from
// s.iosdistSignQueue. Per task it stages the source IPA + cert + profile
// to a temp dir, decrypts the cert password, runs zsign, parses the
// output IPA, uploads it via chatStorage, creates a new IOSVersion row,
// and marks the task success/failed.
//
// One worker is intentional: zsign is CPU-heavy and we don't want
// concurrent jobs thrashing disk + CDN egress on a small box. If we
// outgrow this, swap to a Redis Stream + N consumer goroutines.

import (
	"context"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

const (
	iosdistSignTimeout = 5 * time.Minute
	iosdistSignLogCap  = 4 << 10 // 4 KiB
)

func (s *Server) runIOSSignWorker(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case taskID, ok := <-s.iosdistSignQueue:
			if !ok {
				return
			}
			s.processIOSSignTask(ctx, taskID)
		}
	}
}

// processIOSSignTask is the per-task entrypoint. Failures inside this
// function never leak — they are persisted to the task row so the UI
// can surface them. Panics in zsign / file IO are caught and recorded.
func (s *Server) processIOSSignTask(ctx context.Context, taskID int64) {
	defer func() {
		if r := recover(); r != nil {
			log.Printf("[iosdist sign-worker] task=%d panic: %v", taskID, r)
			_ = s.markIOSSignTaskFailed(taskID, fmt.Sprintf("worker panic: %v", r), "")
		}
	}()

	if s.iosdistZsignPath == "" {
		_ = s.markIOSSignTaskFailed(taskID, "服务器未安装 zsign，无法签名", "")
		log.Printf("[iosdist sign-worker] task=%d aborted: zsign not installed", taskID)
		return
	}

	task, err := s.getIOSSignTask(taskID)
	if err != nil || task == nil {
		log.Printf("[iosdist sign-worker] task=%d not found: %v", taskID, err)
		return
	}
	if task.Status != "pending" {
		log.Printf("[iosdist sign-worker] task=%d skipping — status=%s", taskID, task.Status)
		return
	}

	source, err := s.getIOSVersion(task.SourceVersionID)
	if err != nil || source == nil {
		_ = s.markIOSSignTaskFailed(taskID, "源版本不存在", "")
		return
	}
	app, err := s.getIOSAppByID(task.AppID)
	if err != nil || app == nil {
		_ = s.markIOSSignTaskFailed(taskID, "应用不存在", "")
		return
	}
	cert, err := s.getIOSCertificate(task.CertID, app.OwnerUserID)
	if err != nil || cert == nil {
		_ = s.markIOSSignTaskFailed(taskID, "证书不存在或无权访问", "")
		return
	}
	profile, err := s.getIOSProfileForOwner(task.ProfileID, app.OwnerUserID)
	if err != nil || profile == nil {
		_ = s.markIOSSignTaskFailed(taskID, "Profile 不存在或无权访问", "")
		return
	}

	if err := s.markIOSSignTaskRunning(taskID); err != nil {
		log.Printf("[iosdist sign-worker] task=%d markRunning failed: %v", taskID, err)
		return
	}
	log.Printf("[iosdist sign-worker] task=%d running app=%d source_version=%d cert=%d profile=%d", taskID, app.ID, source.ID, cert.ID, profile.ID)

	workDir, err := os.MkdirTemp("", fmt.Sprintf("iosdist-sign-%d-", taskID))
	if err != nil {
		_ = s.markIOSSignTaskFailed(taskID, "无法创建临时目录", err.Error())
		return
	}
	defer os.RemoveAll(workDir)

	sourceIPA := filepath.Join(workDir, "source.ipa")
	if err := s.fetchAttachmentToFile(ctx, source.IPAUrl, sourceIPA); err != nil {
		_ = s.markIOSSignTaskFailed(taskID, "下载源 IPA 失败", err.Error())
		return
	}
	certFile := filepath.Join(workDir, "cert.p12")
	if err := s.fetchAttachmentToFile(ctx, cert.FileURL, certFile); err != nil {
		_ = s.markIOSSignTaskFailed(taskID, "下载证书失败", err.Error())
		return
	}
	profileFile := filepath.Join(workDir, "profile.mobileprovision")
	if err := s.fetchAttachmentToFile(ctx, profile.FileURL, profileFile); err != nil {
		_ = s.markIOSSignTaskFailed(taskID, "下载 Profile 失败", err.Error())
		return
	}

	password := cert.passwordCipher
	if cert.PasswordEncrypted {
		decrypted, err := s.decryptIOSDistSecret(cert.passwordCipher)
		if err != nil {
			_ = s.markIOSSignTaskFailed(taskID, "解密证书密码失败", err.Error())
			return
		}
		password = decrypted
	}

	outIPA := filepath.Join(workDir, "signed.ipa")
	cmdCtx, cancel := context.WithTimeout(ctx, iosdistSignTimeout)
	defer cancel()

	args := []string{"-k", certFile}
	if password != "" {
		args = append(args, "-p", password)
	}
	args = append(args, "-m", profileFile)
	// Optional rewrites. zsign cascades -b to embedded extensions
	// (the suffix after the original prefix is preserved).
	if task.NewBundleID != "" {
		args = append(args, "-b", task.NewBundleID)
	}
	if task.NewAppName != "" {
		args = append(args, "-n", task.NewAppName)
	}
	args = append(args, "-o", outIPA, "-z", "9", sourceIPA)
	log.Printf("[iosdist sign-worker] task=%d zsign args: %v", task.ID, redactPasswordArg(args))
	cmd := exec.CommandContext(cmdCtx, s.iosdistZsignPath, args...)
	combined, runErr := cmd.CombinedOutput()
	logText := truncateForLog(string(combined), iosdistSignLogCap)

	if runErr != nil {
		errMsg := fmt.Sprintf("zsign 退出非零: %v", runErr)
		// Pull the last meaningful line out of zsign output as a hint.
		if hint := lastNonEmptyLine(string(combined)); hint != "" {
			errMsg = fmt.Sprintf("zsign 失败: %s", hint)
		}
		_ = s.markIOSSignTaskFailed(taskID, errMsg, logText)
		log.Printf("[iosdist sign-worker] task=%d zsign failed: %v", taskID, runErr)
		return
	}

	stat, err := os.Stat(outIPA)
	if err != nil || stat.Size() == 0 {
		_ = s.markIOSSignTaskFailed(taskID, "zsign 完成但输出 IPA 不存在或为空", logText)
		return
	}

	sum, err := sha256File(outIPA)
	if err != nil {
		_ = s.markIOSSignTaskFailed(taskID, "校验输出 IPA 失败", logText)
		return
	}

	// Re-introspect the signed IPA — the embedded.mobileprovision
	// changes, possibly the bundle id (if the profile uses a wildcard
	// that overlaps), and we want the new metadata on the output row.
	parsed, parseErr := parseIPA(outIPA)
	if parseErr != nil {
		log.Printf("[iosdist sign-worker] task=%d output IPA parse failed (continuing): %v", taskID, parseErr)
	}

	storedName := fmt.Sprintf("iosdist_signed_%d_%s.ipa", taskID, generateSessionID()[:8])
	publicURL, err := s.chatStorage.Store(ctx, outIPA, storedName, "application/octet-stream")
	if err != nil {
		_ = s.markIOSSignTaskFailed(taskID, "上传签名 IPA 失败", logText+"\n"+err.Error())
		return
	}

	// Compose the new version row from the source + parsed output.
	newVersion := &IOSVersion{
		AppID:            app.ID,
		Version:          source.Version,
		BuildNumber:      source.BuildNumber,
		IPAUrl:           publicURL,
		IPAFilename:      storedName,
		IPASize:          stat.Size(),
		IPASHA256:        sum,
		ReleaseNotes:     fmt.Sprintf("Resigned from version %d (cert #%d, profile #%d)", source.ID, cert.ID, profile.ID),
		IsSigned:         true,
		DistributionType: pickDistTypeForSign(profile.Kind, source.DistributionType),
	}
	if parsed != nil {
		newVersion.IPABundleID = parsed.BundleID
		newVersion.IPAShortVersion = parsed.BundleShortVersion
		newVersion.IPABuildNumber = parsed.BundleVersion
		newVersion.IPADisplayName = parsed.BundleDisplayName
		newVersion.IPAMinOS = parsed.MinimumOSVersion
		newVersion.IPAHasEmbeddedPP = parsed.HasEmbeddedProvProf
	}
	if err := s.createIOSVersion(newVersion); err != nil {
		_ = s.markIOSSignTaskFailed(taskID, "写入新版本记录失败", logText+"\n"+err.Error())
		return
	}
	_ = s.touchIOSApp(app.ID)

	if err := s.markIOSSignTaskSuccess(taskID, newVersion.ID, logText); err != nil {
		log.Printf("[iosdist sign-worker] task=%d markSuccess failed: %v", taskID, err)
	}
	log.Printf("[iosdist sign-worker] task=%d ok → version_id=%d url=%s", taskID, newVersion.ID, publicURL)
}

// pickDistTypeForSign maps the profile kind onto the distribution_type
// enum we expose on iosdist_versions. ASC profiles map cleanly; if the
// profile's kind is empty or unrecognized we fall back to the source
// version's existing distribution_type so OTA install rules stay
// consistent.
func pickDistTypeForSign(profileKind, sourceDist string) string {
	switch profileKind {
	case "ad_hoc", "enterprise", "development", "app_store":
		return profileKind
	}
	if sourceDist != "" {
		return sourceDist
	}
	return "ad_hoc"
}

// fetchAttachmentToFile copies an attachment URL to a local file. We
// handle two kinds of URLs:
//   - "/uploads/<key>" — local AttachmentStorage; copy from the upload dir
//   - http(s)://       — remote (R2 public, mzstatic, etc.); HTTP GET
func (s *Server) fetchAttachmentToFile(ctx context.Context, srcURL, dstPath string) error {
	if strings.HasPrefix(srcURL, "/uploads/") && s.uploadDir != "" {
		return copyFile(filepath.Join(s.uploadDir, strings.TrimPrefix(srcURL, "/uploads/")), dstPath)
	}
	if !strings.HasPrefix(srcURL, "http://") && !strings.HasPrefix(srcURL, "https://") {
		return fmt.Errorf("unsupported attachment URL: %q", srcURL)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, srcURL, nil)
	if err != nil {
		return err
	}
	client := &http.Client{Timeout: 2 * time.Minute}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("download %q: HTTP %d", srcURL, resp.StatusCode)
	}
	out, err := os.Create(dstPath)
	if err != nil {
		return err
	}
	defer out.Close()
	if _, err := io.Copy(out, resp.Body); err != nil {
		return err
	}
	return nil
}

// redactPasswordArg returns a copy of args with the value following -p
// replaced by "***" so we can log the zsign invocation safely.
func redactPasswordArg(args []string) []string {
	out := make([]string, len(args))
	copy(out, args)
	for i := 0; i < len(out)-1; i++ {
		if out[i] == "-p" {
			out[i+1] = "***"
		}
	}
	return out
}

func lastNonEmptyLine(s string) string {
	lines := strings.Split(strings.TrimSpace(s), "\n")
	for i := len(lines) - 1; i >= 0; i-- {
		if l := strings.TrimSpace(lines[i]); l != "" {
			return l
		}
	}
	return ""
}
