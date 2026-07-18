package api

import (
	"encoding/json"
	"net/http"
	"strings"
)

type certPutBody struct {
	Host    string `json:"host"`
	CertPEM string `json:"certPem"`
	KeyPEM  string `json:"keyPem"`
}

func (s *Server) handleCertPut(w http.ResponseWriter, r *http.Request) {
	var body certPutBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	if err := s.certs.Put(body.Host, body.CertPEM, body.KeyPEM); err != nil {
		writeJSON(w, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	writeJSON(w, map[string]any{"ok": true})
}

func (s *Server) handleCertDelete(w http.ResponseWriter, r *http.Request) {
	host := strings.TrimSpace(r.URL.Query().Get("host"))
	if host == "" {
		http.Error(w, "host required", http.StatusBadRequest)
		return
	}
	if err := s.certs.Delete(host); err != nil {
		writeJSON(w, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	writeJSON(w, map[string]any{"ok": true})
}

func (s *Server) handleCertList(w http.ResponseWriter, r *http.Request) {
	hosts, err := s.certs.ListHosts()
	if err != nil {
		writeJSON(w, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	writeJSON(w, map[string]any{"ok": true, "hosts": hosts})
}
