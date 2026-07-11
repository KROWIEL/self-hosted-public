package builder

import (
	"context"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

// InspectRequest asks the agent to clone a repo and detect its env/database needs.
type InspectRequest struct {
	WorkID   string // unique subdir under workDir
	RepoURL  string
	Branch   string
	PATToken string
}

// EnvKey is a variable discovered in a repo's .env example file.
type EnvKey struct {
	Key     string `json:"key"`
	Example string `json:"example"`
	// DbRole, when set, marks this key as a DB-connection field the control
	// plane should fill from a provisioned database: url|host|port|name|user|password.
	DbRole string `json:"dbRole,omitempty"`
	// DbName is the schema/database name parsed from the example (for url/name
	// roles), so the control plane can target the right schema.
	DbName string `json:"dbName,omitempty"`
}

// DatabaseNeed is a database engine the repo needs, with the distinct schemas
// referenced across its config (e.g. an "admin" and a "main" schema).
type DatabaseNeed struct {
	Engine  string   `json:"engine"` // POSTGRES | MYSQL
	Schemas []string `json:"schemas"`
}

// InspectResult is the detection outcome returned to the control plane.
type InspectResult struct {
	EnvFile   string         `json:"envFile"`
	EnvKeys   []EnvKey       `json:"envKeys"`
	Databases []DatabaseNeed `json:"databases"`
}

var envFileCandidates = []string{
	".env.example", ".env.sample", ".env.template", ".env.dist",
	".env.defaults", "env.example", ".env",
}

var composeCandidates = []string{
	"docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml",
}

var composeImageRe = regexp.MustCompile(`(?mi)^\s*image:\s*["']?([^\s"']+)`)

// jdbcUrlRe matches DB connection URLs in config files (Spring/Java/etc.):
// jdbc:mysql://host:3306/schema, r2dbc:postgresql://host/schema,
// postgres://user:pw@host/schema. Captures engine word + schema path segment.
var jdbcUrlRe = regexp.MustCompile(
	`(?i)(?:jdbc:|r2dbc:)?(mysql|mariadb|postgresql|postgres)://[^/\s"']+/([A-Za-z0-9_-]+)`)

// configScanCandidates are config files likely to carry hardcoded DB URLs.
var configScanNames = []string{
	"application.properties", "application.yml", "application.yaml",
}

func looksLikeConfig(name string) bool {
	for _, c := range configScanNames {
		if name == c {
			return true
		}
	}
	// application-<profile>.{properties,yml,yaml}
	if strings.HasPrefix(name, "application-") {
		return strings.HasSuffix(name, ".properties") ||
			strings.HasSuffix(name, ".yml") || strings.HasSuffix(name, ".yaml")
	}
	return false
}

// Inspect clones the repo shallowly and returns detected env keys + databases.
func (b *Builder) Inspect(ctx context.Context, req InspectRequest) (*InspectResult, error) {
	dir := filepath.Join(b.workDir, "inspect-"+req.WorkID)
	if err := os.RemoveAll(dir); err != nil {
		return nil, err
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	defer os.RemoveAll(dir)

	cloneURL := req.RepoURL
	if req.PATToken != "" {
		cloneURL = injectToken(req.RepoURL, req.PATToken)
	}
	if err := run(ctx, io.Discard, dir, "git",
		"clone", "--depth", "1", "--branch", req.Branch, cloneURL, "."); err != nil {
		return nil, err
	}

	res := &InspectResult{EnvKeys: []EnvKey{}, Databases: []DatabaseNeed{}}
	engines := map[string]bool{}
	// schemas[engine] = set of distinct schema names.
	schemas := map[string]map[string]bool{"POSTGRES": {}, "MYSQL": {}}
	addSchema := func(engine, name string) {
		if engine == "" || name == "" {
			return
		}
		schemas[engine][name] = true
	}
	// seenKeys dedupes env keys across sources (.env file + config files).
	seenKeys := map[string]bool{}
	// looseSchemas are schema names detected without a known engine; they are
	// attributed to the sole engine (if unambiguous) after all scans.
	looseSchemas := []string{}

	// 1) .env example file → keys + DB roles + engine/schema hints.
	for _, name := range envFileCandidates {
		data, err := os.ReadFile(filepath.Join(dir, name))
		if err != nil {
			continue
		}
		res.EnvFile = name
		keys := parseEnvFile(string(data))
		for _, ev := range keys {
			if seenKeys[ev.Key] {
				continue
			}
			seenKeys[ev.Key] = true
			res.EnvKeys = append(res.EnvKeys, ev)
			for _, e := range enginesFromEnv(ev) {
				engines[e] = true
				addSchema(e, ev.DbName)
			}
		}
		// name-role schemas where the engine is unambiguous (single engine seen).
		single := singleEngine(engines)
		if single != "" {
			for _, ev := range keys {
				if ev.DbRole == "name" {
					addSchema(single, ev.DbName)
				}
			}
		}
		break
	}

	// 2) docker-compose images → engines.
	for _, name := range composeCandidates {
		data, err := os.ReadFile(filepath.Join(dir, name))
		if err != nil {
			continue
		}
		for _, m := range composeImageRe.FindAllStringSubmatch(string(data), -1) {
			if e := engineFromImage(m[1]); e != "" {
				engines[e] = true
			}
		}
		break
	}

	// 3) Spring/Java config files → engines + schemas from hardcoded JDBC URLs
	// AND override env keys derived from DB-connection properties (so apps that
	// hardcode host/credentials in application.yml can be redirected via
	// Spring relaxed-binding env vars: app.datasource.host → APP_DATASOURCE_HOST).
	scanConfigs(dir, configEmit{
		engineSchema: func(engine, schema string) {
			engines[engine] = true
			addSchema(engine, schema)
		},
		loose: func(schema string) {
			looseSchemas = append(looseSchemas, schema)
		},
		envKey: func(ek EnvKey) {
			if ek.Key == "" || seenKeys[ek.Key] {
				return
			}
			seenKeys[ek.Key] = true
			res.EnvKeys = append(res.EnvKeys, ek)
		},
	})

	// Attribute schema names found without an explicit engine to the sole engine.
	if se := singleEngine(engines); se != "" {
		for _, s := range looseSchemas {
			addSchema(se, s)
		}
	}

	for _, e := range []string{"POSTGRES", "MYSQL"} {
		if engines[e] {
			res.Databases = append(res.Databases, DatabaseNeed{
				Engine:  e,
				Schemas: sortedKeys(schemas[e]),
			})
		}
	}
	return res, nil
}

// configEmit collects detection results from config-file scanning.
type configEmit struct {
	// engineSchema reports a (engine, schema) pair; schema may be empty.
	engineSchema func(engine, schema string)
	// loose reports a schema name whose engine is not yet known.
	loose func(schema string)
	// envKey reports an override env key derived from a config property.
	envKey func(EnvKey)
}

// scanConfigs walks the repo for Spring/Java config files and reports both the
// engines/schemas found in hardcoded DB URLs and override env keys derived from
// DB-connection properties. Skips heavy/vendor dirs and large files.
func scanConfigs(root string, emit configEmit) {
	skipDirs := map[string]bool{
		".git": true, "node_modules": true, "target": true,
		"build": true, "dist": true, ".gradle": true, "out": true,
	}
	_ = filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() {
			if skipDirs[d.Name()] {
				return filepath.SkipDir
			}
			return nil
		}
		if !looksLikeConfig(d.Name()) {
			return nil
		}
		if info, e := d.Info(); e == nil && info.Size() > 512*1024 {
			return nil
		}
		data, e := os.ReadFile(path)
		if e != nil {
			return nil
		}
		text := string(data)

		// (a) Any DB URL literal → engine + schema.
		for _, m := range jdbcUrlRe.FindAllStringSubmatch(text, -1) {
			engine := engineFromScheme(m[1])
			if engine == "" {
				continue
			}
			schema := m[2]
			if i := strings.IndexAny(schema, "?#"); i >= 0 {
				schema = schema[:i]
			}
			if isIdent(schema) {
				emit.engineSchema(engine, schema)
			}
		}

		// (b) DB-connection properties → override env keys + schema names.
		for path2, val := range flattenConfig(d.Name(), text) {
			scanConfigProp(path2, val, emit)
		}
		return nil
	})
}

