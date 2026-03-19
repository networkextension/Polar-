package dock

import (
	"database/sql"
	"html/template"
	"log"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/go-webauthn/webauthn/webauthn"
	geoip2 "github.com/oschwald/geoip2-golang/v2"
)

type Server struct {
	db              *sql.DB
	router          *gin.Engine
	addr            string
	markdownDir     string
	geoLiteDBPath   string
	geoIPReader     *geoip2.Reader
	webAuthn        *webauthn.WebAuthn
	passkeyAuto     bool
	passkeyRPID     string
	passkeyOrigin   string
	passkeyRPName   string
	passkeySessions map[string]passkeySession
	passkeyMu       sync.Mutex
}

func NewServer(cfg Config) (*Server, error) {
	db, err := openDB(cfg.PostgresDSN)
	if err != nil {
		return nil, err
	}

	server := &Server{
		db:            db,
		addr:          cfg.Addr,
		markdownDir:   cfg.MarkdownDir,
		geoLiteDBPath: cfg.GeoLiteDBPath,
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

	server.router = gin.Default()
	server.router.Use(corsMiddleware())
	server.registerRoutes()

	go server.cleanupSessions()

	return server, nil
}

func (s *Server) Run() error {
	return s.router.Run(s.addr)
}

func (s *Server) Close() error {
	if s.geoIPReader != nil {
		_ = s.geoIPReader.Close()
	}
	if s.db == nil {
		return nil
	}
	return s.db.Close()
}

func (s *Server) registerRoutes() {
	tmpl := template.Must(template.New("layout").Parse(layoutTemplate))
	template.Must(tmpl.New("login").Parse(loginTemplate))
	template.Must(tmpl.New("register").Parse(registerTemplate))
	template.Must(tmpl.New("dashboard").Parse(dashboardTemplate))
	s.router.SetHTMLTemplate(tmpl)

	s.router.GET("/", func(c *gin.Context) {
		sessionID, _ := c.Cookie(SessionCookieName)
		if sessionID != "" && s.getSession(sessionID) != nil {
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
		c.HTML(http.StatusOK, "dashboard", gin.H{
			"Title":     "控制台",
			"Username":  username,
			"UserID":    userID,
			"LoginTime": time.Now().Format("2006-01-02 15:04:05"),
		})
	})

	api := s.router.Group("/api")
	{
		api.POST("/register", s.handleRegister)
		api.POST("/login", s.handleLogin)
		api.POST("/logout", s.handleLogout)
		api.POST("/passkey/register/begin", s.AuthMiddleware(), s.handlePasskeyRegisterBegin)
		api.POST("/passkey/register/finish", s.AuthMiddleware(), s.handlePasskeyRegisterFinish)
		api.POST("/passkey/login/begin", s.GuestMiddleware(), s.handlePasskeyLoginBegin)
		api.POST("/passkey/login/finish", s.GuestMiddleware(), s.handlePasskeyLoginFinish)
		api.GET("/me", s.AuthMiddleware(), s.handleMe)
		api.GET("/login-history", s.AuthMiddleware(), s.handleLoginHistory)
		api.POST("/markdown", s.AuthMiddleware(), s.handleMarkdownSubmit)
		api.GET("/markdown", s.AuthMiddleware(), s.handleMarkdownList)
		api.GET("/markdown/:id", s.AuthMiddleware(), s.handleMarkdownRead)
		api.PUT("/markdown/:id", s.AuthMiddleware(), s.handleMarkdownUpdate)
		api.DELETE("/markdown/:id", s.AuthMiddleware(), s.handleMarkdownDelete)
	}
}
