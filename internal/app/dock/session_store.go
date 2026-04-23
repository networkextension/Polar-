package dock

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"time"

	"github.com/redis/go-redis/v9"
)

// Access + refresh token storage. The two Redis namespaces are
// independent so an access token cannot mint refreshes and vice
// versa. A family_id links every access/refresh a single login
// chain issues, allowing replay-driven family revocation. The design
// is spec'd in doc/auth-refresh.md.

func (s *Server) accessKey(token string) string {
	prefix := DefaultRedisPrefix
	if s.redisPrefix != "" {
		prefix = s.redisPrefix
	}
	return fmt.Sprintf("%s:session:access:%s", prefix, token)
}

func (s *Server) refreshKey(token string) string {
	prefix := DefaultRedisPrefix
	if s.redisPrefix != "" {
		prefix = s.redisPrefix
	}
	return fmt.Sprintf("%s:session:refresh:%s", prefix, token)
}

func (s *Server) familyKey(familyID string) string {
	prefix := DefaultRedisPrefix
	if s.redisPrefix != "" {
		prefix = s.redisPrefix
	}
	return fmt.Sprintf("%s:session:family:%s", prefix, familyID)
}

// createTokenFamily issues a fresh (access, refresh) pair for a new
// login or registration and returns the token strings plus the family
// id so callers can record it (e.g. in login history).
func (s *Server) createTokenFamily(user *User, deviceType, deviceID, pushToken string) (string, string, string, error) {
	if user == nil {
		return "", "", "", errors.New("nil user")
	}
	familyID := generateSessionID()
	accessToken, refreshToken, err := s.issueTokenPair(user, deviceType, deviceID, pushToken, familyID, "")
	if err != nil {
		return "", "", "", err
	}
	return accessToken, refreshToken, familyID, nil
}

// issueTokenPair writes an access session and a refresh token sharing
// the same family. prevRefresh records the refresh token that was
// rotated to produce this pair (empty on initial login).
func (s *Server) issueTokenPair(user *User, deviceType, deviceID, pushToken, familyID, prevRefresh string) (string, string, error) {
	accessToken := generateSessionID()
	refreshToken := generateSessionID()
	now := time.Now()

	session := &Session{
		ID:         accessToken,
		UserID:     user.ID,
		Username:   user.Username,
		Role:       user.Role,
		DeviceType: normalizeDeviceType(deviceType),
		DeviceID:   normalizeDeviceID(deviceID, deviceType),
		PushToken:  sanitizePushToken(pushToken),
		FamilyID:   familyID,
		RefreshID:  refreshToken,
		Scopes:     []string{"*"},
		ExpiresAt:  now.Add(AccessTokenTTL),
	}
	if err := s.writeAccessSession(session); err != nil {
		return "", "", err
	}

	refresh := &RefreshToken{
		ID:          refreshToken,
		UserID:      user.ID,
		DeviceType:  normalizeDeviceType(deviceType),
		DeviceID:    normalizeDeviceID(deviceID, deviceType),
		PushToken:   sanitizePushToken(pushToken),
		FamilyID:    familyID,
		PrevRefresh: prevRefresh,
		IssuedAt:    now,
		ExpiresAt:   now.Add(RefreshTokenTTL),
	}
	if err := s.writeRefreshToken(refresh); err != nil {
		// Roll back the access session we just wrote so a failure
		// here doesn't leave a dangling half-issued pair.
		_ = s.redis.Del(context.Background(), s.accessKey(accessToken)).Err()
		return "", "", err
	}

	// Track the live refresh in the family set so the whole chain
	// can be revoked atomically on logout or replay.
	ctx := context.Background()
	if err := s.redis.SAdd(ctx, s.familyKey(familyID), refreshToken).Err(); err != nil {
		return "", "", err
	}
	if err := s.redis.Expire(ctx, s.familyKey(familyID), RefreshTokenTTL).Err(); err != nil {
		return "", "", err
	}

	return accessToken, refreshToken, nil
}

func (s *Server) writeAccessSession(session *Session) error {
	payload, err := json.Marshal(session)
	if err != nil {
		return err
	}
	return s.redis.Set(context.Background(), s.accessKey(session.ID), payload, AccessTokenTTL).Err()
}

func (s *Server) writeRefreshToken(refresh *RefreshToken) error {
	payload, err := json.Marshal(refresh)
	if err != nil {
		return err
	}
	return s.redis.Set(context.Background(), s.refreshKey(refresh.ID), payload, RefreshTokenTTL).Err()
}