// scanConfigProp classifies a flattened config property (path=value) and, when
// it is a DB-connection field, reports an override env key and/or schema name.
func scanConfigProp(path, val string, emit configEmit) {
	segs := strings.Split(strings.ToLower(path), ".")
	if !hasDbContext(segs) {
		return
	}
	// Placeholder values (${VAR:default}) already read an env var — skip.
	if strings.Contains(val, "${") {
		return
	}
	leaf := segs[len(segs)-1]

	if role := springRoleLeaf(leaf); role != "" {
		ek := EnvKey{Key: relaxedEnvName(path), Example: val, DbRole: role}
		if role == "url" {
			ek.DbName = schemaFromExample("url", val)
			for _, e := range enginesFromValue(val) {
				emit.engineSchema(e, ek.DbName)
			}
		}
		emit.envKey(ek)
		return
	}

	// Schema/database name properties (e.g. app.datasource.admin-database).
	if springSchemaLeaf(leaf) && isIdent(val) {
		emit.loose(val)
	}
}

// hasDbContext is true when any path segment marks the property as DB-related,
// avoiding false positives like server.port or spring.application.name.
func hasDbContext(segs []string) bool {
	for _, s := range segs {
		if springDbContext[s] {
			return true
		}
	}
	return false
}

// springDbContext are path segments that mark a property as DB-related.
var springDbContext = map[string]bool{
	"datasource": true, "r2dbc": true, "flyway": true, "jdbc": true,
	"database": true, "db": true, "mysql": true, "postgres": true,
	"postgresql": true, "mariadb": true, "hikari": true, "liquibase": true,
}

