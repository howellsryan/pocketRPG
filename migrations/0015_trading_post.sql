-- Trading post: OSRS Grand Exchange-style order book for player-to-player
-- trading of restricted items (boss/raid uniques, clue rewards). General store
-- items still transact immediately via /api/purchase and do not appear here.
--
-- A single offers table holds buy and sell orders, plus orphan "house" stock.
-- Orphan stock rows have character_id = NULL and represent items previously
-- listed and then instant-sold (player got 80%, item stays for resale).
-- Per CLAUDE.md §14, the server is authoritative for all stock and matching.

CREATE TABLE IF NOT EXISTS trading_post_offers (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  character_id      INTEGER REFERENCES characters(id),
  offer_type        TEXT NOT NULL CHECK (offer_type IN ('buy', 'sell')),
  item_id           TEXT NOT NULL,
  price             INTEGER NOT NULL CHECK (price > 0),
  quantity_total    INTEGER NOT NULL CHECK (quantity_total > 0),
  quantity_remaining INTEGER NOT NULL CHECK (quantity_remaining >= 0),
  coins_pending     INTEGER NOT NULL DEFAULT 0,
  items_pending     INTEGER NOT NULL DEFAULT 0,
  status            TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'completed', 'cancelled')),
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tp_offers_owner_active
  ON trading_post_offers(character_id, status);

-- Market lookup: find matching sell offers (lowest price first) or buy offers
-- (highest price first) for an item. Status filters out cancelled/completed.
CREATE INDEX IF NOT EXISTS idx_tp_offers_market
  ON trading_post_offers(item_id, offer_type, status, price, created_at);
