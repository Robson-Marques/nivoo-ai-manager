CREATE TABLE "ProviderCooldown" (
  "providerId" TEXT NOT NULL PRIMARY KEY,
  "until" TIMESTAMP(3) NOT NULL,
  "failures" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
