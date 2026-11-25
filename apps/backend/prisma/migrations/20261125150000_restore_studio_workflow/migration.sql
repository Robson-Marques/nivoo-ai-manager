-- Restore the original template, without moving projects or deleting any version.
BEGIN;
WITH retired AS (
  SELECT a.id, a."instructionsVersion", current_rule.reason, old_rule.text, old_rule.sha256
  FROM "Area" a
  JOIN "AreaInstruction" current_rule ON current_rule."areaId" = a.id AND current_rule.version = a."instructionsVersion"
  JOIN LATERAL (
    SELECT prev.text, prev.sha256 FROM "AreaInstruction" prev
    WHERE prev."areaId" = a.id AND prev.version < (
      SELECT MAX(r.version) FROM "AreaInstruction" r
      WHERE r."areaId" = a.id AND r.reason = 'Substituição do Studio Workflow por Software e Skills nativas; versões anteriores preservadas'
    ) ORDER BY prev.version DESC LIMIT 1
  ) old_rule ON true
  WHERE a."retiredStudioWorkflow" = true AND a.template = 'software'
), restored_rules AS (
  INSERT INTO "AreaInstruction" (id, "areaId", version, text, sha256, author, reason, "createdAt")
  SELECT gen_random_uuid()::text, id, "instructionsVersion" + 1, text, sha256,
    'sistema', 'Restauração da metodologia Studio Workflow; histórico preservado', CURRENT_TIMESTAMP
  FROM retired
  WHERE reason = 'Substituição do Studio Workflow por Software e Skills nativas; versões anteriores preservadas'
  RETURNING "areaId", version
)
UPDATE "Area" a SET
  template = 'studio-workflow', "retiredStudioWorkflow" = false,
  name = CASE WHEN a.name = 'Software — Skills' THEN 'Software — Studio Workflow' ELSE a.name END,
  description = CASE WHEN a.description = 'Software com Skills nativas do Nivoo, arquitetura, segurança, testes e Design System.'
    THEN 'Software com Studio Workflow e Skills nativas complementares.' ELSE a.description END,
  "instructionsVersion" = COALESCE((SELECT version FROM restored_rules r WHERE r."areaId" = a.id), a."instructionsVersion"),
  "updatedAt" = CURRENT_TIMESTAMP
WHERE a.id IN (SELECT id FROM retired);
COMMIT;
