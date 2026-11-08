ALTER TABLE runs ADD COLUMN progress jsonb;
ALTER TABLE runs ADD COLUMN progress_seq integer NOT NULL DEFAULT 0;
