-- Modelo escolhido para cada IA, por projeto (ex.: Claude → opus; ChatGPT → gpt-6.1-sol). Vazio = padrão da IA.
-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "aiModels" JSONB NOT NULL DEFAULT '{}';

