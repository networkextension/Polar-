package dock

// Public-facing iOS distribution share page.
//
// Three endpoints, all unauthenticated and keyed by the random
// public_slug on the app row:
//
//   GET  /iosdist/share/:slug                 → server-rendered landing page
//   POST /iosdist/share/:slug/install         → mints a fresh OTA token + manifest URL
//   POST /iosdist/share/:slug/test-request    → "申请测试" form: log to DB, optionally
//                                                forward to ASC ascCreateTester
//
// The slug acts as a capability — anyone with the URL can see the app
// and submit invite requests, but cannot enumerate other apps. Visibility
// is gated by is_public; turning that off makes the slug return 404
// without invalidating the slug itself, so the operator can re-enable
// without breaking flyers / printed QR codes.

import (
	"fmt"
	"html"
	"net/http"
	"net/mail"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

// ---- public plaza (discovery) -------------------------------------------

const iosdistPlazaPageSize = 24

func (s *Server) handleIOSPublicPlaza(c *gin.Context) {
	page := 1
	if v := c.Query("page"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			page = n
		}
	}
	offset := (page - 1) * iosdistPlazaPageSize
	apps, err := s.listPublicIOSApps(iosdistPlazaPageSize, offset)
	if err != nil {
		c.String(http.StatusInternalServerError, "server error")
		return
	}
	total, _ := s.countPublicIOSApps()
	pageHTML := s.renderIOSPlazaPage(c, apps, page, total)
	c.Header("Content-Type", "text/html; charset=utf-8")
	c.Header("Cache-Control", "no-store")
	c.String(http.StatusOK, pageHTML)
}

