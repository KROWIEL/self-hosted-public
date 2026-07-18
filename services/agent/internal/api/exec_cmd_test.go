package api

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestNormalizeExecCommandString(t *testing.T) {
	argv, err := normalizeExecCommand(json.RawMessage(`"echo hello"`))
	if err != nil {
		t.Fatal(err)
	}
	if len(argv) != 3 || argv[0] != "sh" || argv[1] != "-c" || argv[2] != "echo hello" {
		t.Fatalf("got %#v", argv)
	}
}

func TestNormalizeExecCommandArgv(t *testing.T) {
	argv, err := normalizeExecCommand(json.RawMessage(`["ls","-la","/tmp"]`))
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"ls", "-la", "/tmp"}
	if len(argv) != len(want) {
		t.Fatalf("got %#v", argv)
	}
	for i := range want {
		if argv[i] != want[i] {
			t.Fatalf("got %#v, want %#v", argv, want)
		}
	}
}

func TestNormalizeExecCommandRejectsNUL(t *testing.T) {
	raw, _ := json.Marshal("echo\x00evil")
	if _, err := normalizeExecCommand(raw); err == nil {
		t.Fatal("expected NUL rejection")
	}
	rawArr, _ := json.Marshal([]string{"echo", "hi\x00"})
	if _, err := normalizeExecCommand(rawArr); err == nil {
		t.Fatal("expected NUL rejection in argv")
	}
}

func TestNormalizeExecCommandRejectsEmpty(t *testing.T) {
	if _, err := normalizeExecCommand(json.RawMessage(`[]`)); err == nil {
		t.Fatal("expected empty argv rejection")
	}
	if _, err := normalizeExecCommand(json.RawMessage(`null`)); err == nil {
		t.Fatal("expected null rejection")
	}
	if _, err := normalizeExecCommand(nil); err == nil {
		t.Fatal("expected nil rejection")
	}
}

func TestNormalizeExecCommandRejectsObject(t *testing.T) {
	_, err := normalizeExecCommand(json.RawMessage(`{"cmd":"ls"}`))
	if err == nil || !strings.Contains(err.Error(), "string or string array") {
		t.Fatalf("got %v", err)
	}
}
