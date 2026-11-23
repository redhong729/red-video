ALTER TABLE "episodes" ADD COLUMN "pending_media_id" UUID;
CREATE UNIQUE INDEX "episodes_pending_media_id_key" ON "episodes"("pending_media_id");
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_pending_media_id_fkey" FOREIGN KEY ("pending_media_id") REFERENCES "media_uploads"("id") ON DELETE SET NULL ON UPDATE CASCADE;
