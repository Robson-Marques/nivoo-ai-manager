-- Projeto ligado ao Git versiona sozinho (commit + tag + push) a cada trabalho concluído: é o padrão.
ALTER TABLE "Project" ALTER COLUMN "gitAutoPush" SET DEFAULT true;
UPDATE "Project" SET "gitAutoPush" = true WHERE "gitUrl" IS NOT NULL;
