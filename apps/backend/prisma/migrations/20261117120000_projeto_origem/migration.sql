-- Projeto de origem (projeto de vídeo/design feito a partir de outro): vínculo opcional, apaga o vínculo se a origem for removida.
ALTER TABLE "Project" ADD COLUMN "projetoOrigemId" TEXT;
ALTER TABLE "Project" ADD CONSTRAINT "Project_projetoOrigemId_fkey" FOREIGN KEY ("projetoOrigemId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
