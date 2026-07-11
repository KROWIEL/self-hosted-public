package api

import "testing"

func TestParseResize(t *testing.T) {
	tests := []struct {
		name     string
		in       string
		wantCols int
		wantRows int
		wantOk   bool
	}{
		{"valid resize", `{"resize":{"cols":120,"rows":40}}`, 120, 40, true},
		{"zero dims", `{"resize":{"cols":0,"rows":0}}`, 0, 0, true},
		{"no resize field", `{"data":"ls -la"}`, 0, 0, false},
		{"empty object", `{}`, 0, 0, false},
		{"invalid json", `not json`, 0, 0, false},
		{"empty input", ``, 0, 0, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cols, rows, ok := parseResize([]byte(tt.in))
			if ok != tt.wantOk {
				t.Fatalf("ok = %v, want %v", ok, tt.wantOk)
			}
			if ok && (cols != tt.wantCols || rows != tt.wantRows) {
				t.Fatalf("got cols=%d rows=%d, want cols=%d rows=%d",
					cols, rows, tt.wantCols, tt.wantRows)
			}
		})
	}
}
