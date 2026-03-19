package dock

import (
	"fmt"
	"path/filepath"
	"strings"
	"time"
)

func sanitizeFilename(input string) string {
	if input == "" {
		return "untitled"
	}
	var b strings.Builder
	for _, r := range input {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' {
			b.WriteRune(r)
		} else {
			b.WriteByte('-')
		}
	}
	out := strings.Trim(b.String(), "-")
	if out == "" {
		return "untitled"
	}
	return out
}

func normalizeTagSlug(input string) string {
	if strings.TrimSpace(input) == "" {
		return ""
	}
	return strings.ToLower(sanitizeFilename(input))
}

func buildUploadFilename(original string) string {
	ext := strings.ToLower(filepath.Ext(original))
	if ext == "" || len(ext) > 8 {
		ext = ".img"
	} else {
		for _, r := range ext[1:] {
			if (r < 'a' || r > 'z') && (r < '0' || r > '9') {
				ext = ".img"
				break
			}
		}
	}
	return fmt.Sprintf("%s_%s%s", time.Now().Format("20060102_150405"), generateSessionID()[:8], ext)
}
