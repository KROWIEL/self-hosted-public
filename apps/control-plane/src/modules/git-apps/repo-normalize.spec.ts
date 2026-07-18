import {
  branchSlug,
  normalizeRepoKey,
  parseRepoAllowlist,
  repoAllowed,
} from './repo-normalize';

describe('repo-normalize', () => {
  describe('normalizeRepoKey', () => {
    it('normalizes https GitHub URLs', () => {
      expect(normalizeRepoKey('https://github.com/Acme/App.git')).toBe(
        'acme/app',
      );
    });

    it('normalizes ssh URLs', () => {
      expect(normalizeRepoKey('git@github.com:Acme/App.git')).toBe('acme/app');
    });

    it('keeps owner/repo form', () => {
      expect(normalizeRepoKey('Acme/App')).toBe('acme/app');
    });

    it('handles GitLab subgroups', () => {
      expect(
        normalizeRepoKey('https://gitlab.com/group/sub/project.git'),
      ).toBe('group/sub/project');
    });

    it('returns null for empty', () => {
      expect(normalizeRepoKey('')).toBeNull();
    });
  });

  describe('parseRepoAllowlist', () => {
    it('returns empty for blank input', () => {
      expect(parseRepoAllowlist('')).toEqual([]);
      expect(parseRepoAllowlist('  , , ')).toEqual([]);
    });

    it('parses and normalizes keys', () => {
      expect(parseRepoAllowlist('other/x, Acme/App')).toEqual([
        'other/x',
        'acme/app',
      ]);
    });
  });

  describe('repoAllowed', () => {
    it('denies all when allowlist empty', () => {
      expect(repoAllowed('acme/app', '')).toBe(false);
    });

    it('matches allowlist entries', () => {
      expect(repoAllowed('acme/app', 'other/x, Acme/App')).toBe(true);
      expect(repoAllowed('acme/nope', 'acme/app')).toBe(false);
    });
  });

  describe('branchSlug', () => {
    it('slugifies branch names', () => {
      expect(branchSlug('feature/Login')).toBe('feature-login');
    });
  });
});
