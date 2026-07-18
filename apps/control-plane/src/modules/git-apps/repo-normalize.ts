/**
 * Normalize a git remote URL or GitHub/GitLab full_name into a canonical
 * `owner/repo` (or `group/subgroup/repo`) key for matching + allowlists.
 */
export function normalizeRepoKey(input: string): string | null {
  const raw = (input ?? '').trim();
  if (!raw) return null;

  // Already "owner/repo" (no scheme, no .git).
  if (/^[\w.-]+(?:\/[\w.-]+)+$/.test(raw) && !raw.includes(':')) {
    return raw.replace(/\.git$/i, '').toLowerCase();
  }

  // git@host:owner/repo.git
  const scp = raw.match(/^git@[^:]+:(.+)$/i);
  if (scp) {
    return scp[1].replace(/\.git$/i, '').replace(/^\/+/, '').toLowerCase();
  }

  // https://host/owner/repo(.git)?
  try {
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw)
      ? raw
      : `https://${raw}`;
    const u = new URL(withScheme);
    const path = u.pathname.replace(/^\/+/, '').replace(/\.git$/i, '');
    if (!path || !path.includes('/')) return null;
    return path.toLowerCase();
  } catch {
    return null;
  }
}

/** True when `repo` is allowed by a comma-separated allowlist (empty = allow all). */
export function repoAllowed(repo: string, allowlist: string): boolean {
  const entries = allowlist
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .map((s) => normalizeRepoKey(s) ?? s);
  if (entries.length === 0) return true;
  const key = (normalizeRepoKey(repo) ?? repo).toLowerCase();
  return entries.includes(key);
}

export function branchSlug(branch: string): string {
  return (
    branch
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 30) || 'preview'
  );
}
