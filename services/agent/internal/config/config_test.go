package config

import (
	"testing"
	"time"
)

func TestEnvDuration(t *testing.T) {
	const key = "AGENT_TEST_DURATION"
	def := 20 * time.Minute

	cases := []struct {
		name string
		val  string
		want time.Duration
	}{
		{"empty uses default", "", def},
		{"duration string", "90s", 90 * time.Second},
		{"minutes string", "5m", 5 * time.Minute},
		{"compound", "1h30m", 90 * time.Minute},
		{"bare integer is seconds", "45", 45 * time.Second},
		{"malformed uses default", "not-a-duration", def},
		{"zero uses default", "0", def},
		{"negative uses default", "-5m", def},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			t.Setenv(key, c.val)
			got := envDuration(key, def)
			if got != c.want {
				t.Fatalf("envDuration(%q=%q) = %v, want %v", key, c.val, got, c.want)
			}
		})
	}
}

func TestInsecureHTTP(t *testing.T) {
	cases := []struct {
		name     string
		insecure string
		dev      string
		want     bool
	}{
		{"unset", "", "", false},
		{"insecure without dev sentinel", "1", "", false},
		{"insecure with dev disabled", "1", "0", false},
		{"insecure with dev sentinel", "1", "1", true},
		{"dev sentinel alone", "", "1", false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			t.Setenv("AGENT_INSECURE_HTTP", c.insecure)
			t.Setenv("AGENT_DEV", c.dev)
			if got := insecureHTTP(); got != c.want {
				t.Fatalf("insecureHTTP(INSECURE=%q DEV=%q) = %v, want %v",
					c.insecure, c.dev, got, c.want)
			}
		})
	}
}

func TestEnvInt(t *testing.T) {
	const key = "AGENT_TEST_INT"
	if got := envInt(key, 2); got != 2 {
		t.Fatalf("envInt default = %d, want 2", got)
	}
	t.Setenv(key, "5")
	if got := envInt(key, 2); got != 5 {
		t.Fatalf("envInt(5) = %d, want 5", got)
	}
	t.Setenv(key, "bad")
	if got := envInt(key, 2); got != 2 {
		t.Fatalf("envInt(bad) = %d, want fallback 2", got)
	}
}
