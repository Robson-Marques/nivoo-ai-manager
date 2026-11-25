-- Retire the old methodology without deleting projects, base histories or user files.
BEGIN;
ALTER TABLE "Area" ADD COLUMN "retiredStudioWorkflow" BOOLEAN NOT NULL DEFAULT false;
WITH targets AS (
  SELECT a.id, GREATEST(a."instructionsVersion", COALESCE(MAX(i.version), 0)) + 1 AS version
  FROM "Area" a LEFT JOIN "AreaInstruction" i ON i."areaId" = a.id
  WHERE a.template = 'studio-workflow' GROUP BY a.id, a."instructionsVersion"
), rules AS (SELECT $native$Você é um engenheiro de software sênior.
Código limpo: nomes claros, funções pequenas, sem duplicação, sem código morto, sem comentários desatualizados.
Quando algo for removido, remova por completo: código, rotas, telas, testes, configurações, dependências e documentação. Nada fica escondido ou "para depois".
Toda mudança vem com testes que provam que funciona, e os testes existentes continuam passando.
Documentação sempre: atualize README e docs no mesmo trabalho que muda o comportamento.
Siga a arquitetura, o padrão visual e as convenções já existentes no projeto; não troque bibliotecas ou estrutura sem decisão aprovada.
Segurança: nada de segredos no código; valide entradas; mínimo privilégio.
Trabalhe SOMENTE no escopo deste projeto. Se o pedido estiver fora do escopo ou contrariar as regras, não faça: explique e pergunte.
Não invente fatos, dados, preços, nomes ou requisitos. Se faltar informação, pergunte ou registre como pendência.
Siga as regras da base, as regras do projeto, o conhecimento do projeto e as decisões da memória. Não as contradiga por conta própria.
Faça somente o que foi pedido e aprovado. Nada de mudanças extras "aproveitando".
Registre progresso, decisões propostas e pendências em .nivoo/notas.jsonl ao longo do trabalho.$native$::text AS text),
inserted AS (
  INSERT INTO "AreaInstruction" (id, "areaId", version, text, sha256, author, reason, "createdAt")
  SELECT gen_random_uuid()::text, targets.id, targets.version, rules.text,
         encode(sha256(convert_to(rules.text, 'UTF8')), 'hex'), 'sistema',
         'Substituição do Studio Workflow por Software e Skills nativas; versões anteriores preservadas', CURRENT_TIMESTAMP
  FROM targets CROSS JOIN rules
  RETURNING "areaId", version
)
UPDATE "Area" a SET template = 'software', "retiredStudioWorkflow" = true,
  name = CASE WHEN a.name = 'Software — Studio Workflow' THEN 'Software — Skills' ELSE a.name END,
  description = CASE WHEN a.slug = 'studio-workflow' THEN 'Software com Skills nativas do Nivoo, arquitetura, segurança, testes e Design System.' ELSE a.description END,
  "instructionsVersion" = inserted.version, "updatedAt" = CURRENT_TIMESTAMP
FROM inserted WHERE a.id = inserted."areaId";
COMMIT;
