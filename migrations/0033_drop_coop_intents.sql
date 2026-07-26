-- coop_intents is dead. Migration 0031 queued member actions in D1 because the
-- fight was advanced by whichever member polled first; the CoopBossRoom Durable
-- Object now holds pending intents in memory and applies them on its own tick,
-- so nothing has written this table since. The only statement still touching it
-- was the retention DELETE, which ran on every /api/coop/bosses request.

DROP INDEX IF EXISTS idx_coop_intents_pending;
DROP TABLE IF EXISTS coop_intents;
