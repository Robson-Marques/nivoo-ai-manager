-- AlterEnum
ALTER TYPE "AttemptStatus" ADD VALUE 'SESSAO_ENCERRADA';

-- AlterTable
ALTER TABLE "Attempt" ADD COLUMN     "notesIngested" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "numTurns" INTEGER,
ADD COLUMN     "promptArtifactId" TEXT,
ADD COLUMN     "sessionId" TEXT,
ADD COLUMN     "stopReason" TEXT,
ADD COLUMN     "treeAfter" TEXT,
ADD COLUMN     "treeBefore" TEXT;

-- AlterTable
ALTER TABLE "Hypothesis" ADD COLUMN     "decisionRule" JSONB,
ADD COLUMN     "decisionRuleSetAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "maxSessionsPerStep" INTEGER NOT NULL DEFAULT 8;

-- AlterTable
ALTER TABLE "Step" ADD COLUMN     "providerOptions" JSONB NOT NULL DEFAULT '{}';
