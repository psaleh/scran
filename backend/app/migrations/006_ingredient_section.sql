-- Ingredient list sections (spec issue #1): real recipes sometimes group
-- ingredients under headings ("For the sauce", "For the topping"). Nullable
-- `section` on each ingredient row — null means "no heading", matching the
-- vast majority of recipes so existing rows need no backfill.
ALTER TABLE ingredients ADD COLUMN section TEXT;
