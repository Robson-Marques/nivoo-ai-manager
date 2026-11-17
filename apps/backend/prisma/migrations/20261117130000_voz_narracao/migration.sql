-- Voz padrão da narração/locução dos vídeos de cada projeto (nome da voz da Gemini TTS).
ALTER TABLE "Project" ADD COLUMN "vozNarracao" TEXT NOT NULL DEFAULT 'Kore';
