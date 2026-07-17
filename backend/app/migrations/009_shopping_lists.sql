-- Multiple named shopping lists. One is the default: recipe sends and
-- unqualified manual adds land there. Deleting a list moves its items to the
-- default (app-level, in shopping.py); the FK's ON DELETE SET NULL is only a
-- safety net, and a NULL list_id is always read as "the default list" because
-- ALTER TABLE can't add a NOT NULL column to existing rows.
CREATE TABLE shopping_lists (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL UNIQUE,
    is_default INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Exactly one default list, enforced by a partial unique index.
CREATE UNIQUE INDEX shopping_lists_one_default ON shopping_lists(is_default) WHERE is_default = 1;

INSERT INTO shopping_lists (name, is_default) VALUES ('Shopping list', 1);

ALTER TABLE shopping_items ADD COLUMN list_id INTEGER REFERENCES shopping_lists(id) ON DELETE SET NULL;

UPDATE shopping_items SET list_id = (SELECT id FROM shopping_lists WHERE is_default = 1);
