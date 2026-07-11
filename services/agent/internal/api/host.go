package api

import (
	"bufio"
	"net/http"
	"os"
	"runtime"
	"strconv"
	"strings"
)

// handleHost reports OS-level metrics of the node (as opposed to Docker-level in
// /api/system): CPU cores + load average, RAM total/used, disk total/used. Load
// average and meminfo come from /proc (Linux); disk usage is platform-specific
// (see host_linux.go / host_other.go). Missing values are simply omitted.
func (s *Server) handleHost(w http.ResponseWriter, _ *http.Request) {
	resp := map[string]any{"cpuCores": runtime.NumCPU()}

	if l1, l5, l15, ok := loadAvg(); ok {
		resp["load1"] = round2(l1)
		resp["load5"] = round2(l5)
		resp["load15"] = round2(l15)
	}

	if totalMb, availMb, ok := memInfo(); ok {
		used := totalMb - availMb
		resp["memTotalMb"] = totalMb
		resp["memUsedMb"] = used
		if totalMb > 0 {
			resp["memUsedPerc"] = round2(float64(used) / float64(totalMb) * 100)
		}
	}

	path := os.Getenv("AGENT_WORKDIR")
	if path == "" {
		path = "/"
	}
	if totalGb, freeGb, ok := diskUsage(path); ok {
		used := totalGb - freeGb
		resp["diskTotalGb"] = round2(totalGb)
		resp["diskUsedGb"] = round2(used)
		if totalGb > 0 {
			resp["diskUsedPerc"] = round2(used / totalGb * 100)
		}
	}

	writeJSON(w, resp)
}

// loadAvg reads the 1/5/15-minute load averages from /proc/loadavg (Linux).
func loadAvg() (l1, l5, l15 float64, ok bool) {
	b, err := os.ReadFile("/proc/loadavg")
	if err != nil {
		return 0, 0, 0, false
	}
	f := strings.Fields(string(b))
	if len(f) < 3 {
		return 0, 0, 0, false
	}
	l1, _ = strconv.ParseFloat(f[0], 64)
	l5, _ = strconv.ParseFloat(f[1], 64)
	l15, _ = strconv.ParseFloat(f[2], 64)
	return l1, l5, l15, true
}

// memInfo returns total and available memory in MB from /proc/meminfo (Linux).
func memInfo() (totalMb, availMb int64, ok bool) {
	fp, err := os.Open("/proc/meminfo")
	if err != nil {
		return 0, 0, false
	}
	defer fp.Close()
	var total, avail int64
	sc := bufio.NewScanner(fp)
	for sc.Scan() {
		line := sc.Text()
		switch {
		case strings.HasPrefix(line, "MemTotal:"):
			total = parseMeminfoKb(line)
		case strings.HasPrefix(line, "MemAvailable:"):
			avail = parseMeminfoKb(line)
		}
	}
	if total == 0 {
		return 0, 0, false
	}
	return total / 1024, avail / 1024, true
}

// parseMeminfoKb pulls the kB value out of a meminfo line ("MemTotal: 16384 kB").
func parseMeminfoKb(line string) int64 {
	f := strings.Fields(line)
	if len(f) < 2 {
		return 0
	}
	v, _ := strconv.ParseInt(f[1], 10, 64)
	return v
}
