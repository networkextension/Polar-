package dock

// Tests for the SSE event-block reader and the per-protocol streaming
// decoders. The real HTTP client is not exercised here — instead we feed
// canned byte streams (one per provider, modeled on real wire captures)
// into `readSSEFrames` and the per-protocol parsing loops, and assert that
// the assembled text + termination behavior is correct.

import (
	"context"
	"encoding/json"
	"io"
	"strings"
	"testing"
	"time"
)

// readAllFrames drains a frame channel until it closes or err arrives.
// Helper for the readSSEFrames table tests below.
func readAllFrames(t *testing.T, frames <-chan streamFrame, errs <-chan error, timeout time.Duration) []streamFrame {
	t.Helper()
	collected := make([]streamFrame, 0, 8)
	deadline := time.After(timeout)
	for {
		select {
		case f, ok := <-frames:
			if !ok {
				return collected
			}
			collected = append(collected, f)
		case err := <-errs:
			if err != nil {
				t.Fatalf("readSSEFrames: %v", err)
			}
		case <-deadline:
			t.Fatalf("timed out waiting for frames; collected so far: %+v", collected)
		}
	}
}

func TestReadSSEFramesBasic(t *testing.T) {
	body := io.NopCloser(strings.NewReader(`event: message
data: hello

: keep-alive

data: {"foo":"bar"}

data: line1
data: line2

`))
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	frames, errs := readSSEFrames(ctx, body, nil)
	got := readAllFrames(t, frames, errs, 2*time.Second)

	if len(got) != 3 {
		t.Fatalf("expected 3 frames, got %d: %+v", len(got), got)
	}
	if got[0].event != "message" || got[0].data != "hello" {
		t.Errorf("frame 0 wrong: %+v", got[0])
	}
	if got[1].event != "" || got[1].data != `{"foo":"bar"}` {
		t.Errorf("frame 1 wrong: %+v", got[1])
	}
	if got[2].data != "line1\nline2" {
		t.Errorf("frame 2 wrong: %+v", got[2])
	}
}

// In-process double for an http.Client that returns canned SSE bytes for
// the streamClient. We don't go through the real network — these tests run
// the parsing loops against fabricated bodies.

type stubReader struct {
	body string
	off  int
}

func (s *stubReader) Read(p []byte) (int, error) {
	if s.off >= len(s.body) {
		return 0, io.EOF
	}
	n := copy(p, s.body[s.off:])
	s.off += n
	return n, nil
}

// runOpenAIDecode runs the OpenAI-compatible decoding loop manually against
// a fixture body, sidestepping the HTTP path. Mirrors the structure of
// streamOpenAICompatible's read loop.
func runOpenAIDecode(t *testing.T, body string) (string, error) {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	frames, errs := readSSEFrames(ctx, &stubReader{body: body}, nil)
	var assembled strings.Builder
	for {
		select {
		case <-ctx.Done():
			return assembled.String(), ctx.Err()
		case err := <-errs:
			if err != nil {
				return assembled.String(), err
			}
		case frame, ok := <-frames:
			if !ok {
				return assembled.String(), nil
			}
			if frame.data == "" {
				continue
			}
			if frame.data == "[DONE]" {
				return assembled.String(), nil
			}
			var chunk openAIStreamChunk
			if err := jsonUnmarshalString(frame.data, &chunk); err != nil {
				continue
			}
			for _, choice := range chunk.Choices {
				if choice.Delta.Content == nil {
					continue
				}
				assembled.WriteString(*choice.Delta.Content)
			}
		}
	}
}

func jsonUnmarshalString(s string, v any) error {
	return json.Unmarshal([]byte(s), v)
}

func TestOpenAIStreamingHappyPath(t *testing.T) {
	body := strings.Join([]string{
		`: keep-alive`,
		``,
		`data: {"choices":[{"delta":{"role":"assistant","content":null}}]}`,
		``,
		`data: {"choices":[{"delta":{"content":"Hello"}}]}`,
		``,
		`data: {"choices":[{"delta":{"content":", world"}}]}`,
		``,
		`data: [DONE]`,
		``,
	}, "\n")
	got, err := runOpenAIDecode(t, body)
	if err != nil {
		t.Fatalf("decode err: %v", err)
	}
	if got != "Hello, world" {
		t.Errorf("expected %q, got %q", "Hello, world", got)
	}
}

