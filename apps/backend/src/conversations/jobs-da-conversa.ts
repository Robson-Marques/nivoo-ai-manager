/** Trabalhos criados a partir desta conversa (planos aprovados). */
export async function jobsDaConversa(prisma: { conversationMessage: { findMany: (a: any) => Promise<Array<{ jobId: string | null }>> } }, conversationId: string,cutoff?:Date): Promise<string[]> {
  const ms = await prisma.conversationMessage.findMany({ where: { conversationId, NOT: { jobId: null },...(cutoff?{createdAt:{lte:cutoff}}:{}) }, select: { jobId: true } });
  return [...new Set(ms.map((m) => m.jobId).filter((x): x is string => !!x))];
}

/**
 * Um trabalho BLOQUEADO/FALHOU já possui estado e diagnóstico persistentes
 * (Job, Step, Attempt, logs). Não publicar uma falsa "entrega" nem agendar
 * PLAN_MESSAGE para uma IA gerar perguntas ou um novo trabalho automaticamente.
 * A mensagem do plano aprovado exibe a parada e o diagnóstico copiável.
 *
 * API preservada para os chamadores do orquestrador/conclusão.
 */
export async function avisarConversaQueParou(
  _prisma: unknown,
  _jobId: string,
  _motivo: string,
): Promise<void> {
  // Nada a publicar: a tela consulta a situação autoritativa do Job.
}
