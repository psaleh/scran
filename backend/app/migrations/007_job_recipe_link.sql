-- Links a job to whichever recipe it produced/updated (issue: import inbox
-- should show a url_redraft/photo_import job as Done once the resulting
-- draft has actually been published, not just once the AI finished).
-- Nullable: most job types (categorise, test) never set this, and a
-- fallback-extraction redraft doesn't know its recipe until the user saves.
ALTER TABLE jobs ADD COLUMN recipe_id INTEGER REFERENCES recipes(id) ON DELETE SET NULL;
