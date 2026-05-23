-- Stripe webhook idempotency + purchase ledger. Required by §14 and
-- the production-readiness audit (2026-05-21).
--
-- stripe_events: insert-or-ignore on every incoming webhook so retries
--   from Stripe (timeout / 5xx) never re-apply the same grant.
-- purchase_grants: durable per-transaction ledger so support can answer
--   "did this user get the credits they paid for" without log diving.

CREATE TABLE IF NOT EXISTS stripe_events (
  event_id     TEXT PRIMARY KEY,
  event_type   TEXT NOT NULL,
  livemode     INTEGER NOT NULL,
  received_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS purchase_grants (
  event_id                  TEXT PRIMARY KEY,
  identity_id               INTEGER NOT NULL,
  character_id              INTEGER,
  type                      TEXT NOT NULL,
  amount                    INTEGER NOT NULL, 
  amount_total              INTEGER NOT NULL,
  currency                  TEXT NOT NULL,
  stripe_session_id         TEXT NOT NULL,
  stripe_payment_intent_id  TEXT,
  livemode                  INTEGER NOT NULL,
  created_at                INTEGER NOT NULL,
  reversed_at               INTEGER,
  reversal_reason           TEXT,
  disputed_at               INTEGER
);

CREATE INDEX IF NOT EXISTS idx_purchase_grants_identity
  ON purchase_grants(identity_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_purchase_grants_payment_intent
  ON purchase_grants(stripe_payment_intent_id);
