-- Guardar separadamente criação da mensagem, início da execução e
-- momento em que a resposta foi efetivamente concluída.
-- Mensagens antigas permanecem NULL: não inventar tempos históricos.
ALTER TABLE "ConversationMessage"
  ADD COLUMN "startedAt" TIMESTAMP(3),
  ADD COLUMN "completedAt" TIMESTAMP(3);
