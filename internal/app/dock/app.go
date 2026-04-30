package dock

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"html/template"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/go-webauthn/webauthn/webauthn"
	geoip2 "github.com/oschwald/geoip2-golang/v2"
	"github.com/redis/go-redis/v9"
)

type Server struct {
	db                  *sql.DB
	redis               *redis.Client
	router              *gin.Engine
	addr                string
	redisPrefix         string
	markdownDir         string
	uploadDir           string
	geoLiteDBPath       string
	geoIPReader         *geoip2.Reader
	webAuthn            *webauthn.WebAuthn
	passkeyAuto         bool
	passkeyRPID         string
	passkeyOrigin       string
	passkeyRPName       string
	passkeySessions     map[string]passkeySession
	passkeyMu           sync.Mutex
	wsHub               *wsHub
	workDir             string
	aiAgent             *aiAgent
	chatStorage         AttachmentStorage
	backgroundCtx       context.Context
	backgroundStop      context.CancelFunc
	applePushTopic      string
	applePushTopicDev   string
	applePushTopicProd  string
	applePushKeyID      string
	applePushKeyIDDev   string
	applePushKeyIDProd  string
	applePushTeamID     string
	applePushTeamIDDev  string
	applePushTeamIDProd string
	apnsMu              sync.Mutex
	apnsClients         map[string]*http.Client
	apnsTokens          map[string]cachedAPNSToken
	publicBaseURL       string
	mailer              MailSender
	// Video studio: provider client + bg context for submissions, in-process
	// render queue for ffmpeg concat. Workers (poll + render) are spawned in
	// NewServer and shut down via backgroundCtx cancellation.
	videoProvider        *videoProviderClient
	videoProviderCtx     context.Context
	videoRenderQueue     chan int64
	videoPollIntervalSec int
	videoSeedanceBaseURL string
	videoSeedanceModel   string
	videoSeedanceAPIKey  string
}

