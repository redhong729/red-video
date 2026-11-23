CREATE TABLE "review_items" (
 "id" UUID NOT NULL PRIMARY KEY, "drama_id" UUID NOT NULL REFERENCES "dramas"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "episode_id" UUID REFERENCES "episodes"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "kind" TEXT NOT NULL, "fingerprint" TEXT NOT NULL, "snapshot" JSONB NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'PENDING', "submitted_by" TEXT NOT NULL, "submitted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "reviewed_by" TEXT, "reviewed_at" TIMESTAMPTZ(3), "note" TEXT,
 CONSTRAINT "review_items_kind_check" CHECK (("kind" = 'DRAMA' AND "episode_id" IS NULL) OR ("kind" = 'EPISODE' AND "episode_id" IS NOT NULL)),
 CONSTRAINT "review_items_status_check" CHECK ("status" IN ('PENDING', 'APPROVED', 'REJECTED'))
);
CREATE INDEX "review_items_drama_id_submitted_at_idx" ON "review_items"("drama_id", "submitted_at");
CREATE INDEX "review_items_episode_id_submitted_at_idx" ON "review_items"("episode_id", "submitted_at");
CREATE TABLE "drama_publications" (
 "drama_id" UUID NOT NULL PRIMARY KEY REFERENCES "dramas"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "review_id" UUID NOT NULL REFERENCES "review_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "snapshot" JSONB NOT NULL, "published_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "published_by" TEXT NOT NULL
);
CREATE TABLE "episode_publications" (
 "episode_id" UUID NOT NULL PRIMARY KEY REFERENCES "episodes"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "review_id" UUID NOT NULL REFERENCES "review_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "snapshot" JSONB NOT NULL, "published_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "published_by" TEXT NOT NULL
);
