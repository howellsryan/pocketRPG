-- Add remove_ads flag to oauth_identities
-- One payment removes ads for the identity and all characters under it
ALTER TABLE oauth_identities ADD COLUMN remove_ads INTEGER NOT NULL DEFAULT 0;

-- Add credits balance to characters
-- Per-character credit balance for upcoming features
ALTER TABLE characters ADD COLUMN credits INTEGER NOT NULL DEFAULT 10;