func (s *Server) renderIOSPlazaPage(c *gin.Context, apps []IOSApp, page, total int) string {
	base := s.installPublicBaseURL(c)

	cardsHTML := strings.Builder{}
	if len(apps) == 0 {
		cardsHTML.WriteString(`<div class="empty">暂无公开应用</div>`)
	} else {
		for _, a := range apps {
			iconHTML := `<div class="card-icon-fb">📱</div>`
			if a.IconURL != "" {
				iconHTML = fmt.Sprintf(`<img class="card-icon" src="%s" alt="%s" />`, html.EscapeString(a.IconURL), html.EscapeString(a.Name))
			}
			desc := strings.TrimSpace(a.Description)
			if len([]rune(desc)) > 80 {
				r := []rune(desc)
				desc = string(r[:80]) + "…"
			}
			descHTML := ""
			if desc != "" {
				descHTML = `<div class="card-desc">` + html.EscapeString(desc) + `</div>`
			}
			cardsHTML.WriteString(fmt.Sprintf(`
<a class="card" href="/iosdist/share/%s">
  <div class="card-head">
    %s
    <div class="card-text">
      <div class="card-title">%s</div>
      <div class="card-bundle">%s</div>
    </div>
  </div>
  %s
  <div class="card-footer">查看详情 →</div>
</a>`,
				html.EscapeString(a.PublicSlug),
				iconHTML,
				html.EscapeString(a.Name),
				html.EscapeString(a.BundleID),
				descHTML,
			))
		}
	}

	// Pagination links — only render when needed.
	pagerHTML := ""
	totalPages := (total + iosdistPlazaPageSize - 1) / iosdistPlazaPageSize
	if totalPages > 1 {
		var prev, next string
		if page > 1 {
			prev = fmt.Sprintf(`<a class="pager-btn" href="?page=%d">← 上一页</a>`, page-1)
		} else {
			prev = `<span class="pager-btn pager-btn-disabled">← 上一页</span>`
		}
		if page < totalPages {
			next = fmt.Sprintf(`<a class="pager-btn" href="?page=%d">下一页 →</a>`, page+1)
		} else {
			next = `<span class="pager-btn pager-btn-disabled">下一页 →</span>`
		}
		pagerHTML = fmt.Sprintf(`<div class="pager">%s<span class="pager-info">%d / %d</span>%s</div>`, prev, page, totalPages, next)
	}

	_ = base
	return fmt.Sprintf(`<!DOCTYPE html>
<html lang="zh-CN"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>App 广场</title>
<style>
*{box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;margin:0;padding:0;background:#f2f2f7;color:#1c1c1e;-webkit-font-smoothing:antialiased}
.wrap{max-width:1100px;margin:0 auto;padding:24px 20px 60px}
.head{display:flex;align-items:flex-end;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:20px}
h1{margin:0;font-size:30px;font-weight:700;letter-spacing:-0.02em}
.subtitle{color:#8e8e93;font-size:14px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px}
.card{display:flex;flex-direction:column;justify-content:space-between;background:#fff;border-radius:18px;padding:18px;box-shadow:0 1px 3px rgba(0,0,0,.04);text-decoration:none;color:inherit;transition:transform .18s,box-shadow .18s;min-height:160px}
.card:hover{transform:translateY(-2px);box-shadow:0 8px 20px rgba(0,0,0,.08)}
.card-head{display:flex;gap:14px;align-items:flex-start}
.card-icon,.card-icon-fb{width:60px;height:60px;border-radius:14px;flex-shrink:0;background:linear-gradient(135deg,#e9e9ef,#cfd0d6);display:flex;align-items:center;justify-content:center;font-size:26px;color:#888;object-fit:cover}
.card-text{flex:1;min-width:0}
.card-title{font-weight:600;font-size:17px;line-height:1.2;margin-bottom:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.card-bundle{font-size:11px;color:#8e8e93;font-family:ui-monospace,Menlo,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.card-desc{margin-top:12px;color:#3c3c43;font-size:13px;line-height:1.5;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.card-footer{margin-top:14px;color:#007aff;font-size:13px;font-weight:500}
.empty{grid-column:1/-1;padding:80px 20px;text-align:center;color:#8e8e93;font-size:15px}
.pager{display:flex;align-items:center;justify-content:center;gap:14px;margin-top:36px}
.pager-btn{padding:10px 16px;border-radius:10px;background:#fff;color:#007aff;text-decoration:none;font-size:14px;font-weight:500;box-shadow:0 1px 2px rgba(0,0,0,.04)}
.pager-btn-disabled{color:#c7c7cc;background:transparent;box-shadow:none}
.pager-info{color:#8e8e93;font-size:13px}
@media(prefers-color-scheme:dark){
  body{background:#000;color:#f2f2f7}
  .card,.pager-btn{background:#1c1c1e;box-shadow:none}
  .card-bundle,.subtitle,.card-desc{color:#aeaeb2}
  .pager-btn{color:#0a84ff}
  .pager-btn-disabled{background:transparent;color:#48484a}
  .empty{color:#aeaeb2}
}
</style>
</head><body>
<div class="wrap">
  <div class="head">
    <div>
      <h1>App 广场</h1>
      <div class="subtitle">浏览所有公开发布的 iOS 应用，点卡片查看详情与安装方式</div>
    </div>
    <div class="subtitle">共 %d 个应用</div>
  </div>
  <div class="grid">%s</div>
  %s
</div>
</body></html>`,
		total,
		cardsHTML.String(),
		pagerHTML,
	)
}

// ---- public landing page ------------------------------------------------

func (s *Server) handleIOSPublicShareHTML(c *gin.Context) {
	app, latest, ok := s.lookupPublicAppForRequest(c)
	if !ok {
		return
	}
	pageHTML := s.renderIOSSharePage(c, app, latest)
	c.Header("Content-Type", "text/html; charset=utf-8")
	c.Header("Cache-Control", "no-store")
	c.String(http.StatusOK, pageHTML)
}

