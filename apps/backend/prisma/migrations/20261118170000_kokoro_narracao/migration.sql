-- Locução local gratuita pelo Kokoro, ainda permitindo selecionar a Gemini TTS paga.
ALTER TABLE "Project"
  ADD COLUMN "motorNarracao" TEXT NOT NULL DEFAULT 'kokoro',
  ADD COLUMN "velocidadeNarracao" DOUBLE PRECISION NOT NULL DEFAULT 1,
  ADD COLUMN "pronunciasNarracao" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "modoTrilha" TEXT NOT NULL DEFAULT 'sem-trilha';

-- A opção econômica passa a ser o padrão também nos projetos existentes.
UPDATE "Project" SET "vozNarracao" = 'pf_dora';
ALTER TABLE "Project" ALTER COLUMN "vozNarracao" SET DEFAULT 'pf_dora';
