-- Trava de gasto do trabalho passa a ser opcional (0 = sem trava; o limite do projeto, se houver, vale).
ALTER TABLE "Job" ALTER COLUMN "maxCostUsd" SET DEFAULT 0;
-- Trabalhos não concluídos que estavam com a trava padrão antiga (US$ 5) ficam sem trava.
UPDATE "Job" SET "maxCostUsd" = 0 WHERE "maxCostUsd" = 5 AND "status" <> 'CONCLUIDO';
