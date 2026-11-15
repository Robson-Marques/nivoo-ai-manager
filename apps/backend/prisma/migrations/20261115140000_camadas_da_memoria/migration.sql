-- Memória em camadas: PROJETO (o que o usuário vê, uma entrada por assunto) e INTERNA (processo da IA).
ALTER TABLE "MemoryEntry" ADD COLUMN "camada" TEXT NOT NULL DEFAULT 'PROJETO';
ALTER TABLE "MemoryEntry" ADD COLUMN "chave" TEXT;
CREATE INDEX "MemoryEntry_projectId_camada_supersededById_idx" ON "MemoryEntry"("projectId", "camada", "supersededById");

-- O que era processo e se misturava com as decisões: notas das sessões, lições, registro de trabalhos concluídos.
UPDATE "MemoryEntry" SET "camada" = 'INTERNA'
WHERE "references"->>'origem' IN ('notas-do-agente', 'licao-automatica')
   OR "title" LIKE 'Resultado do trabalho %'
   OR "title" LIKE 'Resultado do job %'
   OR "title" LIKE '[esquecido]%';

-- Assunto das entradas do projeto (título normalizado).
UPDATE "MemoryEntry" SET "chave" = trim(both '-' from regexp_replace(lower("title"), '[^[:alnum:]]+', '-', 'g'))
WHERE "camada" = 'PROJETO';

-- Mesmo assunto repetido: fica a mais recente; as anteriores viram histórico (apontam para ela).
UPDATE "MemoryEntry" AS velho SET "supersededById" = novo.id
FROM (
  SELECT DISTINCT ON ("projectId", "chave") id, "projectId", "chave", "createdAt"
  FROM "MemoryEntry"
  WHERE "camada" = 'PROJETO' AND "supersededById" IS NULL AND "chave" IS NOT NULL AND "chave" <> ''
  ORDER BY "projectId", "chave", "createdAt" DESC
) AS novo
WHERE velho."camada" = 'PROJETO' AND velho."supersededById" IS NULL
  AND velho."projectId" = novo."projectId" AND velho."chave" = novo."chave" AND velho.id <> novo.id;
