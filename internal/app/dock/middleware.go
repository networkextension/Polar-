package dock

import (
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

func isAPIRequest(c *gin.Context) bool {
	return strings.HasPrefix(c.Request.URL.Path, "/api/")
}

// clearAuthCookies expires both auth cookies so the browser drops them
// on the next response. Used on logout and on any unauthenticated API
// hit that carries a stale cookie.
func clearAuthCookies(c *gin.Context) {
	http.SetCookie(c.Writer, &http.Cookie{
		Name:     AccessCookieName,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		Expires:  time.Unix(0, 0),
	})
	http.SetCookie(c.Writer, &http.Cookie{
		Name:     RefreshCookieName,
		Value:    "",
		Path:     RefreshCookiePath,
		MaxAge:   -1,
		HttpOnly: true,
		Expires:  time.Unix(0, 0),
	})
}

// setAuthCookies writes a fresh access + refresh pair onto the
// response. Keep in one place so cookie attributes stay consistent
// across login, register, passkey, and refresh handlers.
func setAuthCookies(c *gin.Context, accessToken, refreshToken string) {
	http.SetCookie(c.Writer, &http.Cookie{
		Name:     AccessCookieName,
		Value:    accessToken,
		Path:     "/",
		MaxAge:   int(AccessTokenTTL.Seconds()),
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})
	http.SetCookie(c.Writer, &http.Cookie{
		Name:     RefreshCookieName,
		Value:    refreshToken,
		Path:     RefreshCookiePath,
		MaxAge:   int(RefreshTokenTTL.Seconds()),
		HttpOnly: true,
		SameSite: http.SameSiteStrictMode,
	})
}

// extractAccessToken returns the access token carried by the request.
// Bearer header wins over cookie so third-party clients (future open
// platform) can skip the cookie round-trip.
func extractAccessToken(c *gin.Context) string {
	if header := c.GetHeader("Authorization"); header != "" {
		if parts := strings.SplitN(header, " ", 2); len(parts) == 2 && strings.EqualFold(parts[0], "Bearer") {
			if tok := strings.TrimSpace(parts[1]); tok != "" {
				return tok
			}
		}
	}
	if tok, err := c.Cookie(AccessCookieName); err == nil {
		return tok
	}
	return ""
}

func extractBearerToken(c *gin.Context) string {
	if header := c.GetHeader("Authorization"); header != "" {
		if parts := strings.SplitN(header, " ", 2); len(parts) == 2 && strings.EqualFold(parts[0], "Bearer") {
			if tok := strings.TrimSpace(parts[1]); tok != "" {
				return tok
			}
		}
	}
	return ""
}

// extractRefreshToken reads the refresh token from cookie, request
// body, or Authorization header (in that order). The body fallback
// lets native clients carry the token outside of cookies.
func extractRefreshToken(c *gin.Context) string {
	if tok, err := c.Cookie(RefreshCookieName); err == nil && tok != "" {
		return tok
	}
	if header := c.GetHeader("Authorization"); header != "" {
		if parts := strings.SplitN(header, " ", 2); len(parts) == 2 && strings.EqualFold(parts[0], "Bearer") {
			if tok := strings.TrimSpace(parts[1]); tok != "" {
				return tok
			}
		}
	}
	return ""
}

func (s *Server) AuthMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		token := extractAccessToken(c)
		if token == "" {
			if isAPIRequest(c) {
				jsonError(c, http.StatusUnauthorized, "auth.unauthorized")
			} else {
				c.Redirect(http.StatusFound, "/login")
			}
			c.Abort()
			return
		}

		session := s.getAccessSession(token)
		if session == nil {
			clearAuthCookies(c)
			if isAPIRequest(c) {
				jsonError(c, http.StatusUnauthorized, "auth.unauthorized")
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
			jsonError(c, http.StatusForbidden, "auth.forbidden")
			c.Abort()
			return
		}
		c.Next()
	}
}

func (s *Server) GuestMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		if token := extractAccessToken(c); token != "" {
			if session := s.getAccessSession(token); session != nil {
				if isAPIRequest(c) {
					jsonError(c, http.StatusConflict, "auth.already_logged_in")
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

func (s *Server) AgentAuthMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		token := extractBearerToken(c)
		if token == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "missing bearer token"})
			c.Abort()
			return
		}
		node, tokenID, err := s.authenticateLatchAgentToken(token)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "server error"})
			c.Abort()
			return
		}
		if node == nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid agent token"})
			c.Abort()
			return
		}
		now := time.Now()
		if err := s.touchLatchAgentToken(tokenID, now); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "server error"})
			c.Abort()
			return
		}
		c.Set("agent_node", node)
		c.Set("agent_node_id", node.ID)
		c.Set("agent_token_id", tokenID)
		c.Next()
	}
}
