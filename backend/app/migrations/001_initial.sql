-- 001_initial.sql — full v1 schema (spec §4.4) plus sessions and FTS5 search.
-- Applied automatically on first start by app/db.py.

CREATE TABLE users (
    id            INTEGER PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    is_admin      INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Server-side sessions. The cookie holds a random token; we store only its
-- SHA-256 hash so a leaked database doesn't leak usable session tokens.
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
);

CREATE TABLE ingredients (
    id          INTEGER PRIMARY KEY,
    recipe_id   INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    position    INTEGER NOT NULL,
    amount      REAL,               -- nullable: "salt to taste" has no amount
    unit        TEXT,
    name        TEXT NOT NULL,
    category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    scalable    INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_ingredients_recipe ON ingredients(recipe_id);

CREATE TABLE steps (
    id        INTEGER PRIMARY KEY,
    recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    position  INTEGER NOT NULL,
    text      TEXT NOT NULL
);
CREATE INDEX idx_steps_recipe ON steps(recipe_id);

-- Cooking notes: append-style journal on the recipe detail page (spec §3.1.1).
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

-- Walking route: per-store ordering of the category groups (spec §3.5).
CREATE TABLE store_category_order (
    store_id    INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    position    INTEGER NOT NULL,
    PRIMARY KEY (store_id, category_id)
);

-- Shopping list items are COPIES of ingredient data, never live links
-- (spec §3.4, settled decision). recipe_id is only a provenance tag.
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
);

-- Known ingredient names → category, consulted before any AI call
-- (spec §3.6). Names are stored normalised (trimmed, lowercased).
CREATE TABLE ingredient_lookup (
    ingredient_name TEXT PRIMARY KEY,
    category_id     INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    use_count       INTEGER NOT NULL DEFAULT 0
);

-- Persistent job queue for AI work (spec §5.2). Survives restarts.
CREATE TABLE jobs (
    id         INTEGER PRIMARY KEY,
    type       TEXT NOT NULL CHECK (type IN ('photo_import', 'categorise')),
    status     TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'running', 'done', 'failed')),
    payload    TEXT NOT NULL DEFAULT '{}',  -- JSON
    result     TEXT,                        -- JSON
    error      TEXT,
    attempts   INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- AI endpoint profiles (spec §5.1). API keys stay server-side only.
CREATE TABLE ai_profiles (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL UNIQUE,
    base_url   TEXT NOT NULL,
    api_key    TEXT NOT NULL DEFAULT '',
    model      TEXT NOT NULL,
    is_default INTEGER NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------------------
-- Full-text search (spec §3.1: title/description/ingredients; §3.1.1: notes).
-- External-content FTS5 tables kept in sync by triggers, so the source of
-- truth stays in the normal tables.
-- ---------------------------------------------------------------------------

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
