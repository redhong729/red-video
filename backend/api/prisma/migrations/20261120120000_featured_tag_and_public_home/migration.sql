ALTER TABLE "tags" ADD COLUMN "system_key" TEXT;
CREATE UNIQUE INDEX "tags_system_key_key" ON "tags"("system_key");

DO $$
DECLARE
  focus_tag_id UUID;
BEGIN
  SELECT "tag_id" INTO focus_tag_id
  FROM "tag_translations"
  WHERE lower(btrim("locale")) = 'zh-cn' AND btrim("name") = '焦点图'
  LIMIT 1;

  IF focus_tag_id IS NULL THEN
    focus_tag_id := '00000000-0000-4000-8000-000000000001'::uuid;
    INSERT INTO "tags" ("id", "active", "system_key")
    VALUES (focus_tag_id, true, 'homepage-featured');
  ELSE
    UPDATE "tags" SET "system_key" = 'homepage-featured', "active" = true
    WHERE "id" = focus_tag_id;
  END IF;

  INSERT INTO "tag_translations" ("tag_id", "locale", "name")
  VALUES (focus_tag_id, 'zh-CN', '焦点图')
  ON CONFLICT ("tag_id", "locale") DO UPDATE SET "name" = EXCLUDED."name";

  INSERT INTO "tag_translations" ("tag_id", "locale", "name")
  VALUES (focus_tag_id, 'en', 'Featured')
  ON CONFLICT ("tag_id", "locale") DO UPDATE SET "name" = EXCLUDED."name";
END $$;
