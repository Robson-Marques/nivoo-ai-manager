-- Remove o subsistema Mercado (ativos, datasets, pesquisas, hipóteses, experimentos) e os critérios
-- permanentes; projetos passam a ter regras próprias e IA escolhida. Dados existentes preservados:
-- projetos da antiga área Mercado vão para a base "Geral"; memórias de hipóteses viram pendências e
-- resultados validados viram evidências.

-- 1. Memória: categorias removidas
UPDATE "MemoryEntry" SET "category" = 'PENDENCIA' WHERE "category" IN ('HIPOTESE_INVESTIGACAO', 'HIPOTESE_REJEITADA');
UPDATE "MemoryEntry" SET "category" = 'EVIDENCIA' WHERE "category" = 'RESULTADO_VALIDADO';

-- 2. Aprovações de liberação de dataset deixam de existir
DELETE FROM "Approval" WHERE "kind" = 'LIBERAR_DATASET_RESERVADO';

-- 3. Antiga área Mercado → base Geral
DO $$
DECLARE
  mercado TEXT;
  geral TEXT;
  v INT;
BEGIN
  SELECT id INTO mercado FROM "Area" WHERE slug = 'mercado';
  IF mercado IS NULL THEN RETURN; END IF;
  SELECT id INTO geral FROM "Area" WHERE slug = 'geral';
  IF geral IS NULL THEN
    UPDATE "Area" SET slug = 'geral', name = 'Geral', template = 'geral',
      description = 'Qualquer assunto. O comportamento vem das regras e do conhecimento de cada projeto.', "instructionsVersion" = "instructionsVersion" + 1, "updatedAt" = now()
      WHERE id = mercado RETURNING "instructionsVersion" INTO v;
    INSERT INTO "AreaInstruction" (id, "areaId", version, text, sha256, author, reason)
      VALUES (gen_random_uuid()::text, mercado, v, 'Você é um assistente especialista no assunto deste projeto.
Trabalhe SOMENTE no escopo deste projeto. Se o pedido estiver fora do escopo ou contrariar as regras, não faça: explique e pergunte.
Não invente fatos, dados, preços, nomes ou requisitos. Se faltar informação, pergunte ou registre como pendência.
Siga as regras da base, as regras do projeto, o conhecimento do projeto e as decisões da memória. Não as contradiga por conta própria.
Faça somente o que foi pedido e aprovado. Nada de mudanças extras "aproveitando".
Registre progresso, decisões propostas e pendências em .nivoo/notas.jsonl ao longo do trabalho.', '7aaea9acdf7392a351e47d399e4529cf8f4b09c9b20f7012ff2e811edb7f7e6e', 'sistema:migracao', 'base Mercado removida; projetos passam à base Geral');
  ELSE
    UPDATE "Project" SET "areaId" = geral WHERE "areaId" = mercado;
    DELETE FROM "Area" WHERE id = mercado;
  END IF;
END $$;

-- AlterEnum
BEGIN;
CREATE TYPE "ApprovalKind_new" AS ENUM ('CRITERIO_SUBJETIVO', 'ACAO_DESTRUTIVA');
ALTER TABLE "Approval" ALTER COLUMN "kind" TYPE "ApprovalKind_new" USING ("kind"::text::"ApprovalKind_new");
ALTER TYPE "ApprovalKind" RENAME TO "ApprovalKind_old";
ALTER TYPE "ApprovalKind_new" RENAME TO "ApprovalKind";
DROP TYPE "ApprovalKind_old";
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "MemoryCategory_new" AS ENUM ('ESPECIFICACAO', 'ARQUITETURA_RESTRICOES', 'DECISAO_APROVADA', 'EVIDENCIA', 'PENDENCIA');
ALTER TABLE "MemoryEntry" ALTER COLUMN "category" TYPE "MemoryCategory_new" USING ("category"::text::"MemoryCategory_new");
ALTER TYPE "MemoryCategory" RENAME TO "MemoryCategory_old";
ALTER TYPE "MemoryCategory_new" RENAME TO "MemoryCategory";
DROP TYPE "MemoryCategory_old";
COMMIT;

-- DropForeignKey
ALTER TABLE "ProjectInvariant" DROP CONSTRAINT "ProjectInvariant_projectId_fkey";

-- DropForeignKey
ALTER TABLE "Dataset" DROP CONSTRAINT "Dataset_projectId_fkey";

-- DropForeignKey
ALTER TABLE "Dataset" DROP CONSTRAINT "Dataset_assetId_fkey";

-- DropForeignKey
ALTER TABLE "Research" DROP CONSTRAINT "Research_projectId_fkey";

-- DropForeignKey
ALTER TABLE "ResearchAsset" DROP CONSTRAINT "ResearchAsset_researchId_fkey";

-- DropForeignKey
ALTER TABLE "ResearchAsset" DROP CONSTRAINT "ResearchAsset_assetId_fkey";

-- DropForeignKey
ALTER TABLE "Hypothesis" DROP CONSTRAINT "Hypothesis_researchId_fkey";

-- DropForeignKey
ALTER TABLE "Experiment" DROP CONSTRAINT "Experiment_projectId_fkey";

-- DropForeignKey
ALTER TABLE "Experiment" DROP CONSTRAINT "Experiment_researchId_fkey";

-- DropForeignKey
ALTER TABLE "Experiment" DROP CONSTRAINT "Experiment_hypothesisId_fkey";

-- DropForeignKey
ALTER TABLE "Experiment" DROP CONSTRAINT "Experiment_datasetId_fkey";

-- DropForeignKey
ALTER TABLE "Experiment" DROP CONSTRAINT "Experiment_jobId_fkey";

-- DropForeignKey
ALTER TABLE "Job" DROP CONSTRAINT "Job_researchId_fkey";

-- DropForeignKey
ALTER TABLE "MemoryEntry" DROP CONSTRAINT "MemoryEntry_researchId_fkey";

-- AlterTable
ALTER TABLE "Area" DROP COLUMN "kind";

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "provider" TEXT NOT NULL DEFAULT 'claude-code-cli',
ADD COLUMN     "rulesVersion" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Job" DROP COLUMN "researchId";

-- AlterTable
ALTER TABLE "MemoryEntry" DROP COLUMN "researchId";

-- DropTable
DROP TABLE "ProjectInvariant";

-- DropTable
DROP TABLE "MarketAsset";

-- DropTable
DROP TABLE "Dataset";

-- DropTable
DROP TABLE "Research";

-- DropTable
DROP TABLE "ResearchAsset";

-- DropTable
DROP TABLE "Hypothesis";

-- DropTable
DROP TABLE "Experiment";

-- DropEnum
DROP TYPE "AreaKind";

-- DropEnum
DROP TYPE "DatasetRole";

-- DropEnum
DROP TYPE "HypothesisStatus";

-- DropEnum
DROP TYPE "ResearchStatus";

-- CreateTable
CREATE TABLE "ProjectRule" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectRule_projectId_version_key" ON "ProjectRule"("projectId", "version");

-- AddForeignKey
ALTER TABLE "ProjectRule" ADD CONSTRAINT "ProjectRule_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

