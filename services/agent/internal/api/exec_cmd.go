package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

const defaultExecTimeoutSec = 300

type execCmdBody struct {
	Container  string          `json:"container"`
	Command    json.RawMessage `json:"command"`
	TimeoutSec int             `json:"timeoutSec"`
}

// handleExecCmd runs a one-shot (non-interactive) command inside a container and
// returns exit code + capped stdout/stderr. Used by the control plane's
// per-service cron scheduler.
func (s *Server) handleExecCmd(w http.ResponseWriter, r *http.Request) {
	uuid := r.PathValue("uuid")
	var body execCmdBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}

	argv, err := normalizeExecCommand(body.Command)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	container := strings.TrimSpace(body.Container)
	if container == "" {
		container = s.resolveContainer(r.Context(), uuid)
	}

	timeoutSec := body.TimeoutSec
	if timeoutSec <= 0 {
		timeoutSec = defaultExecTimeoutSec
	}
	ctx, cancel := context.WithTimeout(r.Context(), time.Duration(timeoutSec)*time.Second)
	defer cancel()

	result, err := s.docker.ExecCmd(ctx, container, argv)
	if err != nil {
		if ctx.Err() != nil {
			writeJSON(w, map[string]any{
				"exitCode": -1,
				"stdout":   result.Stdout,
				"stderr":   truncateJoin(result.Stderr, "command timed out"),
			})
			return
		}
		writeJSON(w, map[string]any{
			"exitCode": -1,
			"stdout":   result.Stdout,
			"stderr":   truncateJoin(result.Stderr, err.Error()),
		})
		return
	}
	writeJSON(w, map[string]any{
		"exitCode": result.ExitCode,
		"stdout":   result.Stdout,
		"stderr":   result.Stderr,
	})
}

// normalizeExecCommand accepts a JSON string or string array. Strings are run
// via ["sh","-c",…] after rejecting embedded NUL; arrays are used as argv.
func normalizeExecCommand(raw json.RawMessage) ([]string, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return nil, fmt.Errorf("command is required")
	}

	var asString string
	if err := json.Unmarshal(raw, &asString); err == nil {
		if strings.ContainsRune(asString, 0) {
			return nil, fmt.Errorf("command must not contain NUL")
		}
		return []string{"sh", "-c", asString}, nil
	}

	var asArr []string
	if err := json.Unmarshal(raw, &asArr); err != nil {
		return nil, fmt.Errorf("command must be a string or string array")
	}
	if len(asArr) == 0 {
		return nil, fmt.Errorf("command argv must not be empty")
	}
	for _, part := range asArr {
		if strings.ContainsRune(part, 0) {
			return nil, fmt.Errorf("command must not contain NUL")
		}
	}
	return asArr, nil
}

func truncateJoin(existing, extra string) string {
	if existing == "" {
		return extra
	}
	if extra == "" {
		return existing
	}
	return existing + "\n" + extra
}
