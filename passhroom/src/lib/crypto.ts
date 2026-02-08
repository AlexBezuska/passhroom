import crypto from 'node:crypto';
import { MUSHROOM_COMMON_NAMES } from './mushroomNames';

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function normalizeLoginCode(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\s\t\n\r]+/g, ' ');
}

export function randomMushroomNameCode(): string {
  const idx = crypto.randomInt(0, MUSHROOM_COMMON_NAMES.length);
  return MUSHROOM_COMMON_NAMES[idx] as string;
}

export function sha256Base64Url(input: string): string {
  return crypto.createHash('sha256').update(input, 'utf8').digest('base64url');
}

export function redactEmail(emailNormalized: string): string {
  const [local, domain] = emailNormalized.split('@');
  if (!local || !domain) return '[invalid-email]';
  const safeLocal = local.length <= 2 ? `${local[0] ?? ''}*` : `${local[0]}***${local.at(-1)}`;
  return `${safeLocal}@${domain}`;
}
