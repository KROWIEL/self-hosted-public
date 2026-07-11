package builder

import (
	"os"
	"path/filepath"
	"testing"
)

// smartCalendarYML mirrors the shape of the smart-calendar application.yml that
// hardcodes localhost/root and declares a separate admin database.
const smartCalendarYML = `spring:
  config:
    import: optional:file:.env[.properties]
  application:
    name: smart-calendar
  r2dbc:
    username: root
    password: root
  flyway:
    enabled: false

server:
  port: 8080

app:
  datasource:
    host: localhost
    port: 3306
    username: root
    password: root
    admin-database: smart_calendar_admin
  flyway:
    url: jdbc:mysql://localhost:3306
    params: useSSL=false&allowPublicKeyRetrieval=true&serverTimezone=UTC
    user: root
    password: root
  base-host: localhost
`

func TestScanConfigsSpringProperties(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "application.yml"),
		[]byte(smartCalendarYML), 0o600); err != nil {
		t.Fatal(err)
	}

	keys := map[string]EnvKey{}
	engines := map[string]bool{}
	schemas := map[string]bool{}
	loose := []string{}
	scanConfigs(dir, configEmit{
		engineSchema: func(engine, schema string) {
			engines[engine] = true
			if schema != "" {
				schemas[schema] = true
			}
		},
		loose:  func(s string) { loose = append(loose, s) },
		envKey: func(ek EnvKey) { keys[ek.Key] = ek },
	})

	wantRoles := map[string]string{
		"APP_DATASOURCE_HOST":     "host",
		"APP_DATASOURCE_PORT":     "port",
		"APP_DATASOURCE_USERNAME": "user",
		"APP_DATASOURCE_PASSWORD": "password",
		"APP_FLYWAY_URL":          "url",
		"APP_FLYWAY_USER":         "user",
		"APP_FLYWAY_PASSWORD":     "password",
		"SPRING_R2DBC_USERNAME":   "user",
		"SPRING_R2DBC_PASSWORD":   "password",
	}
	for k, role := range wantRoles {
		ek, ok := keys[k]
		if !ok {
			t.Errorf("missing env key %s", k)
			continue
		}
		if ek.DbRole != role {
			t.Errorf("%s: role=%q want %q", k, ek.DbRole, role)
		}
	}

	// URL example must be preserved verbatim for later rewriting.
	if ek := keys["APP_FLYWAY_URL"]; ek.Example != "jdbc:mysql://localhost:3306" {
		t.Errorf("APP_FLYWAY_URL example=%q", ek.Example)
	}

	// server.port and spring.application.name must NOT be detected.
	if _, ok := keys["SERVER_PORT"]; ok {
		t.Error("server.port wrongly detected as DB property")
	}

	if !engines["MYSQL"] {
		t.Error("MYSQL engine not detected")
	}

	// admin-database should surface as a loose schema name.
	found := false
	for _, s := range loose {
		if s == "smart_calendar_admin" {
			found = true
		}
	}
	if !found {
		t.Errorf("smart_calendar_admin not detected as schema; loose=%v", loose)
	}
}

func TestFlattenYAMLNesting(t *testing.T) {
	flat := flattenYAML("a:\n  b:\n    c: hello\n  d: world\n")
	if flat["a.b.c"] != "hello" {
		t.Errorf("a.b.c=%q", flat["a.b.c"])
	}
	if flat["a.d"] != "world" {
		t.Errorf("a.d=%q", flat["a.d"])
	}
}
