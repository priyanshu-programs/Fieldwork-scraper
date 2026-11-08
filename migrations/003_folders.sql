CREATE TABLE IF NOT EXISTS folders (
 id uuid PRIMARY KEY,
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
 parent_id uuid REFERENCES folders(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS folders_sibling_name ON folders(COALESCE(parent_id,'00000000-0000-0000-0000-000000000000'::uuid), lower(name));
ALTER TABLE runs ADD COLUMN folder_id uuid REFERENCES folders(id);
CREATE INDEX IF NOT EXISTS runs_folder_idx ON runs(folder_id);