// springRoleLeaf maps a config-property leaf to a DB connection role.
func springRoleLeaf(leaf string) string {
	switch leaf {
	case "url", "jdbc-url", "jdbcurl", "jdbc_url":
		return "url"
	case "host", "hostname":
		return "host"
	case "port":
		return "port"
	case "username", "user":
		return "user"
	case "password", "pass":
		return "password"
	}
	return ""
}

// springSchemaLeaf marks leaves whose value is a schema/database name.
func springSchemaLeaf(leaf string) bool {
	switch leaf {
	case "database", "db-name", "dbname", "name", "schema",
		"admin-database", "admindatabase", "default-schema", "defaultschema":
		return true
	}
	return false
}

// relaxedEnvName converts a property path to its Spring relaxed-binding env var
// name (app.datasource.host → APP_DATASOURCE_HOST).
func relaxedEnvName(path string) string {
	r := strings.NewReplacer(".", "_", "-", "_")
	return strings.ToUpper(r.Replace(path))
}

// enginesFromValue derives DB engines mentioned in a connection URL value.
func enginesFromValue(v string) []string {
	out := []string{}
	l := strings.ToLower(v)
	if strings.Contains(l, "postgres") {
		out = append(out, "POSTGRES")
	}
	if strings.Contains(l, "mysql") || strings.Contains(l, "mariadb") {
		out = append(out, "MYSQL")
	}
	return out
}

// flattenConfig parses a Spring config file into flat path→value pairs. Supports
// .properties (a.b.c=v) and .yml/.yaml (nested maps flattened by indentation).
func flattenConfig(name, content string) map[string]string {
	if strings.HasSuffix(name, ".properties") {
		return flattenProperties(content)
	}
	return flattenYAML(content)
}

