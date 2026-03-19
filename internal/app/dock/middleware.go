package dock

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

func (s *Server) AuthMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		sessionID, err := c.Cookie(SessionCookieName)
		if err != nil {
			c.Redirect(http.StatusFound, "/login")
			c.Abort()
			return
		}

		session := s.getSession(sessionID)
		if session == nil {
			c.SetCookie(SessionCookieName, "", -1, "/", "", false, true)
			c.Redirect(http.StatusFound, "/login")
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
				c.Redirect(http.StatusFound, "/dashboard")
				c.Abort()
				return
			}
		}
		c.Next()
	}
}