func NewServer(cfg Config) (*Server, error) {
	db, err := openDB(cfg.PostgresDSN)
	if err != nil {
		return nil, err
	}

	server := &Server{
		db:                  db,
		addr:                cfg.Addr,
		redisPrefix:         cfg.RedisPrefix,
		markdownDir:         cfg.MarkdownDir,
		uploadDir:           cfg.UploadDir,
		geoLiteDBPath:       cfg.GeoLiteDBPath,
		applePushTopic:      cfg.ApplePushTopic,
		applePushTopicDev:   cfg.ApplePushTopicDev,
		applePushTopicProd:  cfg.ApplePushTopicProd,
		applePushKeyID:      cfg.ApplePushKeyID,
		applePushKeyIDDev:   cfg.ApplePushKeyIDDev,
		applePushKeyIDProd:  cfg.ApplePushKeyIDProd,
		applePushTeamID:     cfg.ApplePushTeamID,
		applePushTeamIDDev:  cfg.ApplePushTeamIDDev,
		applePushTeamIDProd: cfg.ApplePushTeamIDProd,
		publicBaseURL:       strings.TrimRight(cfg.PublicBaseURL, "/"),
		mailer:              newSMTPMailer(cfg),
		apnsClients:         make(map[string]*http.Client),
		apnsTokens:          make(map[string]cachedAPNSToken),
		redis: redis.NewClient(&redis.Options{
			Addr:     cfg.RedisAddr,
			Password: cfg.RedisPassword,
			DB:       cfg.RedisDB,
		}),
	}
	server.backgroundCtx, server.backgroundStop = context.WithCancel(context.Background())

	workDir, err := os.Getwd()
	if err == nil {
		server.workDir = workDir
	}

	chatStorage, err := newAttachmentStorage(cfg.UploadDir, cfg)
	if err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("init chat storage: %w", err)
	}
	server.chatStorage = chatStorage
	if chatStorage.IsRemote() {
		log.Printf("chat attachment storage: Cloudflare R2 bucket=%s", cfg.CloudflareR2Bucket)
	} else {
		log.Printf("chat attachment storage: local filesystem dir=%s", cfg.UploadDir)
	}

	if err := server.redis.Ping(context.Background()).Err(); err != nil {
		_ = db.Close()
		return nil, err
	}

	if cfg.GeoLiteDBPath != "" {
		reader, err := geoip2.Open(cfg.GeoLiteDBPath)
		if err != nil {
			log.Printf("geolite disabled: %v", err)
		} else {
			server.geoIPReader = reader
		}
	}

	server.passkeyRPID = cfg.PasskeyRPID
	server.passkeyOrigin = cfg.PasskeyOrigin
	server.passkeyRPName = cfg.PasskeyRPName
	server.passkeyAuto = cfg.PasskeyOrigin == DefaultPasskeyOrigin && cfg.PasskeyRPID == DefaultPasskeyRPID

	rpID := cfg.PasskeyRPID
	if rpID == DefaultPasskeyRPID {
		if parsed, err := url.Parse(cfg.PasskeyOrigin); err == nil && parsed.Host != "" {
			host := parsed.Host
			if strings.Contains(host, ":") {
				if splitHost, _, err := net.SplitHostPort(host); err == nil && splitHost != "" {
					host = splitHost
				}
			}
			if host != "" {
				rpID = host
			}
		}
	}

	webAuthn, err := webauthn.New(&webauthn.Config{
		RPDisplayName: cfg.PasskeyRPName,
		RPID:          rpID,
		RPOrigins:     []string{cfg.PasskeyOrigin},
	})
	if err != nil {
		_ = db.Close()
		return nil, err
	}

	server.webAuthn = webAuthn
	server.passkeySessions = make(map[string]passkeySession)
	server.wsHub = newWSHub()
	server.wsHub.onPresenceChanged = server.handlePresenceChange
	server.wsHub.onThreadViewChanged = server.handleThreadViewChange
	server.wsHub.onConnectionTouched = server.handleConnectionTouch
	go server.wsHub.run()
	go server.runChatEventSubscriber(server.backgroundCtx)
	go server.runPushDeliveryWorker(server.backgroundCtx)

	if err := server.ensureSystemUser(); err != nil {
		_ = db.Close()
		return nil, err
	}

	server.aiAgent = newAIAgent(server, cfg)
	if server.aiAgent != nil {
		go server.aiAgent.run()
	}

	// Video studio wiring. The provider client is stateless — created here
	// once so handlers and the poll worker share the same HTTP transport.
	server.videoProvider = newVideoProviderClient()
	server.videoProviderCtx = server.backgroundCtx
	server.videoPollIntervalSec = cfg.VideoPollIntervalSeconds
	server.videoSeedanceBaseURL = cfg.VideoSeedanceBaseURL
	server.videoSeedanceModel = cfg.VideoSeedanceModel
	server.videoSeedanceAPIKey = cfg.VideoSeedanceAPIKey
	if err := server.ensureSeedanceSystemConfig(); err != nil {
		log.Printf("seed seedance system config failed: %v", err)
	}
	server.startVideoRenderWorker(server.backgroundCtx)
	go server.runVideoPollWorker(server.backgroundCtx)

	server.router = gin.Default()
	// Increase max upload size for video files (default gin limit is 32 MiB)
	server.router.MaxMultipartMemory = 512 << 20 // 512 MiB
	server.router.Use(corsMiddleware())
	server.router.Use(server.LanguageMiddleware())
	if server.uploadDir != "" {
		server.router.Static("/uploads", server.uploadDir)
	}
	server.registerRoutes()

	return server, nil
}

func (s *Server) Run() error {
	return s.router.Run(s.addr)
}

func (s *Server) Close() error {
	if s.backgroundStop != nil {
		s.backgroundStop()
	}
	if s.aiAgent != nil {
		s.aiAgent.stop()
	}
	if s.geoIPReader != nil {
		_ = s.geoIPReader.Close()
	}
	if s.redis != nil {
		_ = s.redis.Close()
	}
	if s.db == nil {
		return nil
	}
	return s.db.Close()
}

