-- Action-completion nonces. Pre-step-6 these lived inside the save blob
-- as saveObject._serverActionNonces, which made replay defence dependent
-- on the save being trusted. Moving them to their own table means a
-- nonce, once consumed, stays consumed across save edits, rollbacks, or
-- any future migration that touches the blob.

CREATE TABLE IF NOT EXISTS action_nonces (
  character_id  INTEGER NOT NULL,
  nonce         TEXT    NOT NULL,
  used_at       INTEGER NOT NULL,
  PRIMARY KEY (character_id, nonce)
);

-- Retention sweeper key. We trim old nonces (>30 days) periodically to
-- keep the table bounded; any replay that old would also fail the
-- save_revision check.
CREATE INDEX IF NOT EXISTS idx_action_nonces_age
  ON action_nonces(used_at);
