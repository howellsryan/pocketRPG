-- Phase 3a storage migration: add gzipped save blob alongside legacy TEXT save_data.
-- Rolling deploy safe: mixed Workers can continue reading/writing save_data while
-- new Workers dual-write save_blob and prefer it on reads.
ALTER TABLE saves ADD COLUMN save_blob BLOB;

