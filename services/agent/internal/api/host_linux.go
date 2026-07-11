//go:build linux

package api

import "syscall"

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