// lookupPublicAppForRequest validates the slug and visibility, fetches
// the latest version, and writes a 404 / 410 response when the request
// can't proceed. Returns ok=false if the caller should stop.
func (s *Server) lookupPublicAppForRequest(c *gin.Context) (*IOSApp, *IOSVersion, bool) {
	slug := strings.TrimSpace(c.Param("slug"))
	app, err := s.getIOSAppBySlug(slug)
	if err != nil {
		c.String(http.StatusInternalServerError, "server error")
		return nil, nil, false
	}
	if app == nil || !app.IsPublic {
		c.String(http.StatusNotFound, "not found")
		return nil, nil, false
	}
	versions, _ := s.listIOSVersions(app.ID)
	var latest *IOSVersion
	if len(versions) > 0 {
		latest = &versions[0]
	}
	return app, latest, true
}

// renderIOSSharePage hand-rolls the HTML — single page, mobile-first,
// loosely App-Store-feeling. The form actions are JSON endpoints; we
// only need a tiny inline script.
func (s *Server) renderIOSSharePage(c *gin.Context, app *IOSApp, latest *IOSVersion) string {
	base := s.installPublicBaseURL(c)
	shareURL := base + "/iosdist/share/" + app.PublicSlug

	displayName := html.EscapeString(app.Name)
	if latest != nil && latest.IPADisplayName != "" {
		displayName = html.EscapeString(latest.IPADisplayName)
	}
	bundle := html.EscapeString(app.BundleID)

	versionLine := "暂无可用版本"
	sizeLine := ""
	minOSLine := ""
	releaseNotesHTML := ""
	canOTAInstall := false
	if latest != nil {
		ver := latest.Version
		if ver == "" || ver == "0" {
			ver = latest.IPAShortVersion
		}
		buildSuffix := ""
		if latest.BuildNumber != "" {
			buildSuffix = " · build " + html.EscapeString(latest.BuildNumber)
		}
		versionLine = fmt.Sprintf("v%s%s · %s", html.EscapeString(ver), buildSuffix, html.EscapeString(distTypeLabelForPublic(latest.DistributionType)))
		if latest.IPASize > 0 {
			sizeLine = fmt.Sprintf("%.1f MB", float64(latest.IPASize)/(1024*1024))
		}
		if latest.IPAMinOS != "" {
			minOSLine = "iOS " + html.EscapeString(latest.IPAMinOS) + "+"
		}
		if latest.ReleaseNotes != "" {
			releaseNotesHTML = `<div class="notes">` + html.EscapeString(latest.ReleaseNotes) + `</div>`
		}
		canOTAInstall = iosdistDistTypeOTAInstallable(latest.DistributionType) && latest.IPAUrl != ""
	}

	iconHTML := `<div class="icon-fallback">📱</div>`
	if app.IconURL != "" {
		iconHTML = fmt.Sprintf(`<img class="icon" src="%s" alt="%s" />`, html.EscapeString(app.IconURL), displayName)
	}

	// Action buttons: order is OTA install → TestFlight → App Store
	// (we only emit the buttons that actually have a destination).
	var actionsHTML strings.Builder
	if canOTAInstall {
		actionsHTML.WriteString(`<button id="installBtn" class="btn primary" type="button">安装</button>`)
	}
	if app.TestFlightURL != "" {
		actionsHTML.WriteString(fmt.Sprintf(`<a class="btn" href="%s" target="_blank" rel="noopener">通过 TestFlight 安装</a>`, html.EscapeString(app.TestFlightURL)))
	}
	if app.ASCAppID != "" {
		actionsHTML.WriteString(fmt.Sprintf(`<a class="btn" href="https://apps.apple.com/app/id%s" target="_blank" rel="noopener">在 App Store 查看</a>`, html.EscapeString(app.ASCAppID)))
	}
	if actionsHTML.Len() == 0 {
		actionsHTML.WriteString(`<span class="muted">暂无可用安装方式</span>`)
	}

	// Secondary links: marketing site + support page. Rendered as a
	// quieter secondary row below primary CTAs.
	var linksHTML strings.Builder
	if strings.TrimSpace(app.MarketingURL) != "" {
		linksHTML.WriteString(fmt.Sprintf(`<a class="link" href="%s" target="_blank" rel="noopener">官方网站</a>`, html.EscapeString(app.MarketingURL)))
	}
	if strings.TrimSpace(app.SupportURL) != "" {
		linksHTML.WriteString(fmt.Sprintf(`<a class="link" href="%s" target="_blank" rel="noopener">技术支持</a>`, html.EscapeString(app.SupportURL)))
	}
	linksRowHTML := ""
	if linksHTML.Len() > 0 {
		linksRowHTML = `<div class="links">` + linksHTML.String() + `</div>`
	}

	requestFormHTML := ""
	if app.ASCBetaGroupID != "" {
		requestFormHTML = `
<section class="card">
  <h3>申请加入测试</h3>
  <p class="muted">填写邮箱即可申请。提交后我们会通过 App Store Connect 向你发送官方 TestFlight 邀请邮件，按邮件指引在 TestFlight App 内接受邀请即可。</p>
  <form id="requestForm">
    <input id="reqEmail" type="email" required placeholder="your@email.com" />
    <div class="row">
      <input id="reqFirst" type="text" placeholder="名 (可选)" />
      <input id="reqLast" type="text" placeholder="姓 (可选)" />
    </div>
    <button class="btn primary" type="submit">提交申请</button>
    <div id="reqStatus" class="status"></div>
  </form>
</section>`
	}

	// Promotional text is small italic above the longer description (App
	// Store visual analog). Description is the main body. Keywords show
	// as subtle pills near the bundle line.
	descHTML := ""
	if strings.TrimSpace(app.PromotionalText) != "" {
		descHTML += `<p class="promo">` + html.EscapeString(app.PromotionalText) + `</p>`
	}
	if strings.TrimSpace(app.Description) != "" {
		descHTML += `<p class="desc">` + html.EscapeString(app.Description) + `</p>`
	}

	keywordsHTML := ""
	if strings.TrimSpace(app.Keywords) != "" {
		var pills []string
		for _, k := range strings.Split(app.Keywords, ",") {
			k = strings.TrimSpace(k)
			if k != "" {
				pills = append(pills, `<span class="kw">`+html.EscapeString(k)+`</span>`)
			}
		}
		if len(pills) > 0 {
			keywordsHTML = `<div class="kws">` + strings.Join(pills, "") + `</div>`
		}
	}

	// "What's New" — prefer the app-level whats_new from ASC (this is
	// the latest App Store version's text), fall back to the most recent
	// platform-uploaded version's release_notes when ASC didn't supply
	// any.
	whatsNewBody := strings.TrimSpace(app.WhatsNew)
	whatsNewSource := "ASC"
	if whatsNewBody == "" && latest != nil && strings.TrimSpace(latest.ReleaseNotes) != "" {
		whatsNewBody = latest.ReleaseNotes
		whatsNewSource = "本次构建"
	}
	whatsNewHTML := ""
	if whatsNewBody != "" {
		whatsNewHTML = fmt.Sprintf(
			`<section class="card whatsnew"><h3>新版本 <span class="src">· %s</span></h3><div class="notes">%s</div></section>`,
			html.EscapeString(whatsNewSource),
			html.EscapeString(whatsNewBody),
		)
	}
	releaseNotesHTML = "" // moved into whatsNewHTML above; clear the old slot

	// Inline script: install button hits POST /install, redirects to itms-services://
	// The test request form posts JSON.
	scriptTpl := `
const installBtn = document.getElementById("installBtn");
if (installBtn) {
  installBtn.addEventListener("click", async () => {
    installBtn.disabled = true; installBtn.textContent = "请求中...";
    try {
      const r = await fetch("%s/iosdist/share/%s/install", { method: "POST" });
      if (!r.ok) throw new Error("install token failed");
      const data = await r.json();
      window.location.href = data.itms_services;
    } catch (e) {
      alert("无法生成安装链接，请稍后重试。");
      installBtn.disabled = false; installBtn.textContent = "安装";
    }
  });
}
const form = document.getElementById("requestForm");
if (form) {
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const status = document.getElementById("reqStatus");
    status.textContent = "提交中...";
    try {
      const r = await fetch("%s/iosdist/share/%s/test-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: document.getElementById("reqEmail").value.trim(),
          first_name: document.getElementById("reqFirst").value.trim(),
          last_name: document.getElementById("reqLast").value.trim(),
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "提交失败");
      status.textContent = data.delivered === false
        ? "已记录你的申请，开发者通过后会尽快邀请你。"
        : "✓ 邀请已发送，请查收邮箱。";
      form.reset();
    } catch (e) {
      status.textContent = "提交失败：" + e.message;
    }
  });
}
`
	script := fmt.Sprintf(scriptTpl, base, app.PublicSlug, base, app.PublicSlug)

	return fmt.Sprintf(`<!DOCTYPE html>
<html lang="zh-CN"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>%s</title>
<meta property="og:title" content="%s">
<meta property="og:url" content="%s">
<style>
*{box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;margin:0;padding:0;background:#f2f2f7;color:#1c1c1e;-webkit-font-smoothing:antialiased}
.wrap{max-width:560px;margin:0 auto;padding:24px}
.hero{display:flex;gap:16px;align-items:flex-start;background:#fff;border-radius:18px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,.04)}
.icon,.icon-fallback{width:96px;height:96px;border-radius:22px;flex-shrink:0;background:linear-gradient(135deg,#e9e9ef,#cfd0d6);display:flex;align-items:center;justify-content:center;font-size:42px;color:#888;object-fit:cover}
.title{font-size:22px;font-weight:600;margin:0 0 4px;line-height:1.2}
.bundle{font-size:12px;color:#8e8e93;margin-bottom:8px;font-family:ui-monospace,Menlo,monospace;word-break:break-all}
.meta{font-size:13px;color:#3c3c43}
.meta span{display:inline-block;margin-right:10px}
.actions{display:flex;flex-direction:column;gap:10px;margin:16px 0}
.btn{appearance:none;border:none;padding:14px 18px;border-radius:14px;font-size:15px;font-weight:600;text-decoration:none;text-align:center;color:#007aff;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.04);cursor:pointer;display:block;transition:opacity .15s}
.btn:active{opacity:.6}
.btn.primary{background:#007aff;color:#fff;box-shadow:0 4px 12px rgba(0,122,255,.3)}
.muted{color:#8e8e93;font-size:13px}
.promo{margin:16px 0 4px;color:#1c1c1e;font-size:14px;font-style:italic;line-height:1.5;white-space:pre-wrap}
.desc{margin:8px 0 16px;color:#3c3c43;line-height:1.55;font-size:14px;white-space:pre-wrap}
.notes{font-size:13px;color:#3c3c43;white-space:pre-wrap;line-height:1.55}
.kws{margin:10px 0 0;display:flex;flex-wrap:wrap;gap:6px}
.kw{background:#fff;border-radius:8px;padding:3px 10px;font-size:12px;color:#3c3c43;box-shadow:0 1px 2px rgba(0,0,0,.04)}
.whatsnew h3{margin:0 0 6px;font-size:15px}
.whatsnew .src{color:#8e8e93;font-weight:normal;font-size:12px}
.links{display:flex;gap:14px;margin:16px 0 0;flex-wrap:wrap}
.link{color:#007aff;text-decoration:none;font-size:13px}
.link:active{opacity:.6}
.card{background:#fff;border-radius:18px;padding:20px;margin-top:16px;box-shadow:0 1px 3px rgba(0,0,0,.04)}
.card h3{margin:0 0 8px;font-size:17px}
.card form{display:flex;flex-direction:column;gap:10px;margin-top:12px}
.card input{width:100%%;padding:12px;border:1px solid #d1d1d6;border-radius:10px;font-size:14px;font-family:inherit}
.card .row{display:flex;gap:8px}
.card .row input{flex:1;min-width:0}
.status{font-size:13px;color:#8e8e93;min-height:1em}
.tip{margin:24px 0;padding:14px 16px;background:#fff8e1;border-radius:12px;font-size:12px;color:#5d4e15;line-height:1.6}
.footer{margin:24px 0 8px;text-align:center;font-size:12px;color:#aeaeb2}
@media(prefers-color-scheme:dark){
  body{background:#000;color:#f2f2f7}
  .hero,.card,.btn,.notes,.kw{background:#1c1c1e;box-shadow:none}
  .btn{color:#0a84ff}
  .btn.primary{background:#0a84ff;color:#fff}
  .card input{background:#2c2c2e;border-color:#3a3a3c;color:#f2f2f7}
  .bundle,.muted,.meta,.desc,.promo,.status,.notes,.kw,.whatsnew .src{color:#aeaeb2}
  .link{color:#0a84ff}
  .tip{background:#3a2f15;color:#f0d97a}
}
</style>
</head><body>
<div class="wrap">
  <div class="hero">
    %s
    <div style="flex:1;min-width:0">
      <h1 class="title">%s</h1>
      <div class="bundle">%s</div>
      <div class="meta">
        <span>%s</span>
        %s
        %s
      </div>
      %s
    </div>
  </div>
  %s
  <div class="actions">%s</div>
  %s
  %s
  %s
  %s
  <div class="tip">
    iOS 16.4 及以上需在「设置 → 隐私与安全性 → 开发者模式」中开启开发者模式后，方可启动通过 OTA 安装的应用。请在 iPhone 自带 Safari 中打开本页面。
  </div>
  <div class="footer">由 iOS 分发平台提供 · <a href="/iosdist/plaza" style="color:inherit;text-decoration:underline">App 广场</a> · <a href="%s" style="color:inherit;text-decoration:underline">分享链接</a></div>
</div>
<script>%s</script>
</body></html>`,
		displayName, displayName, html.EscapeString(shareURL),
		iconHTML,
		displayName,
		bundle,
		versionLine,
		ifNotEmpty(sizeLine, `<span>`+sizeLine+`</span>`),
		ifNotEmpty(minOSLine, `<span>`+minOSLine+`</span>`),
		keywordsHTML,
		descHTML,
		actionsHTML.String(),
		linksRowHTML,
		releaseNotesHTML,
		whatsNewHTML,
		requestFormHTML,
		html.EscapeString(shareURL),
		script,
	)
}

