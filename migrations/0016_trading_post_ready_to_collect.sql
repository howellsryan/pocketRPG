CREATE TABLE trading_post_offers_new (
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
                    CHECK (status IN ('active', 'ready_to_collect')),
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);

INSERT INTO trading_post_offers_new
  SELECT id, character_id, offer_type, item_id, price, quantity_total, quantity_remaining,
         coins_pending, items_pending,
         CASE WHEN status IN ('active', 'ready_to_collect') THEN status ELSE 'active' END,
         created_at, updated_at
  FROM trading_post_offers
  WHERE status IN ('active', 'ready_to_collect');

DROP TABLE trading_post_offers;
ALTER TABLE trading_post_offers_new RENAME TO trading_post_offers;

CREATE INDEX IF NOT EXISTS idx_tp_offers_owner_active
  ON trading_post_offers(character_id, status);

CREATE INDEX IF NOT EXISTS idx_tp_offers_market
  ON trading_post_offers(item_id, offer_type, status, price, created_at);
