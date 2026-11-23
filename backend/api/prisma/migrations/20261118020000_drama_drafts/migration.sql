CREATE TABLE "dramas" ("id" UUID NOT NULL, "status" TEXT NOT NULL DEFAULT 'DRAFT', "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMPTZ(3) NOT NULL, CONSTRAINT "dramas_pkey" PRIMARY KEY ("id"));
CREATE INDEX "dramas_updated_at_id_idx" ON "dramas"("updated_at", "id");
CREATE TABLE "categories" ("id" UUID NOT NULL, CONSTRAINT "categories_pkey" PRIMARY KEY ("id"));
CREATE TABLE "tags" ("id" UUID NOT NULL, CONSTRAINT "tags_pkey" PRIMARY KEY ("id"));
CREATE TABLE "drama_drafts" (
  "drama_id" UUID NOT NULL, "category_id" UUID, "total_episodes" INTEGER, "sort_order" INTEGER NOT NULL DEFAULT 0,
  "pricing_mode" TEXT, "free_episodes" INTEGER, "price_credits" INTEGER, "preview_seconds" INTEGER NOT NULL DEFAULT 30,
  CONSTRAINT "drama_drafts_pkey" PRIMARY KEY ("drama_id"),
  CONSTRAINT "drama_drafts_drama_id_fkey" FOREIGN KEY ("drama_id") REFERENCES "dramas"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "drama_drafts_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "drama_drafts_numbers_check" CHECK (("total_episodes" IS NULL OR "total_episodes" > 0) AND "sort_order" >= 0 AND ("free_episodes" IS NULL OR "free_episodes" >= 0) AND ("price_credits" IS NULL OR "price_credits" > 0) AND "preview_seconds" >= 0),
  CONSTRAINT "drama_drafts_price_check" CHECK ("pricing_mode" IS NULL OR "pricing_mode" IN ('FREE', 'PER_EPISODE')),
  CONSTRAINT "drama_drafts_free_count_check" CHECK ("total_episodes" IS NULL OR "free_episodes" IS NULL OR "free_episodes" <= "total_episodes")
);
CREATE INDEX "drama_drafts_category_id_idx" ON "drama_drafts"("category_id");
CREATE TABLE "drama_translations" ("drama_id" UUID NOT NULL, "locale" TEXT NOT NULL, "title" TEXT, "description" TEXT, CONSTRAINT "drama_translations_pkey" PRIMARY KEY ("drama_id", "locale"), CONSTRAINT "drama_translations_drama_id_fkey" FOREIGN KEY ("drama_id") REFERENCES "drama_drafts"("drama_id") ON DELETE CASCADE ON UPDATE CASCADE);
CREATE TABLE "drama_actors" ("id" UUID NOT NULL, "drama_id" UUID NOT NULL, "name" TEXT NOT NULL, "role_name" TEXT, "position" INTEGER NOT NULL, CONSTRAINT "drama_actors_pkey" PRIMARY KEY ("id"), CONSTRAINT "drama_actors_drama_id_fkey" FOREIGN KEY ("drama_id") REFERENCES "drama_drafts"("drama_id") ON DELETE CASCADE ON UPDATE CASCADE);
CREATE UNIQUE INDEX "drama_actors_drama_id_position_key" ON "drama_actors"("drama_id", "position");
CREATE TABLE "category_translations" ("category_id" UUID NOT NULL, "locale" TEXT NOT NULL, "name" TEXT NOT NULL, CONSTRAINT "category_translations_pkey" PRIMARY KEY ("category_id", "locale"), CONSTRAINT "category_translations_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE);
CREATE TABLE "tag_translations" ("tag_id" UUID NOT NULL, "locale" TEXT NOT NULL, "name" TEXT NOT NULL, CONSTRAINT "tag_translations_pkey" PRIMARY KEY ("tag_id", "locale"), CONSTRAINT "tag_translations_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE);
CREATE TABLE "drama_tags" ("drama_id" UUID NOT NULL, "tag_id" UUID NOT NULL, CONSTRAINT "drama_tags_pkey" PRIMARY KEY ("drama_id", "tag_id"), CONSTRAINT "drama_tags_drama_id_fkey" FOREIGN KEY ("drama_id") REFERENCES "drama_drafts"("drama_id") ON DELETE CASCADE ON UPDATE CASCADE, CONSTRAINT "drama_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE RESTRICT ON UPDATE CASCADE);
CREATE INDEX "drama_tags_tag_id_idx" ON "drama_tags"("tag_id");
