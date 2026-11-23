ALTER TABLE "review_items" ADD COLUMN "sequence" BIGSERIAL NOT NULL;
CREATE UNIQUE INDEX "review_items_sequence_key" ON "review_items"("sequence");
