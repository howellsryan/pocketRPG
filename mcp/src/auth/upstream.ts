// Upstream OAuth helpers. These mirror the main app's GitHub/Google callbacks
// (functions/api/auth/{github,google}/callback.js) and upsert into the SAME
// oauth_identities table on the shared D1 binding.
//
// Identity is keyed on (provider, provider_user_id). provider_user_id is the
// provider's stable account id (GitHub numeric id / Google `sub`), which does
// NOT change between OAuth apps — so even if the MCP server uses a *dedicated*
// OAuth app (different client id/secret) it resolves to the same PocketRPG
// account the website created.

import type { Env } from "../types";

export interface UpstreamUser {
  providerUserId: string;
  displayName: string;
  email: string | null;
}

export function githubAuthorizeUrl(env: Env, redirectUri: string, state: string): string {
  const p = new URLSearchParams({
    client_id: env.GITHUB_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: "read:user",
    state,
    allow_signup: "true",
  });
  return `https://github.com/login/oauth/authorize?${p}`;
}

export async function githubExchange(env: Env, code: string, redirectUri: string): Promise<UpstreamUser> {
  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: redirectUri,
    }),
  });
  const tokenJson: any = await tokenRes.json();
  if (!tokenJson.access_token) throw new Error(`github_token_exchange_failed: ${tokenJson.error || "unknown"}`);

  const userRes = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${tokenJson.access_token}`,
      "User-Agent": "PocketRPG-MCP",
      Accept: "application/vnd.github+json",
    },
  });
  if (!userRes.ok) throw new Error("github_user_fetch_failed");
  const u: any = await userRes.json();
  return {
    providerUserId: String(u.id),
    displayName: u.name || u.login || `gh_${u.id}`,
    email: u.email || null,
  };
}

export function googleAuthorizeUrl(env: Env, redirectUri: string, state: string): string {
  const p = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    access_type: "online",
    prompt: "select_account",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

export async function googleExchange(env: Env, code: string, redirectUri: string): Promise<UpstreamUser> {
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      code,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const tokenJson: any = await tokenRes.json();
  if (!tokenJson.access_token) throw new Error(`google_token_exchange_failed: ${tokenJson.error || "unknown"}`);

  const userRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${tokenJson.access_token}` },
  });
  if (!userRes.ok) throw new Error("google_user_fetch_failed");
  const u: any = await userRes.json();
  return {
    providerUserId: String(u.sub),
    displayName: u.name || u.email || `google_${u.sub}`,
    email: u.email || null,
  };
}

// Upsert into the shared oauth_identities table; returns the identity id.
export async function upsertIdentity(
  env: Env,
  provider: "github" | "google",
  user: UpstreamUser,
): Promise<number> {
  const existing = await env.DB.prepare(
    "SELECT id FROM oauth_identities WHERE provider = ? AND provider_user_id = ?",
  )
    .bind(provider, user.providerUserId)
    .first<{ id: number }>();

  if (existing) {
    await env.DB.prepare("UPDATE oauth_identities SET display_name = ?, email = ? WHERE id = ?")
      .bind(user.displayName, user.email, existing.id)
      .run();
    return existing.id;
  }

  const insert = await env.DB.prepare(
    "INSERT INTO oauth_identities (provider, provider_user_id, email, display_name, created_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(provider, user.providerUserId, user.email, user.displayName, Date.now())
    .run();
  return insert.meta.last_row_id as number;
}
