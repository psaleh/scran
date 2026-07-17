-- Baseline schema (squashed from the original migrations 001-009 at
-- v0.2.13). Fresh installs apply just this file; databases created before
-- the squash already have "001_initial.sql" recorded in schema_migrations
-- and skip it (db.py refuses to start on a partially-migrated pre-squash
-- database - see run_migrations).

CREATE TABLE users (
    id            INTEGER PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    is_admin      INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL
);

CREATE TABLE categories (
    id   INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE
);

CREATE TABLE recipes (
    id          INTEGER PRIMARY KEY,
    title       TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    servings    INTEGER,
    -- Tags stored as a JSON array of strings, e.g. '["curry","weeknight"]'.
    -- Simple by design (spec §4.4); a join table is a later option.
    tags        TEXT NOT NULL DEFAULT '[]',
    photo_path  TEXT,
    source_url  TEXT,
    status      TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
    created_by  INTEGER REFERENCES users(id),
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
, version_group INTEGER, version_label TEXT, source_page_text TEXT);

CREATE TABLE ingredients (
    id          INTEGER PRIMARY KEY,
    recipe_id   INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    position    INTEGER NOT NULL,
    amount      REAL,               -- nullable: "salt to taste" has no amount
    unit        TEXT,
    name        TEXT NOT NULL,
    category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    scalable    INTEGER NOT NULL DEFAULT 1
, note TEXT, section TEXT);

CREATE INDEX idx_ingredients_recipe ON ingredients(recipe_id);

CREATE TABLE steps (
    id        INTEGER PRIMARY KEY,
    recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    position  INTEGER NOT NULL,
    text      TEXT NOT NULL
);

CREATE INDEX idx_steps_recipe ON steps(recipe_id);

CREATE TABLE recipe_notes (
    id         INTEGER PRIMARY KEY,
    recipe_id  INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id),
    text       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_recipe_notes_recipe ON recipe_notes(recipe_id);

CREATE TABLE stores (
    id   INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE
);

CREATE TABLE store_category_order (
    store_id    INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    position    INTEGER NOT NULL,
    PRIMARY KEY (store_id, category_id)
);

CREATE TABLE shopping_items (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL,
    amount      REAL,
    unit        TEXT,
    category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    recipe_id   INTEGER REFERENCES recipes(id) ON DELETE SET NULL,
    checked     INTEGER NOT NULL DEFAULT 0,
    added_by    INTEGER REFERENCES users(id),
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
, note TEXT, list_id INTEGER REFERENCES shopping_lists(id) ON DELETE SET NULL);

CREATE TABLE ingredient_lookup (
    ingredient_name TEXT PRIMARY KEY,
    category_id     INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    use_count       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE ai_profiles (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL UNIQUE,
    base_url   TEXT NOT NULL,
    api_key    TEXT NOT NULL DEFAULT '',
    model      TEXT NOT NULL,
    is_default INTEGER NOT NULL DEFAULT 0
, purpose TEXT NOT NULL DEFAULT 'general'
    CHECK (purpose IN ('general', 'video')));

CREATE VIRTUAL TABLE recipes_fts USING fts5(
    title, description,
    content='recipes', content_rowid='id'
);

CREATE TRIGGER recipes_ai AFTER INSERT ON recipes BEGIN
    INSERT INTO recipes_fts(rowid, title, description)
    VALUES (new.id, new.title, new.description);
END;

CREATE TRIGGER recipes_ad AFTER DELETE ON recipes BEGIN
    INSERT INTO recipes_fts(recipes_fts, rowid, title, description)
    VALUES ('delete', old.id, old.title, old.description);
END;

CREATE TRIGGER recipes_au AFTER UPDATE ON recipes BEGIN
    INSERT INTO recipes_fts(recipes_fts, rowid, title, description)
    VALUES ('delete', old.id, old.title, old.description);
    INSERT INTO recipes_fts(rowid, title, description)
    VALUES (new.id, new.title, new.description);
END;

CREATE VIRTUAL TABLE ingredients_fts USING fts5(
    name,
    content='ingredients', content_rowid='id'
);

CREATE TRIGGER ingredients_ai AFTER INSERT ON ingredients BEGIN
    INSERT INTO ingredients_fts(rowid, name) VALUES (new.id, new.name);
END;

CREATE TRIGGER ingredients_ad AFTER DELETE ON ingredients BEGIN
    INSERT INTO ingredients_fts(ingredients_fts, rowid, name)
    VALUES ('delete', old.id, old.name);
END;

CREATE TRIGGER ingredients_au AFTER UPDATE ON ingredients BEGIN
    INSERT INTO ingredients_fts(ingredients_fts, rowid, name)
    VALUES ('delete', old.id, old.name);
    INSERT INTO ingredients_fts(rowid, name) VALUES (new.id, new.name);
END;

CREATE VIRTUAL TABLE recipe_notes_fts USING fts5(
    text,
    content='recipe_notes', content_rowid='id'
);

CREATE TRIGGER recipe_notes_ai AFTER INSERT ON recipe_notes BEGIN
    INSERT INTO recipe_notes_fts(rowid, text) VALUES (new.id, new.text);
END;

CREATE TRIGGER recipe_notes_ad AFTER DELETE ON recipe_notes BEGIN
    INSERT INTO recipe_notes_fts(recipe_notes_fts, rowid, text)
    VALUES ('delete', old.id, old.text);
END;

CREATE TRIGGER recipe_notes_au AFTER UPDATE ON recipe_notes BEGIN
    INSERT INTO recipe_notes_fts(recipe_notes_fts, rowid, text)
    VALUES ('delete', old.id, old.text);
    INSERT INTO recipe_notes_fts(rowid, text) VALUES (new.id, new.text);
END;

CREATE INDEX idx_recipes_version_group ON recipes(version_group);

CREATE TABLE "jobs" (
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

CREATE INDEX idx_jobs_status ON jobs(status);

CREATE TABLE shopping_lists (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL UNIQUE,
    is_default INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX shopping_lists_one_default ON shopping_lists(is_default) WHERE is_default = 1;

-- Seed the default grocery categories (spec §3.5).
INSERT INTO categories (name) VALUES
    ('produce'),
    ('meat & fish'),
    ('dairy & eggs'),
    ('bakery'),
    ('tinned & jarred'),
    ('dry goods & pasta'),
    ('frozen'),
    ('drinks'),
    ('snacks'),
    ('condiments & spices'),
    ('household'),
    ('other');

-- The one default shopping list (recipe sends and unqualified manual adds
-- land here; extra named lists are user-created in Settings).
INSERT INTO shopping_lists (name, is_default) VALUES ('Shopping list', 1);
