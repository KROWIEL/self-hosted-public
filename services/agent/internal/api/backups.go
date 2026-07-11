package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
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

// safeFile rejects names with path separators (prevents path traversal).
func safeFile(name string) bool {
	return name != "" && filepath.Base(name) == name &&
		!strings.Contains(name, "..")
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
		err = s.docker.RunEphemeral(ctx,
			"-v", body.Volume+":/data:ro",
			"-v", s.cfg.BackupDir+":/out",
			"alpine", "sh", "-c",
			fmt.Sprintf("tar czf /out/%s -C /data .", body.File),
		)
	case "DATABASE":
		var f *os.File
		f, err = os.Create(path)
		if err == nil {
			defer f.Close()
			err = s.docker.ExecCapture(ctx, body.Container, f, "sh", "-c", dumpCmd(body))
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
		err = s.docker.RunEphemeral(ctx,
			"-v", body.Volume+":/data",
			"-v", s.cfg.BackupDir+":/in",
			"alpine", "sh", "-c",
			fmt.Sprintf("rm -rf /data/* && tar xzf /in/%s -C /data", body.File),
		)
	case "DATABASE":
		var f *os.File
		f, err = os.Open(path)
		if err == nil {
			defer f.Close()
			err = s.docker.ExecStdin(ctx, body.Container, f, "sh", "-c", restoreCmd(body))
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

func dumpCmd(b backupBody) string {
	if b.Engine == "mysql" {
		return fmt.Sprintf("mysqldump -uroot -p%s %s | gzip", b.Password, b.DBName)
	}
	return fmt.Sprintf("pg_dump -U %s %s | gzip", b.User, b.DBName)
}

func restoreCmd(b backupBody) string {
	if b.Engine == "mysql" {
		return fmt.Sprintf("gunzip | mysql -uroot -p%s %s", b.Password, b.DBName)
	}
	return fmt.Sprintf("gunzip | psql -U %s -d %s", b.User, b.DBName)
}