func flattenProperties(content string) map[string]string {
	out := map[string]string{}
	for _, raw := range strings.Split(content, "\n") {
		line := strings.TrimSpace(strings.TrimRight(raw, "\r"))
		if line == "" || strings.HasPrefix(line, "#") || strings.HasPrefix(line, "!") {
			continue
		}
		i := strings.IndexAny(line, "=:")
		if i <= 0 {
			continue
		}
		key := strings.TrimSpace(line[:i])
		val := strings.Trim(strings.TrimSpace(line[i+1:]), `"'`)
		if key != "" {
			out[key] = val
		}
	}
	return out
}

// flattenYAML is a minimal indentation-based YAML flattener sufficient for
// Spring config: scalar leaves are joined by dotted paths. Lists, anchors and
// multi-line scalars are ignored (not needed for connection settings).
func flattenYAML(content string) map[string]string {
	out := map[string]string{}
	type frame struct {
		indent int
		key    string
	}
	var stack []frame
	for _, raw := range strings.Split(content, "\n") {
		line := strings.TrimRight(raw, "\r")
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			continue
		}
		if trimmed == "---" {
			stack = stack[:0]
			continue
		}
		if strings.HasPrefix(trimmed, "- ") || trimmed == "-" {
			continue
		}
		colon := strings.Index(trimmed, ":")
		if colon < 0 {
			continue
		}
		key := strings.TrimSpace(trimmed[:colon])
		if key == "" {
			continue
		}
		rest := strings.TrimSpace(trimmed[colon+1:])
		indent := len(line) - len(strings.TrimLeft(line, " \t"))
		for len(stack) > 0 && stack[len(stack)-1].indent >= indent {
			stack = stack[:len(stack)-1]
		}
		if rest == "" || strings.HasPrefix(rest, "#") {
			stack = append(stack, frame{indent, key})
			continue
		}
		val := rest
		if j := strings.Index(val, " #"); j >= 0 {
			val = val[:j]
		}
		val = strings.Trim(strings.TrimSpace(val), `"'`)
		parts := make([]string, 0, len(stack)+1)
		for _, f := range stack {
			parts = append(parts, f.key)
		}
		parts = append(parts, key)
		out[strings.Join(parts, ".")] = val
	}
	return out
}

func engineFromScheme(scheme string) string {
	switch strings.ToLower(scheme) {
	case "postgres", "postgresql":
		return "POSTGRES"
	case "mysql", "mariadb":
		return "MYSQL"
	}
	return ""
}

func singleEngine(engines map[string]bool) string {
	found := ""
	for e, ok := range engines {
		if !ok {
			continue
		}
		if found != "" {
			return "" // more than one
		}
		found = e
	}
	return found
}