// ensureSeedanceSystemConfig seeds an LLMConfig row with provider_kind =
// 'video.seedance' on first boot when VIDEO_SEEDANCE_API_KEY is set, so the
// operator can ship a working default without clicking through the UI form.
// Idempotent: if a row already exists for the system user we leave it alone
// (operators can edit it via the LLM-config form afterwards).
func (s *Server) ensureSeedanceSystemConfig() error {
	if s == nil {
		return nil
	}
	apiKey := strings.TrimSpace(s.videoSeedanceAPIKey)
	baseURL := strings.TrimSpace(s.videoSeedanceBaseURL)
	model := strings.TrimSpace(s.videoSeedanceModel)
	if apiKey == "" || baseURL == "" || model == "" {
		return nil
	}
	var existingID int64
	err := s.db.QueryRow(
		`SELECT id FROM llm_configs WHERE owner_user_id = $1 AND provider_kind = $2 LIMIT 1`,
		systemUserID, LLMConfigKindVideoSeedance,
	).Scan(&existingID)
	if err == nil && existingID > 0 {
		return nil
	}
	now := time.Now()
	if _, err := s.db.Exec(
		`INSERT INTO llm_configs (owner_user_id, share_id, shared, name, base_url, model, api_key, system_prompt, provider_kind, extras, created_at, updated_at)
		 VALUES ($1, '', TRUE, $2, $3, $4, $5, '', $6, $7::jsonb, $8, $8)`,
		systemUserID,
		"Seedance · 默认",
		baseURL,
		model,
		apiKey,
		LLMConfigKindVideoSeedance,
		`{"ratio":"9:16","duration":10,"generate_audio":true,"watermark":false}`,
		now,
	); err != nil {
		return err
	}
	log.Printf("seeded seedance system config (model=%s)", model)
	return nil
}

func (s *Server) ensureSystemUser() error {
	if s == nil {
		return errors.New("server is nil")
	}
	user, err := s.getUserByID(systemUserID)
	if err != nil {
		return err
	}
	if user != nil {
		return nil
	}

	password, err := hashPassword(generateSessionID())
	if err != nil {
		return err
	}

	now := time.Now()
	return s.createUser(&User{
		ID:        systemUserID,
		Username:  systemUsername,
		Email:     systemUserEmail,
		Password:  password,
		Role:      "admin",
		Bio:       "站内 AI 助理",
		CreatedAt: now,
	})
}

