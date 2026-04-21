-- Add One Life mode support
ALTER TABLE characters ADD COLUMN is_one_life BOOLEAN NOT NULL DEFAULT 0;
