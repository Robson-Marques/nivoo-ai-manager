import { PrismaService } from '../prisma/prisma.service';
import { ehProblemaDeInfra } from './step-executor.service';

/**
 * Apaga as lições que eram, na verdade, problemas de infraestrutura (programa faltando, IA sem acesso, limite
 * do sistema) — nunca foram aprendizado — e as repetidas (fica uma por projeto, etapa e motivo, a mais antiga
 * que não é de infraestrutura). Roda na atualização (seed). Devolve quantas apagou.
 */
export async function limparLicoes(prisma: PrismaService): Promise<number> {
  const licoes = await prisma.memoryEntry.findMany({ where: { references: { path: ['origem'], equals: 'licao-automatica' } }, orderBy: { createdAt: 'asc' } });
  const vistas = new Set<string>();
  const apagar: string[] = [];
  for (const l of licoes) {
    const r = (l.references ?? {}) as Record<string, unknown>;
    const chave = `${l.projectId}|${r.stepId}|${r.motivo}`;
    // A de infraestrutura sai sem contar como "já vista": a lição verdadeira do mesmo passo fica.
    if (ehProblemaDeInfra(l.content) || vistas.has(chave)) apagar.push(l.id);
    else vistas.add(chave);
  }
  if (apagar.length) await prisma.memoryEntry.deleteMany({ where: { id: { in: apagar } } });
  return apagar.length;
}
