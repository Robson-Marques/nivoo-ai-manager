-- Áreas e conversa. Projetos existentes são migrados para a área "Mercado" mantendo a pasta atual.
-- CreateEnum
CREATE TYPE "AreaKind" AS ENUM ('MERCADO', 'GENERICA');

-- CreateEnum
CREATE TYPE "MessageRole" AS ENUM ('USUARIO', 'ASSISTENTE');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('PENDENTE', 'PRONTA', 'ERRO');

-- AlterEnum
ALTER TYPE "QueueTaskType" ADD VALUE 'PLAN_MESSAGE';

-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "mergeStatus" TEXT,
ADD COLUMN     "mergedCommit" TEXT;


-- AlterTable
ALTER TABLE "QueueTask" ADD COLUMN     "messageId" TEXT,
ALTER COLUMN "jobId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "Area" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "kind" "AreaKind" NOT NULL DEFAULT 'GENERICA',
    "template" TEXT NOT NULL DEFAULT 'generica',
    "instructionsVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Area_pkey" PRIMARY KEY ("id")
);

-- Área padrão "Mercado" (modelo pronto) e migração dos projetos existentes, sem mover pastas.
INSERT INTO "Area" ("id", "slug", "name", "description", "kind", "template", "instructionsVersion", "updatedAt")
VALUES (gen_random_uuid()::text, 'mercado', 'Mercado', 'Pesquisa quantitativa e algoritmos de trading (WIN e WDO).', 'MERCADO', 'mercado', 1, CURRENT_TIMESTAMP);

ALTER TABLE "Project" ADD COLUMN "areaId" TEXT, ADD COLUMN "dirKey" TEXT;
UPDATE "Project" SET "areaId" = (SELECT "id" FROM "Area" WHERE "slug" = 'mercado'), "dirKey" = "slug";
ALTER TABLE "Project" ALTER COLUMN "areaId" SET NOT NULL, ALTER COLUMN "dirKey" SET NOT NULL;

-- CreateTable
CREATE TABLE "AreaInstruction" (
    "id" TEXT NOT NULL,
    "areaId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AreaInstruction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" "MessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "status" "MessageStatus" NOT NULL DEFAULT 'PRONTA',
    "kind" TEXT,
    "plan" JSONB,
    "jobId" TEXT,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "sessionId" TEXT,
    "costUsd" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Area_slug_key" ON "Area"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "AreaInstruction_areaId_version_key" ON "AreaInstruction"("areaId", "version");

-- AddForeignKey
ALTER TABLE "AreaInstruction" ADD CONSTRAINT "AreaInstruction_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "Area"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationMessage" ADD CONSTRAINT "ConversationMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "Area"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueueTask" ADD CONSTRAINT "QueueTask_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ConversationMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
