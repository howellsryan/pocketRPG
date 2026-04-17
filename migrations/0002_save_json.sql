-- Migrate cloud saves from base64-encoded blobs to raw JSON strings.
-- The existing base64 column is kept (NOT NULL, cannot be dropped without table rebuild)
-- and becomes a legacy artifact. New saves write to save_data; old rows are served
-- from base64 by the API until the player saves once with the new client code.
ALTER TABLE saves ADD COLUMN save_data TEXT;
