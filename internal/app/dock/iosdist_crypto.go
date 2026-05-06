package dock

// AES-256-GCM helpers for the iOS distribution module's at-rest secrets
// (today: .p12 passwords). The key is loaded once at boot from
// IOSDIST_RESOURCE_KEY (32 bytes hex). When the key is absent, callers
// fall back to plaintext storage and flag the row in the API response so
// the operator can fix the deployment.

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
)

const iosdistResourceKeyBytes = 32

// decodeIOSDistResourceKey accepts a 32-byte key encoded as hex (64 chars)
// or as standard/URL base64. Returns the raw bytes ready for AES-256.
func decodeIOSDistResourceKey(raw string) ([]byte, error) {
	if b, err := hex.DecodeString(raw); err == nil && len(b) == iosdistResourceKeyBytes {
		return b, nil
	}
	if b, err := base64.StdEncoding.DecodeString(raw); err == nil && len(b) == iosdistResourceKeyBytes {
		return b, nil
	}
	if b, err := base64.RawURLEncoding.DecodeString(raw); err == nil && len(b) == iosdistResourceKeyBytes {
		return b, nil
	}
	return nil, fmt.Errorf("expected 32 bytes encoded as hex or base64, got %d chars", len(raw))
}

// encryptIOSDistSecret seals plaintext with AES-256-GCM. The output is
// base64(nonce||ciphertext||tag) so the column stays text-safe. When
// the server has no key configured, returns ("", false) — caller stores
// plaintext and sets password_encrypted = false.
func (s *Server) encryptIOSDistSecret(plaintext string) (string, bool, error) {
	if len(s.iosdistResourceKey) != iosdistResourceKeyBytes {
		return "", false, nil
	}
	if plaintext == "" {
		return "", true, nil
	}
	block, err := aes.NewCipher(s.iosdistResourceKey)
	if err != nil {
		return "", false, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", false, err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", false, err
	}
	sealed := gcm.Seal(nonce, nonce, []byte(plaintext), nil)
	return base64.StdEncoding.EncodeToString(sealed), true, nil
}

// decryptIOSDistSecret reverses encryptIOSDistSecret. Only used when the
// signing pipeline lands; expose it now so the storage layer can be
// exercised symmetrically in tests.
func (s *Server) decryptIOSDistSecret(blob string) (string, error) {
	if len(s.iosdistResourceKey) != iosdistResourceKeyBytes {
		return "", errors.New("iosdist resource key not configured")
	}
	if blob == "" {
		return "", nil
	}
	raw, err := base64.StdEncoding.DecodeString(blob)
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(s.iosdistResourceKey)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	if len(raw) < gcm.NonceSize() {
		return "", errors.New("ciphertext too short")
	}
	nonce, ct := raw[:gcm.NonceSize()], raw[gcm.NonceSize():]
	plaintext, err := gcm.Open(nil, nonce, ct, nil)
	if err != nil {
		return "", err
	}
	return string(plaintext), nil
}
