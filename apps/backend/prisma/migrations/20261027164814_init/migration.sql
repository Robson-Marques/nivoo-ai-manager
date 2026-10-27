-- CreateEnum
CREATE TYPE "ExecStatus" AS ENUM ('PENDENTE', 'EXECUTANDO', 'AGUARDANDO_RECURSO', 'AGUARDANDO_APROVACAO', 'BLOQUEADO', 'FALHOU', 'CONCLUIDO');

-- CreateEnum
CREATE TYPE "AttemptStatus" AS ENUM ('EXECUTANDO', 'SUCESSO', 'FALHA', 'INTERROMPIDA', 'RECURSO_INDISPONIVEL');

-- CreateEnum
CREATE TYPE "QueueTaskType" AS ENUM ('RUN_STEP', 'EVALUATE_JOB');

-- CreateEnum
CREATE TYPE "QueueTaskStatus" AS ENUM ('QUEUED', 'RUNNING', 'DONE', 'CANCELLED', 'DEAD');

-- CreateEnum
CREATE TYPE "CriterionKind" AS ENUM ('COMMAND', 'FILE_EXISTS', 'ARTIFACT_PRESENT', 'METRIC_THRESHOLD', 'MANUAL_APPROVAL');

-- CreateEnum
CREATE TYPE "CriterionStatus" AS ENUM ('PENDENTE', 'APROVADO', 'REPROVADO', 'AGUARDANDO_APROVACAO');

-- CreateEnum
CREATE TYPE "ApprovalKind" AS ENUM ('CRITERIO_SUBJETIVO', 'ACAO_DESTRUTIVA', 'LIBERAR_DATASET_RESERVADO');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDENTE', 'APROVADO', 'REJEITADO');

-- CreateEnum
CREATE TYPE "MemoryCategory" AS ENUM ('ESPECIFICACAO', 'ARQUITETURA_RESTRICOES', 'DECISAO_APROVADA', 'HIPOTESE_INVESTIGACAO', 'EVIDENCIA', 'HIPOTESE_REJEITADA', 'RESULTADO_VALIDADO', 'PENDENCIA');

-- CreateEnum
CREATE TYPE "DatasetRole" AS ENUM ('TREINO', 'VALIDACAO', 'RESERVADO');

-- CreateEnum
CREATE TYPE "HypothesisStatus" AS ENUM ('EM_INVESTIGACAO', 'REJEITADA', 'VALIDADA');

-- CreateEnum
CREATE TYPE "ResearchStatus" AS ENUM ('ABERTA', 'EM_ANDAMENTO', 'ENCERRADA');

-- CreateEnum
CREATE TYPE "LogLevel" AS ENUM ('DEBUG', 'INFO', 'WARN', 'ERROR');

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "workspacePath" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketAsset" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "exchange" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "priceUnit" TEXT NOT NULL,
    "tickSize" DECIMAL(18,6) NOT NULL,
    "pointValue" DECIMAL(18,6) NOT NULL,
    "sessionTz" TEXT NOT NULL,
    "sessionOpen" TEXT NOT NULL,
    "sessionClose" TEXT NOT NULL,
    "rules" JSONB NOT NULL,
    "validation" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dataset" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "uri" TEXT NOT NULL,
    "sha256" TEXT,
    "timeframe" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "role" "DatasetRole" NOT NULL DEFAULT 'TREINO',
    "released" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Dataset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Research" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "status" "ResearchStatus" NOT NULL DEFAULT 'ABERTA',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Research_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchAsset" (
    "researchId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,

    CONSTRAINT "ResearchAsset_pkey" PRIMARY KEY ("researchId","assetId")
);

