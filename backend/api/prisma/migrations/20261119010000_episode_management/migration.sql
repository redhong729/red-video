ALTER TABLE "drama_drafts" ADD COLUMN "episode_order_customized" BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE "episodes" (
    "id" UUID NOT NULL,
    "drama_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OFFLINE',
    "price_mode" TEXT,
    "price_credits" INTEGER,
    "preview_seconds" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "episodes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "episodes_drama_id_fkey" FOREIGN KEY ("drama_id") REFERENCES "dramas"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "episodes_number_position_check" CHECK ("number" > 0 AND "position" >= 0),
    CONSTRAINT "episodes_preview_check" CHECK ("preview_seconds" IS NULL OR "preview_seconds" >= 0),
    CONSTRAINT "episodes_price_check" CHECK (("price_mode" IS NULL AND "price_credits" IS NULL) OR ("price_mode" = 'FREE' AND "price_credits" IS NULL) OR ("price_mode" = 'CREDITS' AND "price_credits" IS NOT NULL AND "price_credits" > 0))
);
CREATE UNIQUE INDEX "episodes_drama_id_number_key" ON "episodes"("drama_id", "number");
CREATE INDEX "episodes_drama_id_position_idx" ON "episodes"("drama_id", "position");
CREATE TABLE "episode_translations" (
    "episode_id" UUID NOT NULL,
    "locale" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    CONSTRAINT "episode_translations_pkey" PRIMARY KEY ("episode_id", "locale"),
    CONSTRAINT "episode_translations_episode_id_fkey" FOREIGN KEY ("episode_id") REFERENCES "episodes"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
