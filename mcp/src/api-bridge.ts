// Bridges an MCP tool call to an existing PocketRPG Pages Function handler.
//
// Rather than re-implement game logic, each tool builds a synthetic, properly
// authenticated Request and invokes the SAME handler the production /api/*
// route uses, against the SAME D1 binding. The handler runs its real auth,
// ownership checks, PvP locks, save-revision bookkeeping and audit logging.
// This keeps the MCP server a thin protocol/auth shim with zero logic drift.

import { signJWT } from "../../functions/_lib/jwt.js";
import type { Env, Identity } from "./types";

// Pages Function handlers are `({ request, env, waitUntil }) => Response`.
type PagesHandler = (context: {
  request: Request;
  env: Env;
  waitUntil: (p: Promise<unknown>) => void;
}) => Promise<Response> | Response;

// Synthetic origin — handlers only read path/query/headers, never the host.
const SYNTHETIC_ORIGIN = "https://mcp.pocketrpg.internal";

// Short TTL: the token only needs to survive a single in-process handler call.
const TOKEN_TTL_SECONDS = 120;

export interface CallOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  /** Authenticated identity. Omit for public endpoints (e.g. leaderboard). */
  identity?: Identity;
  /** Sent as the `X-Character-Id` header. */
  characterId?: number | string;
  /** JSON request body (POST/PUT). */
  body?: unknown;
  /** Query-string params. */
  query?: Record<string, string | number | undefined>;
  /** Path appended to the synthetic origin (purely cosmetic for logging). */
  path?: string;
}

export interface CallResult<T = any> {
  status: number;
  ok: boolean;
  data: T;
}

export async function callHandler<T = any>(
  handler: PagesHandler,
  env: Env,
  opts: CallOptions = {},
): Promise<CallResult<T>> {
  const { method = "GET", identity, characterId, body, query, path = "/api" } = opts;

  const url = new URL(SYNTHETIC_ORIGIN + path);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }

  const headers = new Headers({ "Content-Type": "application/json" });
  if (identity) {
    const token = await signJWT(
      { sub: identity.id, provider: identity.provider, displayName: identity.displayName },
      env.JWT_SECRET,
      TOKEN_TTL_SECONDS,
    );
    headers.set("Authorization", `Bearer ${token}`);
  }
  if (characterId !== undefined && characterId !== null) {
    headers.set("X-Character-Id", String(characterId));
  }

  const init: RequestInit = { method, headers };
  if (body !== undefined && method !== "GET") init.body = JSON.stringify(body);

  const request = new Request(url.toString(), init);
  const res = await handler({ request, env, waitUntil: () => {} });

  let data: any = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, ok: res.ok, data };
}
