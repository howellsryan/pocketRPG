// OAuth "default handler" for the MCP server.
//
// workers-oauth-provider owns /token, /register and the token store; it hands
// the user-facing /authorize step to this Hono app. We authenticate the user
// against the existing PocketRPG GitHub/Google OAuth, upsert their identity in
// the shared D1, then call completeAuthorization() to mint the MCP grant. The
// resulting MCP session carries { identityId, provider, displayName } as props.

import { Hono } from "hono";
import type { Env, AuthRequest } from "../types";
import {
  githubAuthorizeUrl,
  githubExchange,
  googleAuthorizeUrl,
  googleExchange,
  upsertIdentity,
} from "./upstream";

const app = new Hono<{ Bindings: Env }>();

// --- tiny base64url + cookie helpers ---------------------------------------

function b64urlEncode(str: string): string {
  return btoa(unescape(encodeURIComponent(str))).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function b64urlDecode(str: string): string {
  let s = str.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return decodeURIComponent(escape(atob(s)));
}
function parseCookies(header: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

const STATE_COOKIE = "mcp_oauth_state";
const clearStateCookie = `${STATE_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;

function providerChooser(stateBlob: string): string {
  const s = encodeURIComponent(stateBlob);
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Connect to PocketRPG</title>
<style>
  body{font-family:system-ui,sans-serif;background:#0f1117;color:#e8e8ea;display:grid;place-items:center;min-height:100vh;margin:0}
  .card{background:#171a23;border:1px solid #262b38;border-radius:16px;padding:32px;max-width:360px;width:90%}
  h1{font-size:20px;margin:0 0 8px} p{color:#9aa0ac;font-size:14px;margin:0 0 24px}
  a{display:block;text-align:center;padding:12px 16px;border-radius:10px;text-decoration:none;font-weight:600;margin-bottom:12px}
  .gh{background:#24292f;color:#fff} .gg{background:#fff;color:#1f1f1f}
</style></head>
<body><div class="card">
  <h1>Connect to PocketRPG</h1>
  <p>Sign in to authorise this app to act on your PocketRPG account.</p>
  <a class="gh" href="/login/github?s=${s}">Continue with GitHub</a>
  <a class="gg" href="/login/google?s=${s}">Continue with Google</a>
</div></body></html>`;
}

// --- routes ----------------------------------------------------------------

app.get("/", (c) =>
  c.text(
    "PocketRPG MCP server. Connect an MCP client to /mcp (Streamable HTTP) or /sse. OAuth lives at /authorize.",
  ),
);

app.get("/authorize", async (c) => {
  const oauthReqInfo = await c.env.OAUTH_PROVIDER.parseAuthRequest(c.req.raw);
  if (!oauthReqInfo?.clientId) return c.text("Invalid authorization request", 400);
  // Carry the full MCP auth request across the upstream round-trip.
  const stateBlob = b64urlEncode(JSON.stringify(oauthReqInfo));
  return c.html(providerChooser(stateBlob));
});

app.get("/login/:provider", (c) => {
  const provider = c.req.param("provider");
  if (provider !== "github" && provider !== "google") return c.text("Unknown provider", 404);
  const stateBlob = c.req.query("s") || "";

  const origin = new URL(c.req.url).origin;
  const redirectUri = `${origin}/callback/${provider}`;
  // CSRF nonce prefixes the carried MCP request; verified via the cookie below.
  const csrf = crypto.randomUUID().replace(/-/g, "");
  const state = `${csrf}.${stateBlob}`;

  const url =
    provider === "github"
      ? githubAuthorizeUrl(c.env, redirectUri, state)
      : googleAuthorizeUrl(c.env, redirectUri, state);

  c.header("Set-Cookie", `${STATE_COOKIE}=${state}; Path=/; Max-Age=600; HttpOnly; Secure; SameSite=Lax`);
  return c.redirect(url, 302);
});

app.get("/callback/:provider", async (c) => {
  const provider = c.req.param("provider");
  if (provider !== "github" && provider !== "google") return c.text("Unknown provider", 404);

  const code = c.req.query("code");
  const state = c.req.query("state");
  if (!code || !state) return c.text("Missing code or state", 400);

  const cookie = parseCookies(c.req.header("Cookie"))[STATE_COOKIE];
  if (!cookie || cookie !== state) return c.text("State mismatch — possible CSRF", 400);

  // Strip the CSRF nonce prefix and decode the original MCP auth request.
  const stateBlob = state.slice(state.indexOf(".") + 1);
  let oauthReqInfo: AuthRequest;
  try {
    oauthReqInfo = JSON.parse(b64urlDecode(stateBlob));
  } catch {
    return c.text("Corrupt state", 400);
  }

  const origin = new URL(c.req.url).origin;
  const redirectUri = `${origin}/callback/${provider}`;

  let identityId: number;
  let displayName: string;
  try {
    const user =
      provider === "github"
        ? await githubExchange(c.env, code, redirectUri)
        : await googleExchange(c.env, code, redirectUri);
    displayName = user.displayName;
    identityId = await upsertIdentity(c.env, provider, user);
  } catch (err: any) {
    return c.text(`Sign-in failed: ${err?.message || err}`, 401);
  }

  const { redirectTo } = await c.env.OAUTH_PROVIDER.completeAuthorization({
    request: oauthReqInfo,
    userId: String(identityId),
    scope: oauthReqInfo.scope,
    metadata: { label: displayName },
    props: { identityId, provider, displayName },
  });

  c.header("Set-Cookie", clearStateCookie);
  return c.redirect(redirectTo, 302);
});

export { app as AuthHandler };