func ifNotEmpty(s, full string) string {
	if s == "" {
		return ""
	}
	return full
}

func distTypeLabelForPublic(t string) string {
	switch t {
	case "ad_hoc":
		return "Ad-hoc"
	case "enterprise":
		return "Enterprise"
	case "development":
		return "Development"
	case "app_store":
		return "App Store"
	}
	return t
}

// ---- /install endpoint --------------------------------------------------

func (s *Server) handleIOSPublicShareInstall(c *gin.Context) {
	app, latest, ok := s.lookupPublicAppForRequest(c)
	if !ok {
		return
	}
	if latest == nil || latest.IPAUrl == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "暂无可用版本"})
		return
	}
	if !iosdistDistTypeOTAInstallable(latest.DistributionType) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "该版本不可通过 OTA 安装"})
		return
	}
	tok := &IOSInstallToken{
		Token:     generateIOSInstallToken(),
		VersionID: latest.ID,
		CreatedBy: app.OwnerUserID,
		ExpiresAt: time.Now().Add(iosdistTokenTTL),
	}
	if err := s.createIOSInstallToken(tok); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	base := s.installPublicBaseURL(c)
	manifestURL := base + "/iosdist/manifest/" + tok.Token + ".plist"
	c.JSON(http.StatusOK, gin.H{
		"install_url":   base + "/iosdist/install/" + tok.Token,
		"manifest_url":  manifestURL,
		"itms_services": "itms-services://?action=download-manifest&url=" + manifestURL,
	})
}

