/** Trabalhos criados a partir desta conversa (planos aprovados). */
export async function jobsDaConversa(prisma: { conversationMessage: { findMany: (a: any) => Promise<Array<{ jobId: string | null }>> } }, conversationId: string): Promise<string[]> {
  const ms = await prisma.conversationMessage.findMany({ where: { conversationId, NOT: { jobId: null } }, select: { jobId: true } });
  return [...new Set(ms.map((m) => m.jobId).filter((x): x is string => !!x))];
}

/**
 * Trabalho parou (bloqueado ou com falha): a conversa de onde ele veio recebe um aviso. Sem isso, quem olha só o
 * chat (e a IA da conversa) não sabe que nada está andando.
 */
export async function avisarConversaQueParou(
  prisma: {
    conversationMessage: { findFirst: (a: any) => Promise<{ conversationId: string } | null>; create: (a: any) => Promise<unknown> };
    job: { findUnique: (a: any) => Promise<{ title: string } | null> };
  },
  jobId: string,
  motivo: string,
): Promise<void> {
  try {
    const origem = await prisma.conversationMessage.findFirst({ where: { jobId, kind: 'plano' }, select: { conversationId: true } });
    if (!origem) return;
    const job = await prisma.job.findUnique({ where: { id: jobId }, select: { title: true } });
    await prisma.conversationMessage.create({
      data: {
        conversationId: origem.conversationId,
        role: 'ASSISTENTE',
        status: 'PRONTA',
        kind: 'sistema',
        jobId,
        content: `O trabalho "${job?.title ?? ''}" parou: ${motivo.replace(/\s+/g, ' ').slice(0, 400)}. Veja o que aconteceu no trabalho (acima) — dá para "Tentar de novo", trocar a IA ou me dizer aqui o que fazer.`,
      },
    });
  } catch {
    /* aviso é melhor esforço */
  }
}