-- CreateTable
CREATE TABLE "Hypothesis" (
    "id" TEXT NOT NULL,
    "researchId" TEXT NOT NULL,
    "statement" TEXT NOT NULL,
    "rationale" TEXT NOT NULL DEFAULT '',
    "status" "HypothesisStatus" NOT NULL DEFAULT 'EM_INVESTIGACAO',
    "conclusion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Hypothesis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Experiment" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "researchId" TEXT NOT NULL,
    "hypothesisId" TEXT,
    "datasetId" TEXT,
    "jobId" TEXT,
    "name" TEXT NOT NULL,
    "parameters" JSONB NOT NULL DEFAULT '{}',
    "codeRef" TEXT,
    "metrics" JSONB,
    "metricsArtifactId" TEXT,
    "status" "ExecStatus" NOT NULL DEFAULT 'PENDENTE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Experiment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "researchId" TEXT,
    "title" TEXT NOT NULL,
    "status" "ExecStatus" NOT NULL DEFAULT 'PENDENTE',
    "blockedReason" TEXT,
    "statusDetail" TEXT,
    "defaultProvider" TEXT NOT NULL DEFAULT 'local-shell',
    "objectiveVersion" INTEGER NOT NULL DEFAULT 1,
    "maxAttemptsPerStep" INTEGER NOT NULL DEFAULT 3,
    "maxDurationSec" INTEGER NOT NULL DEFAULT 3600,
    "maxCostUsd" DECIMAL(12,4) NOT NULL DEFAULT 5,
    "costSpentUsd" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "stepTimeoutSec" INTEGER NOT NULL DEFAULT 900,
    "repetitionWindow" INTEGER NOT NULL DEFAULT 2,
    "gitBranch" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "activeSeconds" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobObjectiveVersion" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobObjectiveVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AcceptanceCriterion" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "kind" "CriterionKind" NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "status" "CriterionStatus" NOT NULL DEFAULT 'PENDENTE',
    "lastCheckedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AcceptanceCriterion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CriterionCheck" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "criterionId" TEXT NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "evidence" JSONB NOT NULL,
    "artifactId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CriterionCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Step" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "instructions" TEXT NOT NULL,
    "provider" TEXT,
    "dependsOn" TEXT[],
    "verifyCommand" TEXT,
    "requiresApproval" BOOLEAN NOT NULL DEFAULT false,
    "status" "ExecStatus" NOT NULL DEFAULT 'PENDENTE',
    "statusDetail" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastOutput" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Step_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attempt" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "status" "AttemptStatus" NOT NULL DEFAULT 'EXECUTANDO',
    "exitCode" INTEGER,
    "output" TEXT,
    "outputHash" TEXT,
    "error" TEXT,
    "costUsd" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "Attempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Checkpoint" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "stepId" TEXT,
    "seq" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "state" JSONB NOT NULL,
    "gitCommit" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Checkpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Artifact" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "jobId" TEXT,
    "stepId" TEXT,
    "attemptId" TEXT,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Artifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LogEntry" (
    "id" BIGSERIAL NOT NULL,
    "jobId" TEXT NOT NULL,
    "stepId" TEXT,
    "attemptId" TEXT,
    "level" "LogLevel" NOT NULL DEFAULT 'INFO',
    "source" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LogEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Approval" (
    "id" TEXT NOT NULL,
    "jobId" TEXT,
    "projectId" TEXT NOT NULL,
    "kind" "ApprovalKind" NOT NULL,
    "subjectId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDENTE',
    "decidedBy" TEXT,
    "reason" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "Approval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemoryEntry" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "researchId" TEXT,
    "category" "MemoryCategory" NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "references" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "supersededById" TEXT,
    "author" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemoryEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QueueTask" (
    "id" TEXT NOT NULL,
    "type" "QueueTaskType" NOT NULL,
    "jobId" TEXT NOT NULL,
    "stepId" TEXT,
    "status" "QueueTaskStatus" NOT NULL DEFAULT 'QUEUED',
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedBy" TEXT,
    "lockedUntil" TIMESTAMP(3),
    "claims" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QueueTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderConfig" (
    "id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkerHeartbeat" (
    "id" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "pid" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "providers" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "WorkerHeartbeat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Project_slug_key" ON "Project"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "MarketAsset_code_key" ON "MarketAsset"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Dataset_projectId_name_key" ON "Dataset"("projectId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Experiment_jobId_key" ON "Experiment"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "JobObjectiveVersion_jobId_version_key" ON "JobObjectiveVersion"("jobId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "AcceptanceCriterion_jobId_key_key" ON "AcceptanceCriterion"("jobId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "Step_jobId_key_key" ON "Step"("jobId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "Attempt_stepId_number_key" ON "Attempt"("stepId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "Checkpoint_jobId_seq_key" ON "Checkpoint"("jobId", "seq");

-- CreateIndex
CREATE INDEX "LogEntry_jobId_id_idx" ON "LogEntry"("jobId", "id");

-- CreateIndex
CREATE INDEX "QueueTask_status_runAt_idx" ON "QueueTask"("status", "runAt");

-- AddForeignKey
ALTER TABLE "Dataset" ADD CONSTRAINT "Dataset_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dataset" ADD CONSTRAINT "Dataset_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "MarketAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Research" ADD CONSTRAINT "Research_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchAsset" ADD CONSTRAINT "ResearchAsset_researchId_fkey" FOREIGN KEY ("researchId") REFERENCES "Research"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchAsset" ADD CONSTRAINT "ResearchAsset_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "MarketAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Hypothesis" ADD CONSTRAINT "Hypothesis_researchId_fkey" FOREIGN KEY ("researchId") REFERENCES "Research"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Experiment" ADD CONSTRAINT "Experiment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Experiment" ADD CONSTRAINT "Experiment_researchId_fkey" FOREIGN KEY ("researchId") REFERENCES "Research"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Experiment" ADD CONSTRAINT "Experiment_hypothesisId_fkey" FOREIGN KEY ("hypothesisId") REFERENCES "Hypothesis"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Experiment" ADD CONSTRAINT "Experiment_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "Dataset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Experiment" ADD CONSTRAINT "Experiment_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_researchId_fkey" FOREIGN KEY ("researchId") REFERENCES "Research"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobObjectiveVersion" ADD CONSTRAINT "JobObjectiveVersion_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcceptanceCriterion" ADD CONSTRAINT "AcceptanceCriterion_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CriterionCheck" ADD CONSTRAINT "CriterionCheck_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CriterionCheck" ADD CONSTRAINT "CriterionCheck_criterionId_fkey" FOREIGN KEY ("criterionId") REFERENCES "AcceptanceCriterion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Step" ADD CONSTRAINT "Step_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "Step"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Checkpoint" ADD CONSTRAINT "Checkpoint_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Checkpoint" ADD CONSTRAINT "Checkpoint_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "Step"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Artifact" ADD CONSTRAINT "Artifact_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Artifact" ADD CONSTRAINT "Artifact_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LogEntry" ADD CONSTRAINT "LogEntry_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemoryEntry" ADD CONSTRAINT "MemoryEntry_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemoryEntry" ADD CONSTRAINT "MemoryEntry_researchId_fkey" FOREIGN KEY ("researchId") REFERENCES "Research"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueueTask" ADD CONSTRAINT "QueueTask_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
