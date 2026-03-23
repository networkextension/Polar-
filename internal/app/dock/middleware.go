package dock

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

func isAPIRequest(c *gin.Context) bool {
	return strings.HasPrefix(c.Request.URL.Path, "/api/")
}

func clearSessionCookie(c *gin.Context) {
	c.SetCookie(SessionCookieName, "", -1, "/", "", false, true)
}

func (s *Server) AuthMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		sessionID, err := c.Cookie(SessionCookieName)
		if err != nil {
			if isAPIRequest(c) {
				c.JSON(http.StatusUnauthorized, gin.H{"error": "未登录或会话已失效"})
			} else {
				c.Redirect(http.StatusFound, "/login")
			}
			c.Abort()
			return
		}

		session := s.getSession(sessionID)
		if session == nil {
			clearSessionCookie(c)
			if isAPIRequest(c) {
				c.JSON(http.StatusUnauthorized, gin.H{"error": "未登录或会话已失效"})
			} else {
				c.Redirect(http.StatusFound, "/login")
			}
			c.Abort()
			return
		}

		c.Set("user_id", session.UserID)
		c.Set("username", session.Username)
		if session.Role == "" {
			c.Set("role", "user")
		} else {
			c.Set("role", session.Role)
		}
		c.Set("session", session)
		c.Next()
	}
}

func (s *Server) AdminMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		role, _ := c.Get("role")
		if roleStr, ok := role.(string); !ok || roleStr != "admin" {
			c.JSON(http.StatusForbidden, gin.H{"error": "权限不足"})
			c.Abort()
			return
		}
		c.Next()
	}
}

func (s *Server) GuestMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		sessionID, err := c.Cookie(SessionCookieName)
		if err == nil {
			session := s.getSession(sessionID)
			if session != nil {
				if isAPIRequest(c) {
					c.JSON(http.StatusConflict, gin.H{"error": "当前已登录"})
				} else {
					c.Redirect(http.StatusFound, "/dashboard")
				}
				c.Abort()
				return
			}
		}
		c.Next()
	}
}
