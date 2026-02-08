export type UserRow = { id: string; email_normalized: string; created_at: Date };

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

