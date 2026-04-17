package dock

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

func (s *Server) saveMarkdownDocument(userID, title, content string, isPublic bool, now time.Time) (*MarkdownEntry, string, error) {
	if err := os.MkdirAll(s.markdownDir, 0o755); err != nil {
		return nil, "", err
	}

	safeTitle := sanitizeFilename(title)
	timestamp := now.Format("20060102_150405")
	filename := safeTitle + "_" + timestamp + "_" + sanitizeFilename(userID) + ".md"
	path := filepath.Join(s.markdownDir, filename)

	if !strings.HasPrefix(strings.TrimSpace(content), "#") {
		content = "# " + title + "\n\n" + content
	}

	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		return nil, "", err
	}

	summary, coverURL := extractMarkdownMeta(content)
	entryID, err := s.createMarkdownEntryReturningID(userID, title, path, summary, coverURL, isPublic, now)
	if err != nil {
		_ = os.Remove(path)
		return nil, "", err
	}

	return &MarkdownEntry{
		ID:         entryID,
		UserID:     userID,
		Title:      title,
		Summary:    summary,
		CoverURL:   coverURL,
		FilePath:   path,
		IsPublic:   isPublic,
		UploadedAt: now,
	}, content, nil
}

var (
	mdImageRegex  = regexp.MustCompile(`!\[[^\]]*\]\(([^)\s]+)`)
	mdHTMLImgRegex = regexp.MustCompile(`(?i)<img[^>]+src=["']([^"']+)["']`)
)

// extractMarkdownMeta derives a plain-text summary and the first image URL
// from markdown content. Safe to call on any content; returns empty strings
// if nothing matches.
func extractMarkdownMeta(content string) (summary, coverURL string) {
	if match := mdImageRegex.FindStringSubmatch(content); len(match) > 1 {
		coverURL = strings.TrimSpace(match[1])
	} else if match := mdHTMLImgRegex.FindStringSubmatch(content); len(match) > 1 {
		coverURL = strings.TrimSpace(match[1])
	}
	summary = buildMarkdownPreview(stripFirstHeading(content), 200)
	if summary == "AI 文档回复" {
		summary = ""
	}
	return summary, coverURL
}

func stripFirstHeading(content string) string {
	trimmed := strings.TrimSpace(content)
	if !strings.HasPrefix(trimmed, "#") {
		return trimmed
	}
	if idx := strings.Index(trimmed, "\n"); idx >= 0 {
		return strings.TrimSpace(trimmed[idx+1:])
	}
	return ""
}

func buildSystemMarkdownTitle(content string, now time.Time) string {
	lines := strings.Split(strings.TrimSpace(content), "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		line = strings.TrimLeft(line, "#")
		line = strings.TrimSpace(line)
		if line != "" {
			runes := []rune(line)
			if len(runes) > 60 {
				line = string(runes[:60])
			}
			return line
		}
	}
	return fmt.Sprintf("system-reply-%s", now.Format("20060102-150405"))
}

func buildMarkdownPreview(content string, maxLength int) string {
	if maxLength <= 0 {
		maxLength = 80
	}
	replacer := strings.NewReplacer(
		"\r", " ",
		"\n", " ",
		"`", "",
		"#", "",
		"*", "",
		">", "",
		"[", "",
		"]", "",
		"(", "",
		")", "",
	)
	text := strings.TrimSpace(replacer.Replace(content))
	text = strings.Join(strings.Fields(text), " ")
	if text == "" {
		return "AI 文档回复"
	}
	runes := []rune(text)
	if len(runes) > maxLength {
		return string(runes[:maxLength]) + "..."
	}
	return text
}
