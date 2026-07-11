/**
 * Shared password policy. Keep in sync with the control-plane's
 * `common/validation/password.ts`.
 */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MIN_DIGITS = 3;

export type PasswordRuleKey =
  | 'length'
  | 'upper'
  | 'lower'
  | 'digits'
  | 'special';

export function passwordChecks(pw: string): Record<PasswordRuleKey, boolean> {
  return {
    length: pw.length >= PASSWORD_MIN_LENGTH,
    // Unicode-aware so non-Latin letters (e.g. Cyrillic) are classified
    // correctly instead of being treated as "special" characters.
    upper: /\p{Lu}/u.test(pw),
    lower: /\p{Ll}/u.test(pw),
    digits: (pw.match(/\d/g) ?? []).length >= PASSWORD_MIN_DIGITS,
    // A special char = anything that is not a letter, a number or whitespace.
    special: /[^\p{L}\p{N}\s]/u.test(pw),
  };
}

export function isStrongPassword(pw: string): boolean {
  const c = passwordChecks(pw);
  return c.length && c.upper && c.lower && c.digits && c.special;
}

export const PASSWORD_RULE_ORDER: PasswordRuleKey[] = [
  'length',
  'upper',
  'lower',
  'digits',
  'special',
];
