-- OAuth 2.1 Authorization Server state for the MCP connector flow
-- (see functions/api/oauth/** and docs/mcp-server.md).
--
-- PocketRPG acts as its own Authorization Server so MCP clients (ChatGPT, …)
-- can connect via the standard discover → register → authorize → token flow.
-- The access token issued is the same HS256 session JWT used everywhere else,
-- so no token table is needed — only registered clients and one-time codes.

-- Dynamically-registered clients (RFC 7591). Public clients (PKCE, no secret).
CREATE TABLE IF NOT EXISTS oauth_clients (
  client_id     TEXT    PRIMARY KEY,
  client_name   TEXT,
  redirect_uris TEXT    NOT NULL,
  created_at    INTEGER NOT NULL
);

-- Short-lived authorization codes (single-use, PKCE-bound). Consumed at the
-- token endpoint; `consumed` guards against replay even before expiry.
CREATE TABLE IF NOT EXISTS oauth_codes (
  code           TEXT    PRIMARY KEY,
  client_id      TEXT    NOT NULL,
  identity_id    INTEGER NOT NULL,
  redirect_uri   TEXT    NOT NULL,
  code_challenge TEXT    NOT NULL,
  scope          TEXT,
  expires_at     INTEGER NOT NULL,
  consumed       INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL
);

-- Age index so expired codes can be swept (codes live ~60s; this keeps the
-- table bounded).
CREATE INDEX IF NOT EXISTS idx_oauth_codes_age ON oauth_codes(expires_at);
