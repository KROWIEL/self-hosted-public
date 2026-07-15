//go:build linux

package api

import (
	"bufio"
	"os"
	"strconv"
	"strings"
	"syscall"
	"time"
)

// diskUsage returns total and free space (GB) of the filesystem holding path.
func diskUsage(path string) (totalGb, freeGb float64, ok bool) {
	var st syscall.Statfs_t
	if err := syscall.Statfs(path, &st); err != nil {
		return 0, 0, false
	}
	bs := float64(st.Bsize)
	const gb = float64(1 << 30)
	total := float64(st.Blocks) * bs / gb
	free := float64(st.Bavail) * bs / gb
	return total, free, true
}

// loadAvg reads the 1/5/15-minute load averages from /proc/loadavg.
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

// memInfo returns total and available memory in MB from /proc/meminfo.
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

// cpuUsedPerc samples aggregate CPU time from /proc/stat over a short interval
// and returns busy time as a percentage.
func cpuUsedPerc() (float64, bool) {
	total1, idle1, ok := cpuStat()
	if !ok {
		return 0, false
	}
	time.Sleep(200 * time.Millisecond)
	total2, idle2, ok := cpuStat()
	if !ok {
		return 0, false
	}
	dt := total2 - total1
	di := idle2 - idle1
	if dt == 0 {
		return 0, false
	}
	busy := float64(dt-di) / float64(dt) * 100
	if busy < 0 {
		busy = 0
	}
	if busy > 100 {
		busy = 100
	}
	return busy, true
}

// cpuStat returns aggregate (total, idle) jiffies from the "cpu" line of
// /proc/stat. Idle includes iowait.
func cpuStat() (total, idle uint64, ok bool) {
	b, err := os.ReadFile("/proc/stat")
	if err != nil {
		return 0, 0, false
	}
	for _, line := range strings.Split(string(b), "\n") {
		if !strings.HasPrefix(line, "cpu ") {
			continue
		}
		f := strings.Fields(line)
		for i := 1; i < len(f); i++ {
			v, _ := strconv.ParseUint(f[i], 10, 64)
			total += v
			// idle (index 4) + iowait (index 5) count as idle time.
			if i == 4 || i == 5 {
				idle += v
			}
		}
		return total, idle, true
	}
	return 0, 0, false
}
