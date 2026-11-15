import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { PrismaService } from '../prisma/prisma.service';
import { gravarConexoes, listarConexoes } from './connections';
import { apagarSegredosDaConexao } from './secrets';

/**
 * Remove o "Gemini pela conta Google" (encerrado pelo Google): as conexões dele saem (com login e pasta),
 * e projetos, trabalhos em andamento e listas de reserva passam para outra IA conectada. Idempotente;
 * roda na atualização (seed). Devolve os nomes das conexões removidas.
 */
export async function removerGeminiConta(prisma: PrismaService): Promise<string[]> {
  const ehGeminiConta = (id: unknown) => /^gemini-cli(--|$)/.test(String(id ?? ''));
  const todas = listarConexoes();
  const sairam = todas.filter((c) => ehGeminiConta(c.id) || (c.tipo as string) === 'gemini-cli');
  if (sairam.length) {
    let restantes = todas.filter((c) => !sairam.includes(c));
    if (restantes.length && !restantes.some((c) => c.padrao)) restantes = restantes.map((c, i) => ({ ...c, padrao: i === 0 }));
    gravarConexoes(restantes);
    for (const c of sairam) {
      apagarSegredosDaConexao(c.id);
      if (c.id !== 'gemini-cli') fs.rmSync(path.join(os.homedir(), '.nivoo-ia', c.id), { recursive: true, force: true });
    }
  }
  fs.rmSync(path.join(os.homedir(), '.gemini', 'oauth_creds.json'), { force: true }); // login antigo do Gemini pela conta
  const restantes = listarConexoes();
  const nova = restantes.find((c) => c.padrao)?.id ?? restantes[0]?.id ?? 'claude-code-cli';
  for (const p of await prisma.project.findMany({ select: { id: true, provider: true, aiReserva: true, aiModels: true } })) {
    const reserva = Array.isArray(p.aiReserva) ? (p.aiReserva as unknown[]).map(String) : [];
    const modelos = { ...((p.aiModels ?? {}) as Record<string, string>) };
    const tinha = Object.keys(modelos).some(ehGeminiConta) || reserva.some(ehGeminiConta) || ehGeminiConta(p.provider);
    if (!tinha) continue;
    for (const k of Object.keys(modelos)) if (ehGeminiConta(k)) delete modelos[k];
    await prisma.project.update({
      where: { id: p.id },
      data: { provider: ehGeminiConta(p.provider) ? nova : p.provider, aiReserva: reserva.filter((x) => !ehGeminiConta(x)), aiModels: modelos },
    });
  }
  const passos = await prisma.step.findMany({ where: { provider: { startsWith: 'gemini-cli' }, status: { not: 'CONCLUIDO' } }, select: { id: true, job: { select: { project: { select: { provider: true } } } } } });
  for (const st of passos) await prisma.step.update({ where: { id: st.id }, data: { provider: st.job.project.provider } });
  await prisma.job.updateMany({ where: { defaultProvider: { startsWith: 'gemini-cli' }, status: { not: 'CONCLUIDO' } }, data: { defaultProvider: nova } });
  return sairam.map((c) => c.nome);
}
