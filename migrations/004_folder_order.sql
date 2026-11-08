ALTER TABLE folders ADD COLUMN position integer NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS folders_parent_position_idx ON folders(parent_id, position);
