/** Trabalhos criados a partir desta conversa (planos aprovados). */
export async function jobsDaConversa(prisma: { conversationMessage: { findMany: (a: any) => Promise<Array<{ jobId: string | null }>> } }, conversationId: string,cutoff?:Date): Promise<string[]> {
  const ms = await prisma.conversationMessage.findMany({ where: { conversationId, NOT: { jobId: null },...(cutoff?{createdAt:{lte:cutoff}}:{}) }, select: { jobId: true } });
  return [...new Set(ms.map((m) => m.jobId).filter((x): x is string => !!x))];
}

/** Quantas vezes a conversa propõe sozinha um conserto para um trabalho que parou, desde a última fala do usuário, antes de pedir ajuda. */
const AUTOCORRIGIR_MAX = Number(process.env.NIVOO_AUTOCORRIGIR_MAX ?? 3);

/**
 * Trabalho parou (bloqueado ou com falha): a conversa de origem recebe o ERRO como
 * uma "entrega" pendente, para a IA da conversa DIAGNOSTICAR e PROPOR um plano de
 * conserto. O plano é uma PROPOSTA: só vira trabalho quando o usuário aprova
 * ("Fazer"); roda sozinho apenas se o projeto estiver explicitamente em "seguir
 * sozinho". Nada é re-executado automaticamente por conta própria.
 *
 * Guardas (evitam entrega falsa e loop/custo):
 * - Paradas pedidas pelo usuário (pausar/interromper) não são erro: ignoradas.
 * - Falha de critério final / conferência de regras / revisão final NÃO abre
 *   plano de conserto: isso já aparece no próprio trabalho (revisão e arquivos),
 *   e abrir um "conserto" aqui duplicaria o resultado sem corrigir a origem.
 * - No máximo AUTOCORRIGIR_MAX propostas desde a última fala do usuário; passado
 *   disso, para e pede ajuda no chat em vez de gastar à toa.
 */
export async function avisarConversaQueParou(
  prisma: {
    conversationMessage: { findFirst: (a: any) => Promise<any>; findMany: (a: any) => Promise<Array<{ jobId: string | null }>>; create: (a: any) => Promise<any> };
    job: { findUnique: (a: any) => Promise<{ title: string } | null>; count: (a: any) => Promise<number> };
    queueTask: { create: (a: any) => Promise<unknown> };
    $transaction: (fn: (tx: any) => Promise<unknown>) => Promise<unknown>;
  },
  jobId: string,
  motivo: string,
): Promise<void> {
  try {
    // Parada pedida pelo usuário (pausar/interromper) não é erro: não propor conserto.
    // Casar só os REASONS reais (enum em maiúsculas), não a palavra "interrompido"
    // que aparece no DETALHE de outras paradas (ex.: REPETICAO_IMPRODUTIVA diz
    // "...interrompido para não repetir indefinidamente").
    if (/\b(INTERROMPIDO|PAUSAD[AO])\b/.test(motivo)) return;
    const origem = await prisma.conversationMessage.findFirst({ where: { jobId, kind: 'plano' }, select: { conversationId: true } });
    if (!origem) return; // trabalho não veio de uma conversa: a tela do trabalho mostra o estado.
    const conversationId = origem.conversationId as string;
    const job = await prisma.job.findUnique({ where: { id: jobId }, select: { title: true } });
    // Falha de critério/revisão de regras já é visível no trabalho: não propor conserto aqui.
    if (/crit[eé]rio n[aã]o atendido:|conferencia-regras|revis[aã]o final/i.test(motivo)) return;
    const ultimaUsuario = await prisma.conversationMessage.findFirst({ where: { conversationId, role: 'USUARIO' }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } });
    const entregasRecentes = await prisma.conversationMessage.findMany({
      where: { conversationId, kind: 'entrega', jobId: { not: null }, ...(ultimaUsuario ? { createdAt: { gt: ultimaUsuario.createdAt } } : {}) },
      select: { jobId: true },
    });
    const ids = [...new Set(entregasRecentes.map((m) => m.jobId).filter((x): x is string => !!x && x !== jobId))];
    const jaPropostas = ids.length ? await prisma.job.count({ where: { id: { in: ids }, status: { in: ['BLOQUEADO', 'FALHOU'] } } }) : 0;
    if (jaPropostas < AUTOCORRIGIR_MAX) {
      // A IA da conversa recebe o erro (entrega pendente) e PROPÕE o conserto como plano a aprovar.
      await prisma.$transaction(async (tx: any) => {
        const m = await tx.conversationMessage.create({ data: { conversationId, role: 'ASSISTENTE', content: '', status: 'PENDENTE', kind: 'entrega', jobId } });
        await tx.queueTask.create({ data: { type: 'PLAN_MESSAGE', messageId: m.id } });
      });
      return;
    }
    // Já propus conserto demais sem o usuário falar: paro e peço ajuda, para não gastar à toa.
    await prisma.conversationMessage.create({
      data: {
        conversationId, role: 'ASSISTENTE', status: 'PRONTA', kind: 'sistema', jobId,
        content: `O trabalho "${job?.title ?? ''}" parou de novo e já propus conserto ${jaPropostas}x: ${motivo.replace(/\s+/g, ' ').slice(0, 300)}. Me diga aqui como seguir (ou ajuste o pedido).`,
      },
    });
  } catch {
    /* aviso é melhor esforço: nunca derrubar o fluxo de bloqueio por causa do aviso. */
  }
}
