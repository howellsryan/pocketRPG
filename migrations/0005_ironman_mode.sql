-- Add Ironman mode support
ALTER TABLE characters ADD COLUMN is_ironman BOOLEAN NOT NULL DEFAULT 0;
