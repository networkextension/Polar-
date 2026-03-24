package dock

import (
	"log"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
)

func (s *Server) handleRegister(c *gin.Context) {
	var req struct {
		Username string `json:"username" binding:"required,min=3"`
		Email    string `json:"email" binding:"required,email"`
		Password string `json:"password" binding:"required,min=6"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的输入数据"})
		return
	}

	existingUser, err := s.getUserByEmail(req.Email)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	if existingUser != nil {
		c.JSON(http.StatusConflict, gin.H{"error": "该邮箱已被注册"})
		return
	}

	hashedPassword, err := hashPassword(req.Password)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}

	deviceType, pushToken := s.parseLoginClientInfo(c.GetHeader("X-Device-Type"), c.GetHeader("X-Push-Token"))
	now := time.Now()

	user := &User{
		ID:         generateSessionID()[:16],
		Username:   req.Username,
		Email:      req.Email,
		Password:   hashedPassword,
		DeviceType: deviceType,
		CreatedAt:  now,
	}
	if err := s.createUser(user); err != nil {
		if err == errEmailExists {
			c.JSON(http.StatusConflict, gin.H{"error": "该邮箱已被注册"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}

	if err := s.upsertUserDevice(user.ID, deviceType, pushToken, now); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	if err := s.syncUserPresence(user.ID, now); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}

	sessionID, err := s.createSession(user, deviceType, pushToken)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	c.SetCookie(SessionCookieName, sessionID, int(SessionDuration.Seconds()), "/", "", false, true)
	s.recordLoginEvent(c, user.ID, "register", deviceType)

	c.JSON(http.StatusCreated, gin.H{
		"message":  "注册成功",
		"user_id":  user.ID,
		"username": user.Username,
	})
}

func (s *Server) handleLogin(c *gin.Context) {
	var req struct {
		Email    string `json:"email" binding:"required,email"`
		Password string `json:"password" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的输入数据"})
		return
	}

	user, err := s.getUserByEmail(req.Email)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	if user == nil || !checkPassword(req.Password, user.Password) {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "邮箱或密码错误"})
		return
	}

	deviceType, pushToken := s.parseLoginClientInfo(c.GetHeader("X-Device-Type"), c.GetHeader("X-Push-Token"))
	now := time.Now()
	if err := s.upsertUserDevice(user.ID, deviceType, pushToken, now); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	if err := s.syncUserPresence(user.ID, now); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}

	sessionID, err := s.createSession(user, deviceType, pushToken)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	c.SetCookie(SessionCookieName, sessionID, int(SessionDuration.Seconds()), "/", "", false, true)
	s.recordLoginEvent(c, user.ID, "password", deviceType)

	c.JSON(http.StatusOK, gin.H{
		"message":  "登录成功",
		"user_id":  user.ID,
		"username": user.Username,
	})
}

func (s *Server) handleLogout(c *gin.Context) {
	sessionID, err := c.Cookie(SessionCookieName)
	if err == nil {
		if err := s.deleteSession(sessionID); err != nil {
			log.Printf("logout delete session failed: %v", err)
		}
	}

	http.SetCookie(c.Writer, &http.Cookie{
		Name:     SessionCookieName,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		Expires:  time.Unix(0, 0),
	})
	c.JSON(http.StatusOK, gin.H{"message": "已成功退出登录"})
}

func (s *Server) handleMe(c *gin.Context) {
	userID, _ := c.Get("user_id")
	username, _ := c.Get("username")
	role, _ := c.Get("role")
	userIDStr, _ := userID.(string)
	var user *User
	if userIDStr != "" {
		user, _ = s.getUserByID(userIDStr)
	}

	c.JSON(http.StatusOK, gin.H{
		"user_id":  userID,
		"username": username,
		"role":     role,
		"icon_url": func() string {
			if user != nil {
				return user.IconURL
			}
			return ""
		}(),
		"is_online": func() bool {
			return user != nil && user.IsOnline
		}(),
		"device_type": func() string {
			if user != nil && user.DeviceType != "" {
				return user.DeviceType
			}
			return deviceTypeBrowser
		}(),
		"last_seen_at": func() *time.Time {
			if user != nil {
				return user.LastSeenAt
			}
			return nil
		}(),
		"bio": func() string {
			if user != nil {
				return user.Bio
			}
			return ""
		}(),
	})
}

func (s *Server) handleLoginHistory(c *gin.Context) {
	userID, _ := c.Get("user_id")
	userIDStr, ok := userID.(string)
	if !ok || userIDStr == "" {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}

	limit := 5
	if limitStr := c.Query("limit"); limitStr != "" {
		parsed, err := strconv.Atoi(limitStr)
		if err != nil || parsed <= 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "无效的输入数据"})
			return
		}
		limit = parsed
	}

	records, err := s.listLoginRecords(userIDStr, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"records": records,
	})
}
