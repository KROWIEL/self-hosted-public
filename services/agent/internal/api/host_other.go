//go:build !linux && !windows

package api

// Platforms other than Linux/Windows (e.g. a macOS dev host) don't provide
// these OS-level metrics through this agent; report nothing so callers omit them.

func loadAvg() (l1, l5, l15 float64, ok bool) { return 0, 0, 0, false }

func memInfo() (totalMb, availMb int64, ok bool) { return 0, 0, false }

func diskUsage(_ string) (totalGb, freeGb float64, ok bool) { return 0, 0, false }

func cpuUsedPerc() (float64, bool) { return 0, false }
