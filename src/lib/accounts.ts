/**
 * Account linking. External identities are matched by provider id first, then
 * by verified email, so one person can sign in with GitHub and a magic link
 * without ending up with two profiles.
 */
import {
  createIdentity,
  createUser,
  findIdentity,
  getUserByEmail,
  getUserById,
} from '../db/queries';
import type { UserRow } from '../db/types';

export interface ResolveAccountParams {
  provider: string;
  providerUserId: string;
  email: string | null;
  allowCreate?: boolean;
  defaults?: { theme?: string; visibility?: string };
}

/**
 * Find the account for an external identity, linking by verified email when
 * possible, and creating a fresh account otherwise. Returns null when the
 * account does not exist and creation is disallowed (sign-ups disabled).
 */
export async function resolveAccount(
  db: D1Database,
  params: ResolveAccountParams,
): Promise<UserRow | null> {
  const identity = await findIdentity(db, params.provider, params.providerUserId);
  if (identity) {
    const user = await getUserById(db, identity.user_id);
    if (!user) throw new Error('resolveAccount: identity points at a missing user');
    return user;
  }

  let user = params.email ? await getUserByEmail(db, params.email) : null;
  if (!user) {
    if (params.allowCreate === false) return null;
    user = await createUser(db, {
      email: params.email,
      theme: params.defaults?.theme,
      visibility: params.defaults?.visibility,
    });
  }

  await createIdentity(db, {
    userId: user.id,
    provider: params.provider,
    providerUserId: params.providerUserId,
    email: params.email,
  });

  return user;
}
