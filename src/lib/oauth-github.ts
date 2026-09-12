/**
 * GitHub OAuth helpers: authorize URL, code→token exchange, and the user/email
 * fetches. Optional at runtime — the login page hides GitHub when unconfigured.
 */
import type { Env } from '../types';

const AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const TOKEN_URL = 'https://github.com/login/oauth/access_token';
const API = 'https://api.github.com';

const SCOPES = 'read:user user:email';

export interface GithubUser {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string | null;
  email: string | null;
}

export function githubConfigured(env: Env): boolean {
  return Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET);
}

export function githubAuthorizeUrl(env: Env, state: string, redirectUri: string): string {
  const params = new URLSearchParams({
    client_id: env.GITHUB_CLIENT_ID ?? '',
    redirect_uri: redirectUri,
    scope: SCOPES,
    state,
    allow_signup: 'true',
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

export async function exchangeGithubCode(
  env: Env,
  code: string,
  redirectUri: string,
): Promise<string> {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: redirectUri,
    }),
  });

  if (!response.ok) {
    throw new Error(`GitHub token exchange failed: ${response.status}`);
  }

  const data = (await response.json()) as { access_token?: string; error?: string };
  if (!data.access_token) {
    throw new Error(`GitHub token exchange error: ${data.error ?? 'no access_token'}`);
  }
  return data.access_token;
}

function githubHeaders(accessToken: string): HeadersInit {
  return {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'earthol-player-profile',
  };
}

export async function fetchGithubUser(accessToken: string): Promise<GithubUser> {
  const response = await fetch(`${API}/user`, { headers: githubHeaders(accessToken) });
  if (!response.ok) throw new Error(`GitHub /user failed: ${response.status}`);
  return (await response.json()) as GithubUser;
}

export async function fetchGithubPrimaryEmail(accessToken: string): Promise<string | null> {
  const response = await fetch(`${API}/user/emails`, { headers: githubHeaders(accessToken) });
  if (!response.ok) return null;

  const emails = (await response.json()) as Array<{
    email: string;
    primary: boolean;
    verified: boolean;
  }>;
  const primary = emails.find((entry) => entry.primary && entry.verified);
  return primary?.email ?? emails.find((entry) => entry.verified)?.email ?? null;
}
