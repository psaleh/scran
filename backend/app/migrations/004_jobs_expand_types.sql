-- Widen the jobs.type CHECK to the full set from spec §4.4, plus a 'test'
-- type used by the temporary dev button that verifies the queue end-to-end.
-- SQLite can't alter a CHECK constraint, so rebuild the table.

CREATE TABLE jobs_new (
    id         INTEGER PRIMARY KEY,
    type       TEXT NOT NULL CHECK (type IN (
                   'photo_import', 'categorise', 'url_redraft',
                   'name_note_cleanup', 'test')),
    status     TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'running', 'done', 'failed')),
    payload    TEXT NOT NULL DEFAULT '{}',  -- JSON
    result     TEXT,                        -- JSON
    error      TEXT,
    attempts   INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO jobs_new SELECT * FROM jobs;
DROP TABLE jobs;
ALTER TABLE jobs_new RENAME TO jobs;

-- The worker polls for pending work constantly; keep that query cheap.
CREATE INDEX idx_jobs_status ON jobs(status);
