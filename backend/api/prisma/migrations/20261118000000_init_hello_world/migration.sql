-- A minimal record for the database-to-API-to-admin demonstration.
CREATE TABLE "hello_messages" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    CONSTRAINT "hello_messages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "hello_messages_key_key" ON "hello_messages"("key");
