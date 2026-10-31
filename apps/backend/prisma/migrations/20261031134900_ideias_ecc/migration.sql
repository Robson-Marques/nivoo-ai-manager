-- AlterTable
ALTER TABLE "Approval" ADD COLUMN     "subjectHash" TEXT;

-- AlterTable
ALTER TABLE "Attempt" ADD COLUMN     "contextStats" JSONB;

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "maxCostUsd" DECIMAL(12,4);

-- CreateTable
CREATE TABLE "ProjectInvariant" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "kind" "CriterionKind" NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "author" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectInvariant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectInvariant_projectId_key_key" ON "ProjectInvariant"("projectId", "key");

-- AddForeignKey
ALTER TABLE "ProjectInvariant" ADD CONSTRAINT "ProjectInvariant_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
