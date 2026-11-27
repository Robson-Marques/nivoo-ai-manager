ALTER TABLE "QueueTask" ADD COLUMN "internalErrorSignature" TEXT, ADD COLUMN "internalErrorCount" INTEGER NOT NULL DEFAULT 0;
