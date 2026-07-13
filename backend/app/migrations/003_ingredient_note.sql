-- Name/note split (spec §3.2): `name` holds only the shoppable item;
-- preparation, size, and qualifiers ("finely diced", "small", "optional")
-- move to a nullable `note`. Shopping items copy the note for completeness
-- (§4.4), though the list UI de-emphasises it.
ALTER TABLE ingredients ADD COLUMN note TEXT;
ALTER TABLE shopping_items ADD COLUMN note TEXT;
