-- Remove legacy base64 and hash columns now that all characters are migrated to save_data.
ALTER TABLE saves DROP COLUMN base64;
ALTER TABLE saves DROP COLUMN hash;