// getAccessSession looks up the access-token record and returns nil
// for anything unreadable, expired, or missing.
func (s *Server) getAccessSession(token string) *Session {
	if token == "" {
		return nil
	}
	payload, err := s.redis.Get(context.Background(), s.accessKey(token)).Bytes()
	if err != nil {
		return nil
	}
	var session Session
	if err := json.Unmarshal(payload, &session); err != nil {
		_ = s.redis.Del(context.Background(), s.accessKey(token)).Err()
		return nil
	}
	if time.Now().After(session.ExpiresAt) {
		_ = s.redis.Del(context.Background(), s.accessKey(token)).Err()
		return nil
	}
	return &session
}

func (s *Server) getRefreshToken(token string) *RefreshToken {
	if token == "" {
		return nil
	}
	payload, err := s.redis.Get(context.Background(), s.refreshKey(token)).Bytes()
	if err != nil {
		return nil
	}
	var refresh RefreshToken
	if err := json.Unmarshal(payload, &refresh); err != nil {
		return nil
	}
	if time.Now().After(refresh.ExpiresAt) {
		_ = s.redis.Del(context.Background(), s.refreshKey(token)).Err()
		return nil
	}
	return &refresh
}

func (s *Server) deleteAccessSession(token string) error {
	if token == "" {
		return nil
	}
	return s.redis.Del(context.Background(), s.accessKey(token)).Err()
}

// revokeTokenFamily wipes every refresh token in the family plus the
// family set itself. Access tokens tied to the family are not
// individually deleted here; they expire within AccessTokenTTL
// anyway, and any attempt to refresh after this call fails.
func (s *Server) revokeTokenFamily(familyID string) error {
	if familyID == "" {
		return nil
	}
	ctx := context.Background()
	members, err := s.redis.SMembers(ctx, s.familyKey(familyID)).Result()
	if err != nil && err != redis.Nil {
		return err
	}
	for _, member := range members {
		if member == "" {
			continue
		}
		if err := s.redis.Del(ctx, s.refreshKey(member)).Err(); err != nil {
			log.Printf("revoke family member %s failed: %v", member, err)
		}
	}
	return s.redis.Del(ctx, s.familyKey(familyID)).Err()
}

// rotateRefreshToken consumes an unused refresh token and issues a
// fresh (access, refresh) pair. If the caller presents a refresh
// token that has already been rotated, we treat the event as a
// replay and revoke the entire family. ErrRefreshReplay identifies
// that outcome so the handler can return a clear 401.
var ErrRefreshReplay = errors.New("refresh token replay detected")
var ErrRefreshInvalid = errors.New("refresh token invalid or expired")

func (s *Server) rotateRefreshToken(presented string, deviceType, deviceID, pushToken string) (string, string, *RefreshToken, error) {
	refresh := s.getRefreshToken(presented)
	if refresh == nil {
		return "", "", nil, ErrRefreshInvalid
	}
	if refresh.Revoked {
		_ = s.revokeTokenFamily(refresh.FamilyID)
		return "", "", refresh, ErrRefreshReplay
	}

	user, err := s.getUserByID(refresh.UserID)
	if err != nil || user == nil {
		return "", "", refresh, ErrRefreshInvalid
	}

	// Mark the presented refresh token as consumed before we issue a
	// new pair, so a concurrent retry with the same token trips the
	// replay branch above.
	refresh.Revoked = true
	if err := s.writeRefreshToken(refresh); err != nil {
		return "", "", refresh, err
	}
	// Drop it from the live-set so SMembers on logout/revocation
	// doesn't keep chasing consumed tokens forever.
	if err := s.redis.SRem(context.Background(), s.familyKey(refresh.FamilyID), presented).Err(); err != nil {
		log.Printf("remove rotated refresh from family failed: %v", err)
	}

	// Prefer the caller-supplied device hints (current request) but
	// fall back to the originally-issued values so a refresh from a
	// client that doesn't re-send headers still works.
	nextDeviceType := deviceType
	if nextDeviceType == "" {
		nextDeviceType = refresh.DeviceType
	}
	nextDeviceID := deviceID
	if nextDeviceID == "" {
		nextDeviceID = refresh.DeviceID
	}
	nextPushToken := pushToken
	if nextPushToken == "" {
		nextPushToken = refresh.PushToken
	}

	accessToken, newRefreshToken, err := s.issueTokenPair(user, nextDeviceType, nextDeviceID, nextPushToken, refresh.FamilyID, presented)
	if err != nil {
		return "", "", refresh, err
	}
	return accessToken, newRefreshToken, refresh, nil
}
