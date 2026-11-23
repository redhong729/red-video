CREATE TABLE "admin_users" (
    "id" UUID NOT NULL,
    "username" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "admin_users_username_key" ON "admin_users"("username");

CREATE TABLE "admin_sessions" (
    "token_hash" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "admin_sessions_pkey" PRIMARY KEY ("token_hash"),
    CONSTRAINT "admin_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "admin_users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "admin_sessions_user_id_idx" ON "admin_sessions"("user_id");
CREATE INDEX "admin_sessions_expires_at_idx" ON "admin_sessions"("expires_at");