func (s *Server) registerRoutes() {
	tmpl := template.Must(template.New("layout").Parse(layoutTemplate))
	template.Must(tmpl.New("login").Parse(loginTemplate))
	template.Must(tmpl.New("register").Parse(registerTemplate))
	template.Must(tmpl.New("dashboard").Parse(dashboardTemplate))
	s.router.SetHTMLTemplate(tmpl)

	s.router.GET("/", func(c *gin.Context) {
		if session := s.getAccessSession(extractAccessToken(c)); session != nil {
			c.Redirect(http.StatusFound, "/dashboard")
			return
		}
		c.Redirect(http.StatusFound, "/login")
	})

	s.router.GET("/login", s.GuestMiddleware(), func(c *gin.Context) {
		c.HTML(http.StatusOK, "login", gin.H{"Title": "登录"})
	})

	s.router.GET("/register", s.GuestMiddleware(), func(c *gin.Context) {
		c.HTML(http.StatusOK, "register", gin.H{"Title": "注册"})
	})

	s.router.GET("/dashboard", s.AuthMiddleware(), func(c *gin.Context) {
		username, _ := c.Get("username")
		userID, _ := c.Get("user_id")
		role, _ := c.Get("role")
		roleLabel := "普通用户组"
		if roleStr, ok := role.(string); ok && roleStr == "admin" {
			roleLabel = "管理用户组"
		}
		c.HTML(http.StatusOK, "dashboard", gin.H{
			"Title":     "控制台",
			"Username":  username,
			"UserID":    userID,
			"Role":      role,
			"RoleLabel": roleLabel,
			"LoginTime": time.Now().Format("2006-01-02 15:04:05"),
		})
	})
	s.router.GET("/ws/chat", s.handleChatWS)

	api := s.router.Group("/api")
	{
		api.POST("/register", s.handleRegister)
		api.POST("/login", s.handleLogin)
		api.POST("/logout", s.handleLogout)
		api.POST("/token/refresh", s.handleTokenRefresh)
		api.POST("/passkey/register/begin", s.AuthMiddleware(), s.handlePasskeyRegisterBegin)
		api.POST("/passkey/register/finish", s.AuthMiddleware(), s.handlePasskeyRegisterFinish)
		api.GET("/passkeys", s.AuthMiddleware(), s.handlePasskeyList)
		api.DELETE("/passkeys/:credentialId", s.AuthMiddleware(), s.handlePasskeyDelete)
		api.POST("/passkey/login/begin", s.GuestMiddleware(), s.handlePasskeyLoginBegin)
		api.POST("/passkey/login/finish", s.GuestMiddleware(), s.handlePasskeyLoginFinish)
		api.POST("/email-verification/send", s.AuthMiddleware(), s.handleEmailVerificationSend)
		api.GET("/email-verification/verify", s.handleEmailVerificationConfirm)
		api.POST("/user/icon", s.AuthMiddleware(), s.handleUserIconUpload)
		api.GET("/users", s.AuthMiddleware(), s.handleUserSearch)
		api.PUT("/users/me/profile", s.AuthMiddleware(), s.handleMyProfileUpdate)
		api.GET("/users/me/bookmarks", s.AuthMiddleware(), s.handleMyBookmarkList)
		api.GET("/users/me/following", s.AuthMiddleware(), s.handleMyFollowing)
		api.GET("/users/:id/profile", s.AuthMiddleware(), s.handleUserProfileGet)
		api.POST("/users/:id/recommendations", s.AuthMiddleware(), s.handleProfileRecommendationUpsert)
		api.POST("/users/:id/block", s.AuthMiddleware(), s.handleUserBlockCreate)
		api.DELETE("/users/:id/block", s.AuthMiddleware(), s.handleUserBlockDelete)
		api.POST("/users/:id/follow", s.AuthMiddleware(), s.handleUserFollow)
		api.DELETE("/users/:id/follow", s.AuthMiddleware(), s.handleUserUnfollow)
		api.GET("/users/:id/followers", s.AuthMiddleware(), s.handleUserFollowers)
		api.GET("/users/:id/following", s.AuthMiddleware(), s.handleUserFollowing)
		api.GET("/site-settings", s.handleSiteSettingsGet)
		api.PUT("/site-settings", s.AuthMiddleware(), s.AdminMiddleware(), s.handleSiteSettingsUpdate)
		api.GET("/site-settings/invite-codes", s.AuthMiddleware(), s.AdminMiddleware(), s.handleInviteCodeList)
		api.POST("/site-settings/invite-codes", s.AuthMiddleware(), s.AdminMiddleware(), s.handleInviteCodeGenerate)
		api.POST("/site-settings/icon", s.AuthMiddleware(), s.AdminMiddleware(), s.handleSiteIconUpload)
		api.POST("/site-settings/apple-push-cert", s.AuthMiddleware(), s.AdminMiddleware(), s.handleApplePushCertificateUpload)
		api.DELETE("/site-settings/apple-push-cert", s.AuthMiddleware(), s.AdminMiddleware(), s.handleApplePushCertificateDelete)
		api.GET("/llm-configs", s.AuthMiddleware(), s.handleLLMConfigList)
		api.GET("/llm-configs/available", s.AuthMiddleware(), s.handleAvailableLLMConfigList)
		api.POST("/llm-configs/test", s.AuthMiddleware(), s.handleLLMConfigTest)
		api.POST("/llm-configs", s.AuthMiddleware(), s.handleLLMConfigCreate)
		api.GET("/llm-configs/shared/:shareId", s.AuthMiddleware(), s.handleLLMConfigGetByShareID)
		api.PUT("/llm-configs/:id", s.AuthMiddleware(), s.handleLLMConfigUpdate)
		api.DELETE("/llm-configs/:id", s.AuthMiddleware(), s.handleLLMConfigDelete)
		api.GET("/packtunnel/profiles", s.AuthMiddleware(), s.AdminMiddleware(), s.handlePackTunnelProfileList)
		api.GET("/packtunnel/profiles/active", s.AuthMiddleware(), s.handlePackTunnelActiveProfileGet)
		api.GET("/packtunnel/profiles/:id", s.AuthMiddleware(), s.AdminMiddleware(), s.handlePackTunnelProfileGet)
		api.POST("/packtunnel/profiles", s.AuthMiddleware(), s.AdminMiddleware(), s.handlePackTunnelProfileCreate)
		api.PUT("/packtunnel/profiles/:id", s.AuthMiddleware(), s.AdminMiddleware(), s.handlePackTunnelProfileUpdate)
		api.DELETE("/packtunnel/profiles/:id", s.AuthMiddleware(), s.AdminMiddleware(), s.handlePackTunnelProfileDelete)
		api.PUT("/packtunnel/profiles/:id/activate", s.AuthMiddleware(), s.AdminMiddleware(), s.handlePackTunnelProfileActivate)
		api.POST("/packtunnel/rules", s.AuthMiddleware(), s.AdminMiddleware(), s.handlePackTunnelRuleUpload)
		api.GET("/packtunnel/rules", s.AuthMiddleware(), s.handlePackTunnelRuleDownload)
		api.DELETE("/packtunnel/rules", s.AuthMiddleware(), s.AdminMiddleware(), s.handlePackTunnelRuleDelete)
		// Legacy aliases for older clients that still use /proxy-configs paths.
		api.GET("/proxy-configs", s.AuthMiddleware(), s.AdminMiddleware(), s.handlePackTunnelProfileList)
		api.GET("/proxy-configs/active", s.AuthMiddleware(), s.handlePackTunnelActiveProfileGet)
		api.GET("/proxy-configs/:id", s.AuthMiddleware(), s.AdminMiddleware(), s.handlePackTunnelProfileGet)
		api.POST("/proxy-configs", s.AuthMiddleware(), s.AdminMiddleware(), s.handlePackTunnelProfileCreate)
		api.PUT("/proxy-configs/:id", s.AuthMiddleware(), s.AdminMiddleware(), s.handlePackTunnelProfileUpdate)
		api.DELETE("/proxy-configs/:id", s.AuthMiddleware(), s.AdminMiddleware(), s.handlePackTunnelProfileDelete)
		api.POST("/proxy-configs/:id/activate", s.AuthMiddleware(), s.AdminMiddleware(), s.handlePackTunnelProfileActivate)
		// Latch — proxies (admin)
		api.GET("/latch/proxies", s.AuthMiddleware(), s.AdminMiddleware(), s.handleLatchProxyList)
		api.POST("/latch/proxies", s.AuthMiddleware(), s.AdminMiddleware(), s.handleLatchProxyCreate)
		api.GET("/latch/proxies/:group_id", s.AuthMiddleware(), s.AdminMiddleware(), s.handleLatchProxyGet)
		api.PUT("/latch/proxies/:group_id", s.AuthMiddleware(), s.AdminMiddleware(), s.handleLatchProxyUpdate)
		api.DELETE("/latch/proxies/:group_id", s.AuthMiddleware(), s.AdminMiddleware(), s.handleLatchProxyDelete)
		api.GET("/latch/proxies/:group_id/versions", s.AuthMiddleware(), s.AdminMiddleware(), s.handleLatchProxyVersions)
		api.PUT("/latch/proxies/:group_id/rollback/:version", s.AuthMiddleware(), s.AdminMiddleware(), s.handleLatchProxyRollback)
		// Latch — rules (admin)
		api.GET("/latch/rules", s.AuthMiddleware(), s.AdminMiddleware(), s.handleLatchRuleList)
		api.POST("/latch/rules", s.AuthMiddleware(), s.AdminMiddleware(), s.handleLatchRuleCreate)
		api.POST("/latch/rules/upload", s.AuthMiddleware(), s.AdminMiddleware(), s.handleLatchRuleCreateUpload)
		api.GET("/latch/rules/:group_id", s.AuthMiddleware(), s.AdminMiddleware(), s.handleLatchRuleGet)
		api.GET("/latch/rules/:group_id/content", s.AuthMiddleware(), s.AdminMiddleware(), s.handleLatchRuleContent)
		api.GET("/latch/rules/:group_id/versions", s.AuthMiddleware(), s.AdminMiddleware(), s.handleLatchRuleVersions)
		api.PUT("/latch/rules/:group_id", s.AuthMiddleware(), s.AdminMiddleware(), s.handleLatchRuleUpdate)
		api.POST("/latch/rules/:group_id/upload", s.AuthMiddleware(), s.AdminMiddleware(), s.handleLatchRuleUpload)
		api.DELETE("/latch/rules/:group_id", s.AuthMiddleware(), s.AdminMiddleware(), s.handleLatchRuleDelete)
		api.PUT("/latch/rules/:group_id/rollback/:version", s.AuthMiddleware(), s.AdminMiddleware(), s.handleLatchRuleRollback)
		// Latch — profiles (admin)
		api.GET("/latch/admin/profiles", s.AuthMiddleware(), s.AdminMiddleware(), s.handleLatchAdminProfileList)
		api.POST("/latch/admin/profiles", s.AuthMiddleware(), s.AdminMiddleware(), s.handleLatchAdminProfileCreate)
		api.GET("/latch/admin/profiles/:id", s.AuthMiddleware(), s.AdminMiddleware(), s.handleLatchAdminProfileGet)
		api.PUT("/latch/admin/profiles/:id", s.AuthMiddleware(), s.AdminMiddleware(), s.handleLatchAdminProfileUpdate)
		api.DELETE("/latch/admin/profiles/:id", s.AuthMiddleware(), s.AdminMiddleware(), s.handleLatchAdminProfileDelete)
		// Latch — service nodes (admin)
		api.GET("/latch/admin/service-nodes", s.AuthMiddleware(), s.AdminMiddleware(), s.handleLatchServiceNodeList)
		api.POST("/latch/admin/service-nodes", s.AuthMiddleware(), s.AdminMiddleware(), s.handleLatchServiceNodeCreate)
		api.PUT("/latch/admin/service-nodes/:id", s.AuthMiddleware(), s.AdminMiddleware(), s.handleLatchServiceNodeUpdate)
		api.DELETE("/latch/admin/service-nodes/:id", s.AuthMiddleware(), s.AdminMiddleware(), s.handleLatchServiceNodeDelete)
		api.POST("/latch/admin/service-nodes/:id/agent-token", s.AuthMiddleware(), s.AdminMiddleware(), s.handleLatchServiceNodeIssueAgentToken)
		// Latch — lightweight agent runtime
		api.POST("/latch/agent/register", s.AgentAuthMiddleware(), s.handleLatchAgentRegister)
		api.POST("/latch/agent/heartbeat", s.AgentAuthMiddleware(), s.handleLatchAgentHeartbeat)
		// Latch — profiles (user: enabled+shared)
		api.GET("/latch/profiles", s.AuthMiddleware(), s.handleLatchProfileList)
		api.GET("/bots", s.AuthMiddleware(), s.handleBotUserList)
		api.POST("/bots", s.AuthMiddleware(), s.handleBotUserCreate)
		api.PUT("/bots/:id", s.AuthMiddleware(), s.handleBotUserUpdate)
		api.DELETE("/bots/:id", s.AuthMiddleware(), s.handleBotUserDelete)
		api.GET("/me", s.AuthMiddleware(), s.handleMe)
		api.POST("/devices/push-token", s.AuthMiddleware(), s.handleDevicePushTokenUpdate)
		api.DELETE("/devices/push-token", s.AuthMiddleware(), s.handleDevicePushTokenDelete)
		api.GET("/login-history", s.AuthMiddleware(), s.handleLoginHistory)
		api.POST("/markdown", s.AuthMiddleware(), s.handleMarkdownSubmit)
		api.POST("/markdown/assist-with-bot", s.AuthMiddleware(), s.handleMarkdownAssistWithBot)
		api.GET("/markdown", s.AuthMiddleware(), s.handleMarkdownList)
		api.GET("/public/markdowns", s.handlePublicMarkdownList)
		api.GET("/public/markdown/:id", s.handlePublicMarkdownRead)
		api.GET("/markdown/:id", s.AuthMiddleware(), s.handleMarkdownRead)
		api.PUT("/markdown/:id", s.AuthMiddleware(), s.handleMarkdownUpdate)
		api.DELETE("/markdown/:id", s.AuthMiddleware(), s.handleMarkdownDelete)
		api.POST("/markdown/:id/like", s.AuthMiddleware(), s.handleMarkdownLike)
		api.DELETE("/markdown/:id/like", s.AuthMiddleware(), s.handleMarkdownUnlike)
		api.POST("/markdown/:id/replies", s.AuthMiddleware(), s.handleMarkdownReplyCreate)
		api.GET("/markdown/:id/replies", s.AuthMiddleware(), s.handleMarkdownReplyList)
		api.POST("/markdown/:id/bookmark", s.AuthMiddleware(), s.handleMarkdownBookmark)
		api.DELETE("/markdown/:id/bookmark", s.AuthMiddleware(), s.handleMarkdownUnbookmark)
		api.GET("/tags", s.AuthMiddleware(), s.handleTagList)
		api.POST("/tags", s.AuthMiddleware(), s.AdminMiddleware(), s.handleTagCreate)
		api.PUT("/tags/:id", s.AuthMiddleware(), s.AdminMiddleware(), s.handleTagUpdate)
		api.DELETE("/tags/:id", s.AuthMiddleware(), s.AdminMiddleware(), s.handleTagDelete)
		api.POST("/posts", s.AuthMiddleware(), s.handlePostCreate)
		api.GET("/posts", s.AuthMiddleware(), s.handlePostList)
		api.POST("/posts/assist-with-bot", s.AuthMiddleware(), s.handlePostAssistWithBot)
		api.GET("/posts/:id", s.AuthMiddleware(), s.handlePostRead)
		api.DELETE("/posts/:id", s.AuthMiddleware(), s.handlePostDelete)
		api.POST("/posts/:id/like", s.AuthMiddleware(), s.handlePostLike)
		api.DELETE("/posts/:id/like", s.AuthMiddleware(), s.handlePostUnlike)
		api.POST("/posts/:id/bookmark", s.AuthMiddleware(), s.handlePostBookmark)
		api.DELETE("/posts/:id/bookmark", s.AuthMiddleware(), s.handlePostUnbookmark)
		api.POST("/posts/:id/replies", s.AuthMiddleware(), s.handleReplyCreate)
		api.GET("/posts/:id/replies", s.AuthMiddleware(), s.handleReplyList)
		api.POST("/posts/:id/replies/assist-with-bot", s.AuthMiddleware(), s.handleReplyAssistWithBot)
		api.POST("/tasks/:id/apply", s.AuthMiddleware(), s.handleTaskApply)
		api.DELETE("/tasks/:id/apply", s.AuthMiddleware(), s.handleTaskWithdraw)
		api.GET("/tasks/:id/applications", s.AuthMiddleware(), s.handleTaskApplications)
		api.POST("/tasks/:id/close", s.AuthMiddleware(), s.handleTaskClose)
		api.POST("/tasks/:id/select-candidate", s.AuthMiddleware(), s.handleTaskSelectCandidate)
		api.GET("/tasks/:id/results", s.AuthMiddleware(), s.handleTaskResultsList)
		api.POST("/tasks/:id/results", s.AuthMiddleware(), s.handleTaskResultCreate)
		api.GET("/chats", s.AuthMiddleware(), s.handleChatList)
		api.POST("/chats/start", s.AuthMiddleware(), s.handleChatStart)
		api.GET("/chats/:id/llm-threads", s.AuthMiddleware(), s.handleChatLLMThreads)
		api.POST("/chats/:id/llm-threads", s.AuthMiddleware(), s.handleChatLLMThreadCreate)
		api.PUT("/chats/:id/llm-threads/:threadId", s.AuthMiddleware(), s.handleChatLLMThreadUpdate)
		api.DELETE("/chats/:id/llm-threads/:threadId", s.AuthMiddleware(), s.handleChatLLMThreadDelete)
		api.PUT("/chats/:id/llm-threads/:threadId/config", s.AuthMiddleware(), s.handleChatLLMThreadConfigUpdate)
		api.GET("/chats/:id/messages", s.AuthMiddleware(), s.handleChatMessages)
		api.POST("/chats/:id/messages", s.AuthMiddleware(), s.handleChatSend)
		api.POST("/chats/:id/messages/attachment", s.AuthMiddleware(), s.handleChatSendAttachment)
		api.GET("/chats/:id/messages/:messageId", s.AuthMiddleware(), s.handleChatMessageDetail)
		api.POST("/chats/:id/messages/:messageId/retry", s.AuthMiddleware(), s.handleChatRetry)
		api.GET("/chats/:id/messages/:messageId/markdown", s.AuthMiddleware(), s.handleChatSharedMarkdown)
		api.DELETE("/chats/:id/messages/:messageId", s.AuthMiddleware(), s.handleChatDelete)
		// Video studio. Project + shot + asset CRUD, provider submit/retry,
		// and final render. All endpoints require auth and verify ownership.
		api.GET("/video-llm-configs", s.AuthMiddleware(), s.handleVideoLLMConfigList)
		api.GET("/video-projects", s.AuthMiddleware(), s.handleVideoProjectList)
		api.POST("/video-projects", s.AuthMiddleware(), s.handleVideoProjectCreate)
		api.GET("/video-projects/:id", s.AuthMiddleware(), s.handleVideoProjectDetail)
		api.PATCH("/video-projects/:id", s.AuthMiddleware(), s.handleVideoProjectUpdate)
		api.DELETE("/video-projects/:id", s.AuthMiddleware(), s.handleVideoProjectDelete)
		api.POST("/video-projects/:id/shots", s.AuthMiddleware(), s.handleVideoShotCreate)
		api.PATCH("/video-projects/:id/shots/:shotId", s.AuthMiddleware(), s.handleVideoShotUpdate)
		api.DELETE("/video-projects/:id/shots/:shotId", s.AuthMiddleware(), s.handleVideoShotDelete)
		api.POST("/video-projects/:id/shots/:shotId/submit", s.AuthMiddleware(), s.handleVideoShotSubmit)
		api.POST("/video-projects/:id/shots/:shotId/retry", s.AuthMiddleware(), s.handleVideoShotRetry)
		api.POST("/video-projects/:id/shots/:shotId/duplicate", s.AuthMiddleware(), s.handleVideoShotDuplicate)
		api.POST("/video-projects/:id/shots/:shotId/extract-frame", s.AuthMiddleware(), s.handleVideoShotExtractFrame)
		api.POST("/video-projects/:id/submit-all", s.AuthMiddleware(), s.handleVideoProjectSubmitAll)
		api.POST("/video-projects/:id/assets", s.AuthMiddleware(), s.handleVideoAssetUpload)
		api.PATCH("/video-projects/:id/assets/:assetId", s.AuthMiddleware(), s.handleVideoAssetUpdate)
		api.DELETE("/video-projects/:id/assets/:assetId", s.AuthMiddleware(), s.handleVideoAssetDelete)
		api.POST("/video-projects/:id/render", s.AuthMiddleware(), s.handleVideoProjectRender)
		api.GET("/video-projects/:id/download", s.AuthMiddleware(), s.handleVideoProjectDownload)
		api.GET("/video-projects/:id/shots.zip", s.AuthMiddleware(), s.handleVideoProjectShotsZip)
		api.GET("/system-agent", s.AuthMiddleware(), s.handleSystemAgentStatus)
		api.GET("/admin/users", s.AuthMiddleware(), s.AdminMiddleware(), s.handleAdminUserList)
		api.GET("/admin/users/:id/login-history", s.AuthMiddleware(), s.AdminMiddleware(), s.handleAdminUserLoginHistory)
		api.PUT("/admin/users/:id/password", s.AuthMiddleware(), s.AdminMiddleware(), s.handleAdminUserPasswordUpdate)
	}
}
