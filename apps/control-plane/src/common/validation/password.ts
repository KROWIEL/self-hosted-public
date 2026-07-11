/**
 * Shared password policy. Keep in sync with the web app's `lib/password.ts`.
 * A strong password must be at least 12 characters and contain an uppercase
 * letter, a lowercase letter, a special character and at least 3 digits.
 */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MIN_DIGITS = 3;

export function isStrongPassword(pw: unknown): boolean {
  if (typeof pw !== 'string' || pw.length < PASSWORD_MIN_LENGTH) return false;
  // Unicode-aware: non-Latin letters (e.g. Cyrillic) count as lower/upper
  // rather than as "special" characters.
  if (!/\p{Ll}/u.test(pw)) return false;
  if (!/\p{Lu}/u.test(pw)) return false;
  // Special = anything that is not a letter, a number or whitespace.
  if (!/[^\p{L}\p{N}\s]/u.test(pw)) return false;
  const digits = (pw.match(/\d/g) ?? []).length;
  return digits >= PASSWORD_MIN_DIGITS;
}
