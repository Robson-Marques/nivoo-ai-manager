/** Conversa do chat em Markdown (usuário por inteiro; respostas longas da IA resumidas no começo e no fim). */
export function conversaComoTexto(msgs: Array<{ role: string; content: string; kind: string | null; createdAt: Date; attachments?: unknown }>): string {
  const partes = ['# Conversa que gerou este trabalho', ''];
  let total = 0;
  for (const m of msgs) {
    const quem = m.role === 'USUARIO' ? 'Usuário' : m.kind === 'sistema' ? 'Sistema' : 'IA';
    const limite = m.role === 'USUARIO' ? 40_000 : 6_000;
    const c = m.content.length > limite ? `${m.content.slice(0, limite / 2)}\n… (cortado) …\n${m.content.slice(-limite / 2)}` : m.content;
    const anexos = Array.isArray(m.attachments) && m.attachments.length ? `\n(anexos: ${m.attachments.map((a: any) => a?.nome).filter(Boolean).join(', ')} — em contexto/anexos/)` : '';
    const bloco = `## ${quem} — ${m.createdAt.toISOString()}\n\n${c}${anexos}\n`;
    total += bloco.length;
    if (total > 600_000) {
      partes.push('… (conversa longa demais: o restante foi omitido) …');
      break;
    }
    partes.push(bloco);
  }
  return partes.join('\n');
}

