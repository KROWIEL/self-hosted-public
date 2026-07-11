//go:build !linux

package api

// diskUsage is Linux-only; other platforms (Windows dev host) report nothing.
func diskUsage(_ string) (totalGb, freeGb float64, ok bool) {
	return 0, 0, false
}
