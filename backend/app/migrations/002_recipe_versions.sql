-- 002_recipe_versions.sql — user-triggered "save as new version".
-- Versions are full recipe rows sharing a version_group. Not every edit
-- creates a version; only an explicit "save as new version" action does.
-- Browse shows only the newest recipe per group; the detail page offers a
-- switcher between versions.

ALTER TABLE recipes ADD COLUMN version_group INTEGER;
ALTER TABLE recipes ADD COLUMN version_label TEXT;

-- Every existing recipe becomes its own group of one.
UPDATE recipes SET version_group = id WHERE version_group IS NULL;

CREATE INDEX idx_recipes_version_group ON recipes(version_group);
