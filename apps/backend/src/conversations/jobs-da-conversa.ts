/** Trabalhos criados a partir desta conversa (planos aprovados). */
export async function jobsDaConversa(prisma: { conversationMessage: { findMany: (a: any) => Promise<Array<{ jobId: string | null }>> } }, conversationId: string): Promise<string[]> {
  const ms = await prisma.conversationMessage.findMany({ where: { conversationId, NOT: { jobId: null } }, select: { jobId: true } });
  return [...new Set(ms.map((m) => m.jobId).filter((x): x is string => !!x))];
}

/** Quantas vezes a conversa tenta corrigir sozinha um trabalho que parou, por pedido do usuário, antes de pedir ajuda. */
const AUTOCORRIGIR_MAX = Number(process.env.NIVOO_AUTOCORRIGIR_MAX ?? 3);

/**
 * Trabalho parou (bloqueado ou com falha): a conversa de onde ele veio recebe o ERRO como uma "entrega" pendente, para
 * a IA da conversa DIAGNOSTICAR e PROPOR UM PLANO que conserta (auto-correção) — que roda sozinho se o projeto estiver
 * em "seguir sozinho". Para não entrar em loop/custo, só tenta até AUTOCORRIGIR_MAX vezes desde a última fala do
 * usuário; passado disso, para e pede ajuda no chat.
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
    // Parada pedida pelo usuário (pausar/interromper) não é erro: não auto-corrige nem avisa de erro.
    if (/INTERROMPIDO|PAUSAD/i.test(motivo)) return;
    const origem = await prisma.conversationMessage.findFirst({ where: { jobId, kind: 'plano' }, select: { conversationId: true } });
    if (!origem) return;
    const conversationId = origem.conversationId as string;
    const job = await prisma.job.findUnique({ where: { id: jobId }, select: { title: true } });
    // Quantas auto-correções já tentei desde a última fala do usuário (contando só trabalhos que pararam)?
    const ultimaUsuario = await prisma.conversationMessage.findFirst({ where: { conversationId, role: 'USUARIO' }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } });
    const entregasRecentes = await prisma.conversationMessage.findMany({
      where: { conversationId, kind: 'entrega', jobId: { not: null }, ...(ultimaUsuario ? { createdAt: { gt: ultimaUsuario.createdAt } } : {}) },
      select: { jobId: true },
    });
    const ids = [...new Set(entregasRecentes.map((m) => m.jobId).filter((x): x is string => !!x && x !== jobId))];
    const jaTentadas = ids.length ? await prisma.job.count({ where: { id: { in: ids }, status: { in: ['BLOQUEADO', 'FALHOU'] } } }) : 0;
    // Falha de critério final não é autorização para abrir um NOVO plano
    // automaticamente: a tela do trabalho já mostra revisão e arquivos.
    // Antes ela criava entrega pendente + plano de "conserto" duplicando
    // o resultado e gerando outro ciclo de IA sem corrigir a origem.
    if (/crit[eé]rio n[aã]o atendido:|conferencia-regras|revis[aã]o final/i.test(motivo)) return;
    if (jaTentadas < AUTOCORRIGIR_MAX) {
      // A IA da conversa recebe o erro (como entrega pendente) e propõe o conserto; roda sozinho se "seguir sozinho".
      await prisma.$transaction(async (tx: any) => {
        const m = await tx.conversationMessage.create({ data: { conversationId, role: 'ASSISTENTE', content: '', status: 'PENDENTE', kind: 'entrega', jobId } });
        await tx.queueTask.create({ data: { type: 'PLAN_MESSAGE', messageId: m.id } });
      });
      return;
    }
    // Já tentei corrigir demais sem o usuário falar: paro e peço ajuda, para não gastar à toa.
    await prisma.conversationMessage.create({
      data: {
        conversationId,
        role: 'ASSISTENTE',
        status: 'PRONTA',
        kind: 'sistema',
        jobId,
        content: `O trabalho "${job?.title ?? ''}" parou de novo e já tentei corrigir sozinho ${jaTentadas}x: ${motivo.replace(/\s+/g, ' ').slice(0, 300)}. Me diga aqui como seguir (ou ajuste o pedido).`,
      },
    });
  } catch {
    /* aviso é melhor esforço */
  }
}
