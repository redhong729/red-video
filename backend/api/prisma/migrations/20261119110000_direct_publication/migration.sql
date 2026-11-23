-- 已有审核历史保留，未完成的审核明确取消，不能视为通过。
ALTER TABLE "review_items" DROP CONSTRAINT "review_items_status_check";
ALTER TABLE "review_items" ADD CONSTRAINT "review_items_status_check" CHECK ("status" IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'));
UPDATE "review_items" SET "status" = 'CANCELLED', "note" = CASE WHEN "note" IS NULL OR "note" = '' THEN '审核流程已停用' ELSE "note" || '；审核流程已停用' END WHERE "status" = 'PENDING';
UPDATE "dramas" SET "status" = 'DRAFT', "updated_at" = CURRENT_TIMESTAMP WHERE "status" = 'IN_REVIEW';

CREATE TABLE "publication_revisions" (
  "id" UUID NOT NULL PRIMARY KEY,
  "drama_id" UUID NOT NULL REFERENCES "dramas"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "episode_id" UUID REFERENCES "episodes"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "kind" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "snapshot" JSONB NOT NULL,
  "created_by" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "publication_revisions_kind_check" CHECK (("kind" = 'DRAMA' AND "episode_id" IS NULL) OR ("kind" = 'EPISODE' AND "episode_id" IS NOT NULL))
);
CREATE INDEX "publication_revisions_drama_id_created_at_idx" ON "publication_revisions"("drama_id", "created_at");
ALTER TABLE "drama_publications" ADD COLUMN "fingerprint" TEXT, ADD COLUMN "revision_id" UUID;
UPDATE "drama_publications" SET "fingerprint" = r."fingerprint" FROM "review_items" r WHERE "drama_publications"."review_id" = r."id";
ALTER TABLE "drama_publications" ALTER COLUMN "fingerprint" SET NOT NULL, ALTER COLUMN "review_id" DROP NOT NULL;
ALTER TABLE "drama_publications" ADD CONSTRAINT "drama_publications_revision_id_fkey" FOREIGN KEY ("revision_id") REFERENCES "publication_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "episode_publications" ADD COLUMN "fingerprint" TEXT, ADD COLUMN "revision_id" UUID;
UPDATE "episode_publications" SET "fingerprint" = r."fingerprint" FROM "review_items" r WHERE "episode_publications"."review_id" = r."id";
ALTER TABLE "episode_publications" ALTER COLUMN "fingerprint" SET NOT NULL, ALTER COLUMN "review_id" DROP NOT NULL;
ALTER TABLE "episode_publications" ADD CONSTRAINT "episode_publications_revision_id_fkey" FOREIGN KEY ("revision_id") REFERENCES "publication_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
