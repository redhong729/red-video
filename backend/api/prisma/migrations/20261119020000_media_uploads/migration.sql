CREATE TABLE "media_batches" (
  "id" UUID NOT NULL, "drama_id" UUID NOT NULL, "created_by" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "expires_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "media_batches_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "media_batches_drama_id_fkey" FOREIGN KEY ("drama_id") REFERENCES "dramas"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "media_batches_drama_id_created_at_idx" ON "media_batches"("drama_id", "created_at");
CREATE TABLE "media_uploads" (
  "id" UUID NOT NULL, "batch_id" UUID NOT NULL, "episode_id" UUID NOT NULL, "filename" TEXT NOT NULL,
  "size" INTEGER NOT NULL, "fingerprint" TEXT NOT NULL, "chunk_size" INTEGER NOT NULL, "chunk_count" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'UPLOADING', "phase" TEXT NOT NULL DEFAULT 'UPLOAD',
  "detect_status" TEXT NOT NULL DEFAULT 'PENDING', "transcode_status" TEXT NOT NULL DEFAULT 'PENDING',
  "cover_status" TEXT NOT NULL DEFAULT 'PENDING', "preview_status" TEXT NOT NULL DEFAULT 'PENDING',
  "error" TEXT, "duration" DOUBLE PRECISION, "has_audio" BOOLEAN, "preview_seconds" INTEGER, "selected_cover" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "media_uploads_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "media_uploads_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "media_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "media_uploads_episode_id_fkey" FOREIGN KEY ("episode_id") REFERENCES "episodes"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "media_uploads_size_check" CHECK ("size" > 0 AND "chunk_size" > 0 AND "chunk_count" > 0)
);
CREATE INDEX "media_uploads_episode_id_status_idx" ON "media_uploads"("episode_id", "status");
CREATE INDEX "media_uploads_status_created_at_idx" ON "media_uploads"("status", "created_at");
CREATE TABLE "media_chunks" (
  "upload_id" UUID NOT NULL, "number" INTEGER NOT NULL, "size" INTEGER NOT NULL, "sha256" TEXT NOT NULL,
  CONSTRAINT "media_chunks_pkey" PRIMARY KEY ("upload_id", "number"),
  CONSTRAINT "media_chunks_upload_id_fkey" FOREIGN KEY ("upload_id") REFERENCES "media_uploads"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "media_chunks_size_check" CHECK ("number" >= 0 AND "size" > 0)
);
ALTER TABLE "episodes" ADD COLUMN "draft_media_id" UUID;
CREATE UNIQUE INDEX "episodes_draft_media_id_key" ON "episodes"("draft_media_id");
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_draft_media_id_fkey" FOREIGN KEY ("draft_media_id") REFERENCES "media_uploads"("id") ON DELETE SET NULL ON UPDATE CASCADE;
