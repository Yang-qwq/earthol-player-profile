/**
 * Admin capability model. A user is an admin when flagged in the database
 * (`users.is_admin`) or when their email appears in the `ADMIN_EMAILS`
 * bootstrap env. `createUser` also auto-flags the very first registered user,
 * so an admin exists without any seeding or env setup.
 */
import type { Env } from '../types';
import type { UserRow } from '../db/types';
import { setUserAdmin } from '../db/queries';

export function envAdminEmails(env: Env): string[] {
  return (env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export function isEnvAdmin(env: Env, email: string | null | undefined): boolean {
  if (!email) return false;
  return envAdminEmails(env).includes(email.toLowerCase());
}

/**
 * A user is an admin when flagged in the database or when their email is listed
 * in the ADMIN_EMAILS bootstrap env. Env-matched users are promoted lazily.
 */
export async function isAdminUser(
  db: D1Database,
  user: UserRow,
  env: Env,
): Promise<boolean> {
  if (user.is_admin === 1) return true;
  if (isEnvAdmin(env, user.email)) {
    await setUserAdmin(db, user.id, true);
    return true;
  }
  return false;
}
