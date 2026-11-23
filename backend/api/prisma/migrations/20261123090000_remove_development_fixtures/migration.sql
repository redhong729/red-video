DELETE FROM "categories" AS category
WHERE category."id" = '0bcdb091-b8f0-4b20-99fb-70be8bd6fa11'::uuid
  AND NOT EXISTS (
    SELECT 1 FROM "drama_drafts" AS draft
    WHERE draft."category_id" = category."id"
  );

DELETE FROM "tags" AS tag
WHERE tag."id" = '0bcdb091-b8f0-4b20-99fb-70be8bd6fa12'::uuid
  AND NOT EXISTS (
    SELECT 1 FROM "drama_tags" AS drama_tag
    WHERE drama_tag."tag_id" = tag."id"
  );

DROP TABLE IF EXISTS "hello_messages";
