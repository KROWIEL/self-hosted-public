package certs

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPutAndDelete(t *testing.T) {
	dir := t.TempDir()
	m := New(filepath.Join(dir, "certs"), filepath.Join(dir, "dynamic"))

	cert := "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n"
	key := "-----BEGIN PRIVATE KEY-----\nMIIE\n-----END PRIVATE KEY-----\n"
	if err := m.Put("App.Example.com", cert, key); err != nil {
		t.Fatal(err)
	}
	hosts, err := m.ListHosts()
	if err != nil {
		t.Fatal(err)
	}
	if len(hosts) != 1 || hosts[0] != "app.example.com" {
		t.Fatalf("hosts = %#v", hosts)
	}
	raw, err := os.ReadFile(filepath.Join(dir, "dynamic", "certs.yml"))
	if err != nil {
		t.Fatal(err)
	}
	s := string(raw)
	if !strings.Contains(s, "/certs/app.example.com.crt") {
		t.Fatalf("dynamic yaml missing cert path:\n%s", s)
	}
	if !strings.Contains(s, "/certs/app.example.com.key") {
		t.Fatalf("dynamic yaml missing key path:\n%s", s)
	}

	if err := m.Delete("App.Example.com"); err != nil {
		t.Fatal(err)
	}
	hosts, err = m.ListHosts()
	if err != nil {
		t.Fatal(err)
	}
	if len(hosts) != 0 {
		t.Fatalf("expected empty after delete, got %#v", hosts)
	}
	raw, err = os.ReadFile(filepath.Join(dir, "dynamic", "certs.yml"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(raw), "certificates: []") {
		t.Fatalf("expected empty certificates list:\n%s", raw)
	}
}

func TestPutRejectsNonPEM(t *testing.T) {
	dir := t.TempDir()
	m := New(filepath.Join(dir, "certs"), filepath.Join(dir, "dynamic"))
	if err := m.Put("x.com", "not-a-cert", "-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----\n"); err == nil {
		t.Fatal("expected error for bad cert")
	}
}
