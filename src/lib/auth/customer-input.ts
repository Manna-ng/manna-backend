export const EMAIL_PATTERN =
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeName(
  value: unknown
) {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 120);
}

export function normalizeEmail(
  value: unknown
) {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .trim()
    .toLowerCase()
    .slice(0, 254);
}

export function normalizePhone(
  value: unknown
): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const raw = value.trim();

  const digits =
    raw.replace(/\D/g, "");

  if (!digits) {
    return null;
  }

  // 08012345678
  if (
    digits.length === 11 &&
    digits.startsWith("0")
  ) {
    return `+234${digits.slice(1)}`;
  }

  // 2348012345678
  if (
    digits.length === 13 &&
    digits.startsWith("234")
  ) {
    return `+${digits}`;
  }

  // 8012345678
  if (digits.length === 10) {
    return `+234${digits}`;
  }

  // Generic international fallback.
  if (
    raw.startsWith("+") &&
    digits.length >= 10 &&
    digits.length <= 15
  ) {
    return `+${digits}`;
  }

  return null;
}

export function validatePassword(
  password: unknown
): string | null {
  if (typeof password !== "string") {
    return "Password is required";
  }

  if (password.length < 8) {
    return "Password must be at least 8 characters";
  }

  if (password.length > 128) {
    return "Password is too long";
  }

  if (
    !/[A-Za-z]/.test(password) ||
    !/\d/.test(password)
  ) {
    return "Password must contain at least one letter and one number";
  }

  return null;
}