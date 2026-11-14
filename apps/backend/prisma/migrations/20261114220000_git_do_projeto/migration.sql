-- Projeto ligado a um repositório Git (GitHub/GitLab): URL, branch, conta e envio automático.
-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "gitAccountId" TEXT,
ADD COLUMN     "gitAutoPush" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "gitBranch" TEXT,
ADD COLUMN     "gitLastSyncAt" TIMESTAMP(3),
ADD COLUMN     "gitUrl" TEXT;

