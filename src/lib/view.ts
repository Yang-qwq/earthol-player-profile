/** Shapes a DB user row into the compact object views pass to `Layout`. */
import type { UserRow } from '../db/types';

export function navUser(
  user: UserRow | null | undefined,
): { username: string; displayName: string | null } | null {
  if (!user) return null;
  return { username: user.username ?? '', displayName: user.display_name };
}