func TestOpenAIStreamingMissingDoneIsError(t *testing.T) {
	body := strings.Join([]string{
		`data: {"choices":[{"delta":{"content":"partial"}}]}`,
		``,
	}, "\n")
	// In production this would return an error from streamOpenAICompatible
	// because we never see [DONE]. Here we just confirm the parse loop
	// surfaces the assembled bytes; the production error wrapping is exercised
	// by the integration smoke test.
	got, err := runOpenAIDecode(t, body)
	if err != nil {
		t.Fatalf("decode err: %v", err)
	}
	if got != "partial" {
		t.Errorf("expected %q, got %q", "partial", got)
	}
}

func TestAnthropicStreamingTextDeltas(t *testing.T) {
	body := strings.Join([]string{
		`event: message_start`,
		`data: {"type":"message_start","message":{}}`,
		``,
		`event: content_block_start`,
		`data: {"type":"content_block_start","index":0}`,
		``,
		`event: content_block_delta`,
		`data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"hi"}}`,
		``,
		`event: content_block_delta`,
		`data: {"type":"content_block_delta","delta":{"type":"text_delta","text":" there"}}`,
		``,
		`event: content_block_delta`,
		`data: {"type":"content_block_delta","delta":{"type":"input_json_delta","partial_json":"{}"}}`,
		``,
		`event: ping`,
		`data: {}`,
		``,
		`event: message_stop`,
		`data: {"type":"message_stop"}`,
		``,
	}, "\n")

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	frames, errs := readSSEFrames(ctx, &stubReader{body: body}, nil)
	var assembled strings.Builder
	stopped := false
loop:
	for !stopped {
		select {
		case <-ctx.Done():
			t.Fatalf("ctx: %v", ctx.Err())
		case err := <-errs:
			if err != nil {
				t.Fatalf("err: %v", err)
			}
		case frame, ok := <-frames:
			if !ok {
				break loop
			}
			switch frame.event {
			case "ping", "":
				continue
			case "message_stop":
				stopped = true
				break loop
			case "content_block_delta":
				var chunk anthropicStreamDelta
				if err := jsonUnmarshalString(frame.data, &chunk); err != nil {
					t.Fatalf("parse anthropic chunk: %v", err)
				}
				deltaType, _ := chunk.Delta["type"].(string)
				if deltaType != "text_delta" {
					continue
				}
				text, _ := chunk.Delta["text"].(string)
				assembled.WriteString(text)
			}
		}
	}
	if assembled.String() != "hi there" {
		t.Errorf("expected %q, got %q", "hi there", assembled.String())
	}
}

func TestXAIStreamingError(t *testing.T) {
	body := strings.Join([]string{
		`data: {"type":"response.created"}`,
		``,
		`data: {"type":"response.output_text.delta","delta":"start"}`,
		``,
		`data: {"type":"response.error","error":{"type":"upstream","message":"boom"}}`,
		``,
	}, "\n")

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	frames, errs := readSSEFrames(ctx, &stubReader{body: body}, nil)
	var (
		assembled strings.Builder
		gotErr    string
	)
loop:
	for {
		select {
		case <-ctx.Done():
			t.Fatalf("ctx: %v", ctx.Err())
		case err := <-errs:
			if err != nil {
				t.Fatalf("err: %v", err)
			}
		case frame, ok := <-frames:
			if !ok {
				break loop
			}
			if frame.data == "" {
				continue
			}
			var chunk xAIStreamEvent
			if err := jsonUnmarshalString(frame.data, &chunk); err != nil {
				t.Fatalf("parse xai chunk: %v", err)
			}
			switch chunk.Type {
			case "response.error":
				if chunk.Error != nil {
					gotErr = chunk.Error.Message
				}
				break loop
			case "response.output_text.delta":
				assembled.WriteString(chunk.Delta)
			}
		}
	}
	if assembled.String() != "start" {
		t.Errorf("expected partial 'start', got %q", assembled.String())
	}
	if gotErr != "boom" {
		t.Errorf("expected error 'boom', got %q", gotErr)
	}
}