// ---- /test-request endpoint --------------------------------------------

type iosShareTestRequestPayload struct {
	Email     string `json:"email"`
	FirstName string `json:"first_name"`
	LastName  string `json:"last_name"`
}

// In-memory IP throttler. Keyed by source IP, evicted on next access
// after the window passes. Fine for single-instance deploys; a Redis
// bucket would replace this for HA.
var (
	iosShareIPThrottleMu sync.Mutex
	iosShareIPThrottle   = map[string][]time.Time{}
)

const (
	iosShareIPMaxPerHour     = 10
	iosShareEmailDuplicateTTL = 24 * time.Hour
)

func iosShareThrottleAllow(ip string) bool {
	if ip == "" {
		return true
	}
	now := time.Now()
	cutoff := now.Add(-time.Hour)
	iosShareIPThrottleMu.Lock()
	defer iosShareIPThrottleMu.Unlock()
	hits := iosShareIPThrottle[ip]
	pruned := hits[:0]
	for _, t := range hits {
		if t.After(cutoff) {
			pruned = append(pruned, t)
		}
	}
	if len(pruned) >= iosShareIPMaxPerHour {
		iosShareIPThrottle[ip] = pruned
		return false
	}
	pruned = append(pruned, now)
	iosShareIPThrottle[ip] = pruned
	return true
}

