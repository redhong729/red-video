CREATE TABLE "home_configuration" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "featured" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "popular" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "ranking" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "configured" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "home_configuration_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "home_configuration_singleton_check" CHECK ("id" = 'default')
);

INSERT INTO "home_configuration" ("id") VALUES ('default');
