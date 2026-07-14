-- YouTube video import: a new job type plus a per-purpose AI profile so the
-- household can point video extraction at a video-capable hosted model
-- (e.g. Gemini via OpenRouter) without changing the everyday endpoint.

-- 1) jobs.type gains 'video_import'. SQLite can't alter a CHECK constraint,
--    so rebuild the table (same approach as migration 004), keeping the
--    recipe_id column added in migration 007.
CREATE TABLE jobs_new (
    id         INTEGER PRIMARY KEY,
    type       TEXT NOT NULL CHECK (type IN (
                   'photo_import', 'categorise', 'url_redraft',
                   'name_note_cleanup', 'video_import', 'test')),
    status     TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'running', 'done', 'failed')),
    payload    TEXT NOT NULL DEFAULT '{}',  -- JSON
    result     TEXT,                        -- JSON
    error      TEXT,
    attempts   INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    recipe_id  INTEGER REFERENCES recipes(id) ON DELETE SET NULL
);

INSERT INTO jobs_new (id, type, status, payload, result, error, attempts,
                      created_at, updated_at, recipe_id)
    SELECT id, type, status, payload, result, error, attempts,
           created_at, updated_at, recipe_id
    FROM jobs;
DROP TABLE jobs;
ALTER TABLE jobs_new RENAME TO jobs;

-- The worker polls for pending work constantly; keep that query cheap.
CREATE INDEX idx_jobs_status ON jobs(status);

-- 2) ai_profiles.purpose: 'general' profiles serve the normal worker flow
--    (categorise, photo import, redraft); a 'video' profile is used only by
--    video_import jobs.
ALTER TABLE ai_profiles ADD COLUMN purpose TEXT NOT NULL DEFAULT 'general'
    CHECK (purpose IN ('general', 'video'));