func sortedKeys(m map[string]bool) []string {
	out := []string{}
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func parseEnvFile(text string) []EnvKey {
	out := []EnvKey{}
	seen := map[string]bool{}
	for _, raw := range strings.Split(text, "\n") {
		line := strings.TrimSpace(strings.TrimRight(raw, "\r"))
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		line = strings.TrimPrefix(line, "export ")
		eq := strings.Index(line, "=")
		if eq <= 0 {
			continue
		}
		key := strings.TrimSpace(line[:eq])
		if !validEnvKey(key) || seen[key] {
			continue
		}
		seen[key] = true
		val := strings.TrimSpace(line[eq+1:])
		val = strings.Trim(val, `"'`)
		role := dbRole(key)
		out = append(out, EnvKey{
			Key:     key,
			Example: val,
			DbRole:  role,
			DbName:  schemaFromExample(role, val),
		})
	}
	return out
}

// schemaFromExample extracts the schema/db name from an example value.
// For url roles it parses the path segment; for name roles the value itself is
// the schema name.
func schemaFromExample(role, val string) string {
	if val == "" {
		return ""
	}
	if role == "name" {
		if validEnvKey(strings.ReplaceAll(val, "-", "_")) || isIdent(val) {
			return val
		}
		return ""
	}
	if role != "url" {
		return ""
	}
	// Strip query/anchor, take the last path segment.
	v := val
	if i := strings.IndexAny(v, "?#"); i >= 0 {
		v = v[:i]
	}
	slash := strings.LastIndex(v, "/")
	if slash < 0 || slash == len(v)-1 {
		return ""
	}
	name := v[slash+1:]
	if isIdent(name) {
		return name
	}
	return ""
}

func isIdent(s string) bool {
	if s == "" {
		return false
	}
	for _, r := range s {
		if !(r == '_' || r == '-' || (r >= 'a' && r <= 'z') ||
			(r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9')) {
			return false
		}
	}
	return true
}

func validEnvKey(k string) bool {
	if k == "" {
		return false
	}
	for i, r := range k {
		isAlpha := r == '_' || (r >= 'A' && r <= 'Z') || (r >= 'a' && r <= 'z')
		isDigit := r >= '0' && r <= '9'
		if i == 0 && !isAlpha {
			return false
		}
		if !isAlpha && !isDigit {
			return false
		}
	}
	return true
}

// dbRole classifies a connection variable so it can be filled from a DB.
func dbRole(key string) string {
	u := strings.ToUpper(key)
	switch {
	case strings.Contains(u, "DATABASE_URL"), strings.Contains(u, "DB_URL"),
		strings.Contains(u, "DATASOURCE_URL"), strings.Contains(u, "R2DBC_URL"),
		strings.Contains(u, "JDBC"):
		return "url"
	case strings.HasSuffix(u, "DB_HOST"), strings.HasSuffix(u, "DATABASE_HOST"),
		strings.HasSuffix(u, "POSTGRES_HOST"), strings.HasSuffix(u, "MYSQL_HOST"),
		strings.HasSuffix(u, "PG_HOST"), u == "DB_HOST" || u == "HOST":
		return "host"
	case strings.HasSuffix(u, "DB_PORT"), strings.HasSuffix(u, "DATABASE_PORT"),
		strings.HasSuffix(u, "POSTGRES_PORT"), strings.HasSuffix(u, "MYSQL_PORT"):
		return "port"
	case strings.HasSuffix(u, "DB_NAME"), strings.HasSuffix(u, "DATABASE_NAME"),
		strings.HasSuffix(u, "POSTGRES_DB"), strings.HasSuffix(u, "MYSQL_DATABASE"),
		strings.HasSuffix(u, "DB_DATABASE"):
		return "name"
	case strings.HasSuffix(u, "DB_USER"), strings.HasSuffix(u, "DB_USERNAME"),
		strings.HasSuffix(u, "DATABASE_USER"), strings.HasSuffix(u, "POSTGRES_USER"),
		strings.HasSuffix(u, "MYSQL_USER"):
		return "user"
	case strings.HasSuffix(u, "DB_PASS"), strings.HasSuffix(u, "DB_PASSWORD"),
		strings.HasSuffix(u, "DATABASE_PASSWORD"), strings.HasSuffix(u, "POSTGRES_PASSWORD"),
		strings.HasSuffix(u, "MYSQL_PASSWORD"), u == "PGPASSWORD":
		return "password"
	}
	return ""
}

func enginesFromEnv(ev EnvKey) []string {
	out := []string{}
	u := strings.ToUpper(ev.Key)
	v := strings.ToLower(ev.Example)
	if strings.Contains(u, "POSTGRES") || strings.Contains(u, "PG_") ||
		strings.HasPrefix(v, "postgres") || strings.HasPrefix(v, "postgresql") ||
		strings.HasPrefix(v, "r2dbc:postgres") || strings.Contains(v, "jdbc:postgresql") {
		out = append(out, "POSTGRES")
	}
	if strings.Contains(u, "MYSQL") || strings.HasPrefix(v, "mysql") ||
		strings.HasPrefix(v, "r2dbc:mysql") || strings.Contains(v, "jdbc:mysql") ||
		strings.Contains(v, "mariadb") {
		out = append(out, "MYSQL")
	}
	return out
}

func engineFromImage(image string) string {
	i := strings.ToLower(image)
	if strings.Contains(i, "postgres") {
		return "POSTGRES"
	}
	if strings.Contains(i, "mysql") || strings.Contains(i, "mariadb") {
		return "MYSQL"
	}
	return ""
}
