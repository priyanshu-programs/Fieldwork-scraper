CREATE TABLE IF NOT EXISTS runs (
 id uuid PRIMARY KEY, title text NOT NULL, description text NOT NULL DEFAULT '',
 urls jsonb NOT NULL, mode text NOT NULL CHECK(mode IN ('pages','crawl')),
 fetch_mode text NOT NULL CHECK(fetch_mode IN ('http','browser')),
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','completed','partial','failed','interrupted')),
 retry_of uuid REFERENCES runs(id), created_at timestamptz NOT NULL DEFAULT now(),
 started_at timestamptz, finished_at timestamptz, lease_token uuid, lease_until timestamptz,
 error text, byte_count integer NOT NULL DEFAULT 0 CHECK(byte_count >= 0)
);
CREATE TABLE IF NOT EXISTS pages (
 id uuid PRIMARY KEY, run_id uuid NOT NULL REFERENCES runs(id),
 url text NOT NULL, final_url text, parent_url text, title text NOT NULL DEFAULT '',
 status text NOT NULL CHECK(status IN ('success','failed','blocked','unsupported','limit')),
 error text, markdown text NOT NULL DEFAULT '', collected_at timestamptz NOT NULL,
 UNIQUE(run_id,url), CHECK(octet_length(markdown) <= 500000)
);
CREATE TABLE IF NOT EXISTS worker_state (
 id integer PRIMARY KEY CHECK(id=1), last_seen timestamptz, active_run uuid REFERENCES runs(id)
);
INSERT INTO worker_state(id) VALUES(1) ON CONFLICT DO NOTHING;
CREATE INDEX IF NOT EXISTS runs_created_idx ON runs(created_at DESC);
CREATE INDEX IF NOT EXISTS pages_run_idx ON pages(run_id);
