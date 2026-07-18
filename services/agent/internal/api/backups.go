package api

import (
	"compress/gzip"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/self-hosted/agent/internal/docker"
)

// Backup / restore of volumes (tar.gz) and managed databases (sql.gz).
// Files live under cfg.BackupDir on the node. The control plane owns naming and
// passes the credentials needed to dump/restore a database.

type backupBody struct {
	Kind string `json:"kind"` // VOLUME | DATABASE
	File string `json:"file"` // base file name within BackupDir

	// VOLUME
	Volume string `json:"volume"`

	// DATABASE
	Container string `json:"container"`
	Engine    string `json:"engine"` // postgres | mysql
	User      string `json:"user"`
	Password  string `json:"password"`
	DBName    string `json:"dbName"`
}

// safeFileRe restricts backup file names to a conservative charset so they can
// never carry path separators, shell metacharacters or option-like prefixes.
var safeFileRe = regexp.MustCompile(`^[A-Za-z0-9._-]+$`)

// safeFile rejects names with path separators or traversal (prevents path
// traversal) and anything outside the allowed charset.
func safeFile(name string) bool {
	return name != "" && filepath.Base(name) == name &&
		!strings.Contains(name, "..") && safeFileRe.MatchString(name)
}

func (s *Server) backupPath(file string) string {
	return filepath.Join(s.cfg.BackupDir, file)
}

func (s *Server) handleBackupCreate(w http.ResponseWriter, r *http.Request) {
	var body backupBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || !safeFile(body.File) {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	if err := os.MkdirAll(s.cfg.BackupDir, 0o755); err != nil {
		writeJSON(w, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	ctx := context.Background()
	path := s.backupPath(body.File)

	var err error
	switch body.Kind {
	case "VOLUME":
		// Reject non-volume names so "-v <name>:/data" can't become a host
		// bind-mount (e.g. "/etc:/data").
		if !docker.ValidVolumeName(body.Volume) {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}
		// Direct argv (no shell): file name is already charset-restricted.
		err = s.docker.RunEphemeral(ctx,
			"-v", body.Volume+":/data:ro",
			"-v", s.cfg.BackupDir+":/out",
			"alpine", "tar", "czf", "/out/"+body.File, "-C", "/data", ".",
		)
	case "DATABASE":
		var f *os.File
		f, err = os.Create(path)
		if err == nil {
			defer f.Close()
			// Dump uncompressed from the container (argv only, password via
			// env) and gzip on the agent side to preserve the .sql.gz format.
			gz := gzip.NewWriter(f)
			err = s.docker.ExecCaptureEnv(ctx, body.Container,
				dbPasswordEnv(body.Engine, body.Password), gz, dumpArgv(body)...)
			if cerr := gz.Close(); cerr != nil && err == nil {
				err = cerr
			}
		}
	default:
		http.Error(w, "bad kind", http.StatusBadRequest)
		return
	}

	if err != nil {
		_ = os.Remove(path)
		writeJSON(w, map[string]any{"ok": false, "error": err.Error()})
		return
	}

	var size int64
	if fi, statErr := os.Stat(path); statErr == nil {
		size = fi.Size()
	}
	writeJSON(w, map[string]any{"ok": true, "sizeBytes": size})
}

func (s *Server) handleBackupRestore(w http.ResponseWriter, r *http.Request) {
	var body backupBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || !safeFile(body.File) {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	ctx := context.Background()
	path := s.backupPath(body.File)
	if _, err := os.Stat(path); err != nil {
		writeJSON(w, map[string]any{"ok": false, "error": "backup file not found"})
		return
	}

	var err error
	switch body.Kind {
	case "VOLUME":
		if !docker.ValidVolumeName(body.Volume) {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}
		// The rm-glob + tar sequence needs a shell, but the file name is passed
		// as a positional arg ($1), never interpolated into the script.
		err = s.docker.RunEphemeral(ctx,
			"-v", body.Volume+":/data",
			"-v", s.cfg.BackupDir+":/in",
			"alpine", "sh", "-c",
			`rm -rf /data/* && tar xzf "/in/$1" -C /data`,
			"sh", body.File,
		)
	case "DATABASE":
		var f *os.File
		f, err = os.Open(path)
		if err == nil {
			defer f.Close()
			// Decompress on the agent side, feed plain SQL to the client over
			// stdin (argv only, password via env).
			var gz *gzip.Reader
			gz, err = gzip.NewReader(f)
			if err == nil {
				defer gz.Close()
				err = s.docker.ExecStdinEnv(ctx, body.Container,
					dbPasswordEnv(body.Engine, body.Password), gz, restoreArgv(body)...)
			}
		}
	default:
		http.Error(w, "bad kind", http.StatusBadRequest)
		return
	}

	if err != nil {
		writeJSON(w, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	writeJSON(w, map[string]any{"ok": true})
}

func (s *Server) handleBackupDownload(w http.ResponseWriter, r *http.Request) {
	file := r.URL.Query().Get("file")
	if !safeFile(file) {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	path := s.backupPath(file)
	if _, err := os.Stat(path); err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", file))
	http.ServeFile(w, r, path)
}

func (s *Server) handleBackupDelete(w http.ResponseWriter, r *http.Request) {
	var body backupBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || !safeFile(body.File) {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	_ = os.Remove(s.backupPath(body.File))
	writeJSON(w, map[string]any{"ok": true})
}

// dumpArgv is the in-container command (argv, no shell) that writes an
// uncompressed dump to stdout. The agent gzips the stream.
func dumpArgv(b backupBody) []string {
	if b.Engine == "mysql" {
		return []string{"mysqldump", "-uroot", b.DBName}
	}
	return []string{"pg_dump", "-U", b.User, b.DBName}
}

// restoreArgv is the in-container command (argv, no shell) that reads plain SQL
// from stdin. The agent decompresses the .gz before piping it in.
func restoreArgv(b backupBody) []string {
	if b.Engine == "mysql" {
		return []string{"mysql", "-uroot", b.DBName}
	}
	return []string{"psql", "-U", b.User, "-d", b.DBName}
}

// dbPasswordEnv maps a DB password onto the env var the client tools read
// (MYSQL_PWD / PGPASSWORD), so it never appears on a command line. Returns nil
// when no password is set (unchanged behavior for trust-auth setups).
func dbPasswordEnv(engine, password string) map[string]string {
	if password == "" {
		return nil
	}
	if engine == "mysql" {
		return map[string]string{"MYSQL_PWD": password}
	}
	return map[string]string{"PGPASSWORD": password}
}
