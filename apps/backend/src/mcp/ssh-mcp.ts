/**
 * Ferramenta MCP "servidores-ssh" (stdio), iniciada pela IA em cada sessão de um projeto que tem servidores SSH.
 * Ela NÃO tem a chave nem roda nada sozinha: cada comando vira um pedido (SshPedido, PENDENTE) que aparece na
 * conversa com Permitir/Recusar. A API roda o comando só depois do "Permitir" e grava a saída; esta ferramenta
 * espera a decisão e devolve o resultado à IA. Ninguém respondeu a tempo → EXPIRADO.
 *
 * Ambiente: DATABASE_URL, NIVOO_PROJETO_ID, NIVOO_JOB_ID ou NIVOO_MENSAGEM_ID, NIVOO_SSH_SERVIDORES (JSON
 * [{id, nome, host, usuario}] — sem segredos), NIVOO_SSH_ESPERA_SEG (padrão 840).
 */
import { PrismaClient } from '@prisma/client';

type Servidor = { id: string; nome: string; host: string; usuario: string };

const servidores: Servidor[] = JSON.parse(process.env.NIVOO_SSH_SERVIDORES ?? '[]');
const espera = Number(process.env.NIVOO_SSH_ESPERA_SEG ?? 840) * 1000;
const intervalo = Number(process.env.NIVOO_SSH_INTERVALO_MS ?? 1500);
const prisma = new PrismaClient();

const FERRAMENTAS = [
  {
    name: 'listar_servidores',
    description: 'Lista os servidores SSH que este projeto pode usar (nome, endereço e usuário).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'executar_no_servidor',
    description:
      'Pede para rodar UM comando de shell num servidor SSH do projeto. O usuário precisa PERMITIR cada comando na tela antes de ele rodar; ' +
      'a ferramenta espera a decisão e devolve a saída (ou "recusado"). Explique o motivo em "motivo". Agrupe o que for possível num só comando ' +
      '(ex.: "cd /app && git pull && pm2 restart app") para pedir menos vezes.',
    inputSchema: {
      type: 'object',
      properties: {
        servidor: { type: 'string', description: 'Nome do servidor (como em listar_servidores)' },
        comando: { type: 'string', description: 'Comando de shell a rodar no servidor' },
        motivo: { type: 'string', description: 'Por que este comando é necessário (aparece para o usuário)' },
      },
      required: ['servidor', 'comando', 'motivo'],
    },
  },
];

const texto = (t: string, erro = false) => ({ content: [{ type: 'text', text: t }], ...(erro ? { isError: true } : {}) });
const dormir = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

async function executar(args: any) {
  const nome = String(args?.servidor ?? '').trim();
  const s = servidores.find((x) => x.nome.toLowerCase() === nome.toLowerCase() || x.id === nome);
  if (!s) return texto(`Servidor "${nome}" não está liberado para este projeto. Use listar_servidores. Disponíveis: ${servidores.map((x) => x.nome).join(', ') || 'nenhum'}.`, true);
  const comando = String(args?.comando ?? '').trim();
  if (!comando || comando.length > 4000) return texto('Comando vazio ou longo demais (máximo 4000 caracteres).', true);
  const pedido = await prisma.sshPedido.create({
    data: {
      projectId: process.env.NIVOO_PROJETO_ID!,
      servidorId: s.id,
      servidorNome: s.nome,
      comando,
      motivo: String(args?.motivo ?? '').slice(0, 1000),
      jobId: process.env.NIVOO_JOB_ID || null,
      mensagemId: process.env.NIVOO_MENSAGEM_ID || null,
    },
  });
  const limite = Date.now() + espera;
  while (Date.now() < limite) {
    await dormir(intervalo);
    const p = await prisma.sshPedido.findUnique({ where: { id: pedido.id } });
    if (!p) return texto('O pedido sumiu (projeto excluído?).', true);
    if (p.status === 'RECUSADO') return texto(`O usuário RECUSOU este comando${p.decididoPor ? ` (${p.decididoPor})` : ''}. Não insista no mesmo comando; siga sem ele ou proponha outro caminho explicando o porquê.`, true);
    if (p.status === 'EXECUTADO' || p.status === 'FALHOU') {
      return texto(`Permitido por ${p.decididoPor ?? 'usuário'} e executado em ${s.nome} (${s.usuario}@${s.host}). Código de saída: ${p.exitCode}.\n\n${p.saida ?? ''}`, p.status === 'FALHOU');
    }
  }
  await prisma.sshPedido.updateMany({ where: { id: pedido.id, status: 'PENDENTE' }, data: { status: 'EXPIRADO', terminadoEm: new Date() } });
  return texto('Ninguém permitiu este comando a tempo (pedido expirado). Diga ao usuário o que você precisa rodar e por quê, e siga com o que dá sem ele.', true);
}

async function tratar(m: any) {
  const responder = (result: unknown) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: m.id, result })}\n`);
  const erro = (code: number, message: string) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: m.id, error: { code, message } })}\n`);
  if (m.method === 'initialize') {
    return responder({ protocolVersion: m.params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'nivoo-servidores-ssh', version: '1' } });
  }
  if (m.id === undefined) return; // notificações
  if (m.method === 'tools/list') return responder({ tools: FERRAMENTAS });
  if (m.method === 'ping') return responder({});
  if (m.method === 'tools/call') {
    const nome = m.params?.name;
    if (nome === 'listar_servidores') return responder(texto(servidores.map((s) => `- ${s.nome}: ${s.usuario}@${s.host}`).join('\n') || 'Nenhum servidor liberado para este projeto.'));
    if (nome === 'executar_no_servidor') {
      try {
        return responder(await executar(m.params?.arguments));
      } catch (e: any) {
        return responder(texto(`Falha ao registrar o pedido: ${e?.message ?? e}`, true));
      }
    }
    return erro(-32602, `ferramenta desconhecida: ${nome}`);
  }
  return erro(-32601, `método não suportado: ${m.method}`);
}

let buffer = '';
process.stdin.on('data', (d) => {
  buffer += d;
  let i: number;
  while ((i = buffer.indexOf('\n')) >= 0) {
    const linha = buffer.slice(0, i).trim();
    buffer = buffer.slice(i + 1);
    if (!linha) continue;
    try {
      void tratar(JSON.parse(linha));
    } catch {
      /* linha inválida: ignora */
    }
  }
});
process.stdin.on('end', () => void prisma.$disconnect().finally(() => process.exit(0)));
