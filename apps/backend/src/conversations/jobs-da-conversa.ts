/** Trabalhos criados a partir desta conversa (planos aprovados). */
export async function jobsDaConversa(prisma: { conversationMessage: { findMany: (a: any) => Promise<Array<{ jobId: string | null }>> } }, conversationId: string): Promise<string[]> {
  const ms = await prisma.conversationMessage.findMany({ where: { conversationId, NOT: { jobId: null } }, select: { jobId: true } });
  return [...new Set(ms.map((m) => m.jobId).filter((x): x is string => !!x))];
}
