-- Stage 3.5 (spec §4.4, §5.5): retain the readable text of a URL-imported
-- recipe's source page so the AI redraft job can re-read it later.
-- NULL for manual and photo recipes.
ALTER TABLE recipes ADD COLUMN source_page_text TEXT;
