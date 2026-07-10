-- CreateTable
CREATE TABLE "host_pull_credentials" (
    "id" TEXT NOT NULL,
    "host_id" TEXT NOT NULL,
    "ssh_username" TEXT NOT NULL,
    "auth_type" TEXT NOT NULL,
    "encrypted_secret" TEXT NOT NULL,
    "secret_iv" TEXT NOT NULL,
    "secret_tag" TEXT NOT NULL,
    "ssh_port" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "interval_seconds" INTEGER NOT NULL DEFAULT 30,
    "last_pulled_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "host_pull_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "host_pull_credentials_host_id_key" ON "host_pull_credentials"("host_id");

-- CreateIndex
CREATE INDEX "host_pull_credentials_enabled_idx" ON "host_pull_credentials"("enabled");

-- AddForeignKey
ALTER TABLE "host_pull_credentials" ADD CONSTRAINT "host_pull_credentials_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "hosts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
