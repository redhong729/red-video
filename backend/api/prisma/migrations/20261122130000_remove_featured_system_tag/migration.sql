-- Homepage operations now owns featured placement. Remove the legacy system tag
-- after clearing its draft assignments so the RESTRICT foreign key is satisfied.
BEGIN;

DELETE FROM "drama_tags"
WHERE "tag_id" = (
  SELECT "id" FROM "tags" WHERE "system_key" = 'homepage-featured'
);

DELETE FROM "tags"
WHERE "system_key" = 'homepage-featured';

COMMIT;
