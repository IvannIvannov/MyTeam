CREATE TABLE "facebook_page_connections" (
 "club_id" UUID PRIMARY KEY REFERENCES "clubs"("id") ON DELETE CASCADE,
 "page_id" TEXT, "page_name" TEXT, "encrypted_token" TEXT,
 "connected_by" TEXT NOT NULL, "updated_at" TIMESTAMPTZ(6) NOT NULL,
 CONSTRAINT "facebook_page_connection_complete" CHECK (
   (page_id IS NULL AND page_name IS NULL AND encrypted_token IS NULL) OR
   (page_id IS NOT NULL AND page_name IS NOT NULL AND encrypted_token IS NOT NULL))
);
CREATE TABLE "facebook_connect_attempts" (
 "id" TEXT PRIMARY KEY, "club_id" UUID NOT NULL REFERENCES "clubs"("id") ON DELETE CASCADE,
 "session_hash" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'pending',
 "encrypted_pages" TEXT, "expires_at" TIMESTAMPTZ(6) NOT NULL,
 CONSTRAINT "facebook_connect_attempt_status" CHECK (status IN ('pending', 'exchanging', 'choosing', 'used', 'failed'))
);
CREATE INDEX "facebook_connect_attempts_expires_at_idx" ON "facebook_connect_attempts"("expires_at");
