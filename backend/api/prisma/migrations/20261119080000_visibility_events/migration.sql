CREATE TABLE "visibility_events" (
  "id" UUID NOT NULL,
  "drama_id" UUID NOT NULL,
  "episode_id" UUID,
  "actor" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "from_status" TEXT NOT NULL,
  "to_status" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "visibility_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "visibility_events_drama_id_fkey" FOREIGN KEY ("drama_id") REFERENCES "dramas"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "visibility_events_episode_id_fkey" FOREIGN KEY ("episode_id") REFERENCES "episodes"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "visibility_events_drama_id_created_at_idx" ON "visibility_events"("drama_id", "created_at");
