//go:build windows

package api

import (
	"syscall"
	"time"
	"unsafe"
)

var (
	kernel32                  = syscall.NewLazyDLL("kernel32.dll")
	procGlobalMemoryStatusEx  = kernel32.NewProc("GlobalMemoryStatusEx")
	procGetDiskFreeSpaceExW   = kernel32.NewProc("GetDiskFreeSpaceExW")
	procGetSystemTimes        = kernel32.NewProc("GetSystemTimes")
)

// loadAvg: Windows has no Unix-style load average.
func loadAvg() (l1, l5, l15 float64, ok bool) { return 0, 0, 0, false }

// MEMORYSTATUSEX (kernel32).
type memoryStatusEx struct {
	dwLength                uint32
	dwMemoryLoad            uint32
	ullTotalPhys            uint64
	ullAvailPhys            uint64
	ullTotalPageFile        uint64
	ullAvailPageFile        uint64
	ullTotalVirtual         uint64
	ullAvailVirtual         uint64
	ullAvailExtendedVirtual uint64
}

// memInfo returns total and available physical memory in MB via
// GlobalMemoryStatusEx.
func memInfo() (totalMb, availMb int64, ok bool) {
	var m memoryStatusEx
	m.dwLength = uint32(unsafe.Sizeof(m))
	r, _, _ := procGlobalMemoryStatusEx.Call(uintptr(unsafe.Pointer(&m)))
	if r == 0 {
		return 0, 0, false
	}
	const mb = uint64(1024 * 1024)
	return int64(m.ullTotalPhys / mb), int64(m.ullAvailPhys / mb), true
}

// diskUsage returns total and free space (GB) of the volume holding path via
// GetDiskFreeSpaceExW.
func diskUsage(path string) (totalGb, freeGb float64, ok bool) {
	if path == "" || path == "/" {
		path = `C:\`
	}
	p, err := syscall.UTF16PtrFromString(path)
	if err != nil {
		return 0, 0, false
	}
	var freeAvail, total, totalFree uint64
	r, _, _ := procGetDiskFreeSpaceExW.Call(
		uintptr(unsafe.Pointer(p)),
		uintptr(unsafe.Pointer(&freeAvail)),
		uintptr(unsafe.Pointer(&total)),
		uintptr(unsafe.Pointer(&totalFree)),
	)
	if r == 0 || total == 0 {
		return 0, 0, false
	}
	const gb = float64(1 << 30)
	return float64(total) / gb, float64(totalFree) / gb, true
}

// FILETIME (100-ns intervals split across two 32-bit words).
type fileTime struct {
	dwLowDateTime  uint32
	dwHighDateTime uint32
}

func ftValue(t fileTime) uint64 {
	return uint64(t.dwHighDateTime)<<32 | uint64(t.dwLowDateTime)
}

func systemTimes() (idle, kernel, user uint64, ok bool) {
	var i, k, u fileTime
	r, _, _ := procGetSystemTimes.Call(
		uintptr(unsafe.Pointer(&i)),
		uintptr(unsafe.Pointer(&k)),
		uintptr(unsafe.Pointer(&u)),
	)
	if r == 0 {
		return 0, 0, 0, false
	}
	return ftValue(i), ftValue(k), ftValue(u), true
}

// cpuUsedPerc samples GetSystemTimes over a short interval. Kernel time
// includes idle, so busy = (kernel+user - idle) / (kernel+user).
func cpuUsedPerc() (float64, bool) {
	i1, k1, u1, ok := systemTimes()
	if !ok {
		return 0, false
	}
	time.Sleep(200 * time.Millisecond)
	i2, k2, u2, ok := systemTimes()
	if !ok {
		return 0, false
	}
	idle := float64(i2 - i1)
	total := float64((k2 + u2) - (k1 + u1))
	if total <= 0 {
		return 0, false
	}
	busy := (total - idle) / total * 100
	if busy < 0 {
		busy = 0
	}
	if busy > 100 {
		busy = 100
	}
	return busy, true
}
