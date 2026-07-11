package api

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/client"
	"github.com/gorilla/websocket"
)

// The control plane is the only client and it authenticates with the daemon
// token (checked by the auth middleware before the upgrade), so any origin is ok.
var upgrader = websocket.Upgrader{
	ReadBufferSize:  4096,
	WriteBufferSize: 4096,
	CheckOrigin:     func(r *http.Request) bool { return true },
}

type wsControl struct {
	Resize *struct {
		Cols int `json:"cols"`
		Rows int `json:"rows"`
	} `json:"resize"`
}

// parseResize extracts terminal dimensions from a text control frame. ok is
// false when the frame isn't a (valid) resize control, in which case the caller
// should treat the bytes as raw terminal input.
func parseResize(data []byte) (cols, rows int, ok bool) {
	var ctrl wsControl
	if json.Unmarshal(data, &ctrl) != nil || ctrl.Resize == nil {
		return 0, 0, false
	}
	return ctrl.Resize.Cols, ctrl.Resize.Rows, true
}

// handleExec upgrades to a WebSocket and bridges it to an interactive shell in
// the service container. We use the Docker exec API with a TTY allocated inside
// the container (hijacked stream), so no host PTY is required — this works the
// same on Linux nodes and on a Windows dev host. Text frames carry control
// messages (resize); binary frames carry raw terminal IO.
func (s *Server) handleExec(w http.ResponseWriter, r *http.Request) {
	name := s.resolveContainer(r.Context(), r.PathValue("uuid"))

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	cli, err := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
	if err != nil {
		writeWsErr(conn, "docker client: "+err.Error())
		return
	}
	defer cli.Close()

	ctx := context.Background()
	execResp, err := cli.ContainerExecCreate(ctx, name, container.ExecOptions{
		AttachStdin:  true,
		AttachStdout: true,
		AttachStderr: true,
		Tty:          true,
		Cmd: []string{
			"sh", "-c",
			"if command -v bash >/dev/null 2>&1; then exec bash; else exec sh; fi",
		},
		Env:          []string{"TERM=xterm-256color"},
	})
	if err != nil {
		writeWsErr(conn, "exec create: "+err.Error())
		return
	}

	hijack, err := cli.ContainerExecAttach(ctx, execResp.ID, container.ExecAttachOptions{Tty: true})
	if err != nil {
		writeWsErr(conn, "exec attach: "+err.Error())
		return
	}
	defer hijack.Close()

	_ = cli.ContainerExecResize(ctx, execResp.ID, container.ResizeOptions{Height: 32, Width: 120})

	// Container output -> WebSocket. With Tty:true the stream is raw (not the
	// stdcopy multiplexed format), so we forward bytes verbatim.
	go func() {
		buf := make([]byte, 4096)
		for {
			n, readErr := hijack.Reader.Read(buf)
			if n > 0 {
				if conn.WriteMessage(websocket.BinaryMessage, buf[:n]) != nil {
					break
				}
			}
			if readErr != nil {
				break
			}
		}
		_ = conn.Close()
	}()

	// WebSocket input -> container (or resize control).
	for {
		mt, data, readErr := conn.ReadMessage()
		if readErr != nil {
			break
		}
		if mt == websocket.TextMessage {
			if cols, rows, ok := parseResize(data); ok {
				_ = cli.ContainerExecResize(ctx, execResp.ID, container.ResizeOptions{
					Height: uint(rows),
					Width:  uint(cols),
				})
				continue
			}
		}
		if _, werr := hijack.Conn.Write(data); werr != nil {
			break
		}
	}
}

func writeWsErr(conn *websocket.Conn, msg string) {
	_ = conn.WriteMessage(websocket.BinaryMessage, []byte("\r\n"+msg+"\r\n"))
}
