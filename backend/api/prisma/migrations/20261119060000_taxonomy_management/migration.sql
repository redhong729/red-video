ALTER TABLE "categories" ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "tags" ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;

-- Names are unique within a type and locale, ignoring surrounding spaces and ASCII letter case.
CREATE UNIQUE INDEX "category_translation_normalized_name_key" ON "category_translations"
  (lower(btrim("locale")), translate(btrim("name"), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'));
CREATE UNIQUE INDEX "tag_translation_normalized_name_key" ON "tag_translations"
  (lower(btrim("locale")), translate(btrim("name"), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'));