func (s *Server) handleIOSPublicShareTestRequest(c *gin.Context) {
	app, _, ok := s.lookupPublicAppForRequest(c)
	if !ok {
		return
	}
	var req iosShareTestRequestPayload
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的输入数据"})
		return
	}
	email := strings.TrimSpace(req.Email)
	if _, err := mail.ParseAddress(email); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "邮箱格式无效"})
		return
	}
	ip := c.ClientIP()
	if !iosShareThrottleAllow(ip) {
		c.JSON(http.StatusTooManyRequests, gin.H{"error": "请求过于频繁，请稍后再试"})
		return
	}
	// De-dup: same email + same app within 24h is rejected to keep ASC
	// from sending duplicate invites.
	if n, err := s.countIOSTestRequestsByEmail(app.ID, email, time.Now().Add(-iosShareEmailDuplicateTTL)); err == nil && n > 0 {
		c.JSON(http.StatusConflict, gin.H{"error": "该邮箱在 24 小时内已申请过，请勿重复提交"})
		return
	}

	rec := &IOSTestRequest{
		AppID:     app.ID,
		Email:     email,
		FirstName: strings.TrimSpace(req.FirstName),
		LastName:  strings.TrimSpace(req.LastName),
		SourceIP:  ip,
		UserAgent: c.GetHeader("User-Agent"),
		Status:    "pending",
	}
	if err := s.createIOSTestRequest(rec); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}

	// Try to forward to ASC if the operator has it configured AND a
	// beta group is bound. Anything missing → keep status=pending so
	// the operator can manually invite from the admin inbox.
	delivered := false
	if app.ASCBetaGroupID != "" {
		if cfg, err := s.getIOSASCConfig(app.OwnerUserID); err == nil && cfg != nil {
			if err := s.ascCreateTester(c.Request.Context(), cfg, email, rec.FirstName, rec.LastName, []string{app.ASCBetaGroupID}); err != nil {
				_ = s.markIOSTestRequest(rec.ID, "failed", err.Error())
			} else {
				_ = s.markIOSTestRequest(rec.ID, "sent", "tester invited via ASC")
				delivered = true
			}
		}
	}

	c.JSON(http.StatusOK, gin.H{"ok": true, "delivered": delivered})
}
