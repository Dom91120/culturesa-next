-- CreateTable
CREATE TABLE "throttle_buckets" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "reset_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "throttle_buckets_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "captcha_nonces" (
    "nonce" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "captcha_nonces_pkey" PRIMARY KEY ("nonce")
);

-- CreateIndex
CREATE INDEX "throttle_buckets_reset_at_idx" ON "throttle_buckets"("reset_at");

-- CreateIndex
CREATE INDEX "captcha_nonces_expires_at_idx" ON "captcha_nonces"("expires_at");
