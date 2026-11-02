-- AlterTable
ALTER TABLE "Attempt" ADD COLUMN     "costEstimated" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "QueueTask" ADD COLUMN     "recoveries" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "resourceWaits" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Step" ADD COLUMN     "resumeFromAttempt" INTEGER NOT NULL DEFAULT 0;
