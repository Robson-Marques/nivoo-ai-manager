import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { apagarSegredosDaConexao, gravarSegredoDaConexao, segredoDaConexao } from '../accounts/secrets';
import { minimalEnv } from '../common/exec';
import { appConfig } from '../config';
import { servidoresDoProjeto, ServidorSsh } from '../ssh/servidores';

/**
 * Ferramentas MCP (Model Context Protocol) que as IAs dos projetos podem usar: GitHub, documentação,
 * banco de dados… Cada uma é um programa que roda no servidor (comando local, via stdio) ou um endereço
 * (HTTP). Ficam em `mcp.json` (600) ao lado das conexões; valores secretos (tokens, senhas) ficam em
 * `segredos.json` sob `mcp--<id>/<NOME>` e nunca voltam pela API nem entram no texto da IA. Cada uma vale para
 * todos os projetos ou só para os escolhidos.
 */
export interface Mcp {
  id: string;
  nome: string;
  tipo: 'comando' | 'http';
  comando?: string;
  args?: string[];
  /** Variáveis não secretas (ex.: MODO=leitura). As secretas só têm o nome aqui. */
  variaveis?: Record<string, string>;
  segredos?: string[];
  url?: string;
  /** Cabeçalhos HTTP cujo valor é secreto (ex.: Authorization) — só o nome aqui. */
  cabecalhosSecretos?: string[];
  projetos: 'todos' | string[];
  ativo: boolean;
  criadaEm: string;
}

/** Como a sessão de IA recebe a ferramenta: já com os segredos (só em memória, na hora de rodar). */
export interface McpResolvido {
  nome: string;
  tipo: 'comando' | 'http';
  comando?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

const NOME_VARIAVEL = /^[A-Z_][A-Z0-9_]{0,63}$/;
const NOME_CABECALHO = /^[A-Za-z][A-Za-z0-9-]{0,63}$/;

function arquivo(): string {
  return process.env.NIVOO_MCP_FILE ?? path.join(path.dirname(appConfig().workspacesRoot), 'mcp.json');
}

export function listarMcp(): Mcp[] {
  try {
    const l = JSON.parse(fs.readFileSync(arquivo(), 'utf8'));
    return Array.isArray(l) ? l : [];
  } catch {
    return [];
  }
}

function gravar(lista: Mcp[]): void {
  const alvo = arquivo();
  fs.mkdirSync(path.dirname(alvo), { recursive: true });
  const tmp = `${alvo}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(lista, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, alvo);
}

export function acharMcp(id: string): Mcp {
  const m = listarMcp().find((x) => x.id === id);
  if (!m) throw new NotFoundException('Ferramenta MCP não encontrada');
  return m;
}

/** Nome que a IA vê (ex.: "github"): minúsculas, números e hífen; único. */
function baseTecnica(nome:string):string{
  return nome.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,40)||'mcp';
}
/** Allocate over the full persisted inventory, including disabled tools.
 * Reserve the internal SSH name. Every caller receives the same mapping. */
export function nomesTecnicos(existentes:readonly Pick<Mcp,'id'|'nome'>[]):Map<string,string>{
  const used=new Set(['servidores-ssh','constructor','prototype','__proto__']);
  const result=new Map<string,string>();
  for(const m of existentes){
    const base=baseTecnica(m.nome);let n=base,i=2;
    while(used.has(n))n=base+'-'+i++;
    used.add(n);result.set(m.id,n);
  }
  return result;
}
function nomeTecnico(nome:string,existentes:Mcp[],proprio:string):string{
  const all=existentes.some(m=>m.id===proprio)?existentes:[...existentes,{id:proprio,nome}];
  return nomesTecnicos(all).get(proprio)!;
}

/** Visão para a tela: segredos só aparecem como "definido / falta". */
export function paraTela(m: Mcp) {
  const segredos = [...(m.segredos ?? []), ...(m.cabecalhosSecretos ?? [])].map((s) => ({ nome: s, definido: !!segredoDaConexao(`mcp--${m.id}`, s as never) }));
  return { ...m, nomeTecnico: nomeTecnico(m.nome, listarMcp(), m.id), segredos };
}

/**
 * Valida e grava (criar ou editar). Corpo: { nome, tipo, comando, args (lista ou texto), variaveis {K:v},
 * segredos {K:valor} (valor vazio = mantém o atual; null = apaga), url, cabecalhos {Nome:valor} (secretos),
 * projetos ('todos' | ids), ativo }.
 */
export function salvarMcp(body: any, id?: string): Mcp {
  const lista = listarMcp();
  const atual = id ? lista.find((m) => m.id === id) : undefined;
  if (id && !atual) throw new NotFoundException('Ferramenta MCP não encontrada');
  const nome = String(body?.nome ?? atual?.nome ?? '').trim().slice(0, 60);
  if (!nome) throw new BadRequestException('Dê um nome à ferramenta (ex.: GitHub da empresa)');
  const tipo = (body?.tipo ?? atual?.tipo) === 'http' ? 'http' : 'comando';
  const m: Mcp = { id: atual?.id ?? randomBytes(4).toString('hex'), nome, tipo, projetos: 'todos', ativo: body?.ativo ?? atual?.ativo ?? true, criadaEm: atual?.criadaEm ?? new Date().toISOString() };
  const segredosNovos: Record<string, string | null> = {};
  if (tipo === 'comando') {
    const comando = String(body?.comando ?? atual?.comando ?? '').trim();
    if (!/^[\w@./+-]{1,200}$/.test(comando)) throw new BadRequestException('Comando inválido: só o nome do programa (ex.: npx, uvx, node, python3)');
    m.comando = comando;
    const args = Array.isArray(body?.args) ? body.args.map(String) : typeof body?.args === 'string' ? partirArgumentos(body.args) : atual?.args ?? [];
    if (args.length > 50 || args.some((a: string) => a.length > 500)) throw new BadRequestException('Argumentos demais ou longos demais');
    m.args = args;
  } else {
    const url = String(body?.url ?? atual?.url ?? '').trim();
    if (!/^https?:\/\/[^\s]+$/.test(url) || /^https?:\/\/[^/]*@/.test(url)) throw new BadRequestException('Endereço inválido (use https://… e coloque tokens em "cabeçalhos", não no endereço)');
    m.url = url;
  }
  const variaveis = body?.variaveis ?? atual?.variaveis ?? {};
  m.variaveis = {};
  for (const [k, v] of Object.entries(variaveis)) {
    if (!NOME_VARIAVEL.test(k)) throw new BadRequestException(`Nome de variável inválido: ${k} (use MAIÚSCULAS, ex.: API_KEY)`);
    m.variaveis[k] = String(v).slice(0, 2000);
  }
  // Segredos (variáveis secretas ou cabeçalhos): nomes ficam no mcp.json, valores em segredos.json.
  m.segredos = [...(atual?.segredos ?? [])];
  m.cabecalhosSecretos = [...(atual?.cabecalhosSecretos ?? [])];
  for (const [k, v] of Object.entries(body?.segredos ?? {})) {
    if (!NOME_VARIAVEL.test(k)) throw new BadRequestException(`Nome de variável secreta inválido: ${k}`);
    if (v === null) m.segredos = m.segredos.filter((s) => s !== k);
    else if (!m.segredos.includes(k)) m.segredos.push(k);
    segredosNovos[k] = v === null ? null : String(v);
  }
  for (const [k, v] of Object.entries(body?.cabecalhos ?? {})) {
    if (!NOME_CABECALHO.test(k)) throw new BadRequestException(`Nome de cabeçalho inválido: ${k}`);
    if (v === null) m.cabecalhosSecretos = m.cabecalhosSecretos.filter((s) => s !== k);
    else if (!m.cabecalhosSecretos.includes(k)) m.cabecalhosSecretos.push(k);
    segredosNovos[k] = v === null ? null : String(v);
  }
  const projetos = body?.projetos ?? atual?.projetos ?? 'todos';
  if(projetos!=='todos'&&(!Array.isArray(projetos)||projetos.length>500||projetos.some(p=>typeof p!=='string'||!p.trim())))throw new BadRequestException('Escopo de projetos inválido; escolha projetos ou todos explicitamente.');
  m.projetos=projetos==='todos'?'todos':[...new Set(projetos as string[])];
  const nova = atual ? lista.map((x) => (x.id === m.id ? m : x)) : [...lista, m];
  gravar(nova);
  for (const [k, v] of Object.entries(segredosNovos)) {
    if (v === null) gravarSegredoDaConexao(`mcp--${m.id}`, k as never, null);
    else if (v !== '') gravarSegredoDaConexao(`mcp--${m.id}`, k as never, v);
  }
  return m;
}

export function removerMcp(id: string): void {
  acharMcp(id);
  gravar(listarMcp().filter((m) => m.id !== id));
  apagarSegredosDaConexao(`mcp--${id}`);
}

/** Ferramentas ativas deste projeto, com segredos preenchidos (para a sessão de IA). */
export function mcpDoProjeto(projectId: string, origem: { jobId?: string; mensagemId?: string } = {}): McpResolvido[] {
  const todas = listarMcp();
  const lista = todas.filter((m) => m.ativo===true && (m.projetos === 'todos' || (Array.isArray(m.projetos)&&m.projetos.includes(projectId)))).map((m) => resolver(m, todas));
  // Servidores SSH do projeto: a ferramenta do próprio Nivoo, em que cada comando espera a permissão do usuário.
  const ssh = servidoresDoProjeto(projectId);
  if (ssh.length) lista.push(ferramentaSsh(projectId, ssh, origem));
  return lista;
}

/** A ferramenta "servidores-ssh" (sem chave: quem roda o comando, depois do Permitir, é a API). */
function ferramentaSsh(projectId: string, ssh: ServidorSsh[], origem: { jobId?: string; mensagemId?: string }): McpResolvido {
  // Em produção, __dirname é dist/mcp e o .js está ao lado. Nos testes, __dirname é src/mcp; se o projeto já foi
  // compilado (dist/mcp/ssh-mcp.js), roda o .js compilado (rápido e estável) em vez de transpilar com ts-node a cada
  // chamada — ts-node a cada spawn num runner lento pode estourar o tempo do teste.
  const candidatos = [path.join(__dirname, 'ssh-mcp.js'), path.join(__dirname.replace(/(^|\/)src(\/|$)/, '$1dist$2'), 'ssh-mcp.js')];
  const js = candidatos.find((c) => fs.existsSync(c));
  const args = js ? [js] : ['-r', 'ts-node/register/transpile-only', path.join(__dirname, 'ssh-mcp.ts')];
  return {
    nome: 'servidores-ssh',
    tipo: 'comando',
    comando: process.execPath,
    args,
    env: {
      DATABASE_URL: process.env.DATABASE_URL ?? '',
      NIVOO_PROJETO_ID: projectId,
      ...(origem.jobId ? { NIVOO_JOB_ID: origem.jobId } : {}),
      ...(origem.mensagemId ? { NIVOO_MENSAGEM_ID: origem.mensagemId } : {}),
      NIVOO_SSH_SERVIDORES: JSON.stringify(ssh.map((s) => ({ id: s.id, nome: s.nome, host: s.host, usuario: s.usuario }))),
      ...(process.env.NIVOO_SSH_ESPERA_SEG ? { NIVOO_SSH_ESPERA_SEG: process.env.NIVOO_SSH_ESPERA_SEG } : {}),
      ...(process.env.NIVOO_SSH_INTERVALO_MS ? { NIVOO_SSH_INTERVALO_MS: process.env.NIVOO_SSH_INTERVALO_MS } : {}),
    },
  };
}

function resolver(m: Mcp, todas: Mcp[] = listarMcp()): McpResolvido {
  const segredo = (k: string) => segredoDaConexao(`mcp--${m.id}`, k as never) ?? '';
  const env: Record<string, string> = { ...(m.variaveis ?? {}) };
  for (const k of m.segredos ?? []) env[k] = segredo(k);
  const r: McpResolvido = { nome: nomeTecnico(m.nome, todas, m.id), tipo: m.tipo };
  if (m.tipo === 'comando') Object.assign(r, { comando: m.comando, args: m.args ?? [], env });
  else {
    const headers: Record<string, string> = {};
    for (const k of m.cabecalhosSecretos ?? []) headers[k] = segredo(k);
    Object.assign(r, { url: m.url, headers });
  }
  return r;
}

/** "npx -y pacote-mcp --modo leitura" → ["-y", "pacote-mcp", "--modo", "leitura"] (aspas respeitadas). */
export function partirArgumentos(texto: string): string[] {
  const out: string[] = [];
  for (const m of texto.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

/**
 * Testa a ferramenta: liga, faz o aperto de mão do MCP (initialize) e pede a lista de ferramentas (tools/list).
 * Devolve os nomes e descrições, ou o erro legível.
 */
export async function testarMcp(id: string, timeoutMs = 60_000): Promise<{ ok: boolean; ferramentas: Array<{ nome: string; descricao: string }>; erro?: string }> {
  const r = resolver(acharMcp(id));
  try {
    const ferramentas = r.tipo === 'comando' ? await testarComando(r, timeoutMs) : await testarHttp(r, timeoutMs);
    return { ok: true, ferramentas };
  } catch (e: any) {
    return { ok: false, ferramentas: [], erro: ocultarSegredosMcp(String(e?.message ?? e),r).slice(0,600) };
  }
}

export function ocultarSegredosMcp(texto:string,r:McpResolvido):string{
  const values=[...Object.values(r.env??{}),...Object.values(r.headers??{})].filter(Boolean).sort((a,b)=>b.length-a.length);
  for(const v of values){
    texto=texto.split(v).join('[ocultado]');
    // HTTP credentials are often echoed without the Bearer prefix.
    const bearer=/^Bearer\s+(.+)$/i.exec(v)?.[1];
    if(bearer)texto=texto.split(bearer).join('[ocultado]');
  }
  return texto;
}

const INICIAR = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'nivoo', version: '1' } } };
const LISTAR = { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} };

function ferramentasDe(res: any): Array<{ nome: string; descricao: string }> {
  if (res?.error) throw new Error(`a ferramenta respondeu erro: ${res.error.message ?? JSON.stringify(res.error)}`);
  return (res?.result?.tools ?? []).map((t: any) => ({ nome: String(t.name), descricao: String(t.description ?? '').slice(0, 300) }));
}

function testarComando(r: McpResolvido, timeoutMs: number): Promise<Array<{ nome: string; descricao: string }>> {
  return new Promise((ok, falha) => {
    const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'nivoo-mcp-'));
    const p = spawn(r.comando!, r.args ?? [], { cwd: pasta, env: minimalEnv({ ...(r.env ?? {}), HOME: process.env.HOME ?? os.homedir() }, ['PATH']), stdio: ['pipe', 'pipe', 'pipe'] });
    let saida = '';
    let erros = '';
    let fim = false;
    const terminar = (e: Error | null, v?: Array<{ nome: string; descricao: string }>) => {
      if (fim) return;
      fim = true;
      clearTimeout(t);
      p.kill('SIGTERM');
      fs.rmSync(pasta, { recursive: true, force: true });
      if (e) falha(e);
      else ok(v!);
    };
    const t = setTimeout(() => terminar(new Error(`a ferramenta não respondeu em ${timeoutMs / 1000} s${erros ? `: ${erros.trim().slice(-300)}` : ''}`)), timeoutMs);
    p.on('error', (e) => terminar(new Error(`não consegui iniciar "${r.comando}": ${e.message} (o programa está instalado no servidor?)`)));
    p.on('exit', (c) => terminar(new Error(`a ferramenta fechou (código ${c})${erros ? `: ${erros.trim().slice(-400)}` : ''}`)));
    p.stdin.on('error', () => undefined);
    p.stderr.on('data', (d) => (erros = (erros + d).slice(-4000)));
    p.stdout.on('data', (d) => {
      saida += d;
      let i: number;
      while ((i = saida.indexOf('\n')) >= 0) {
        const linha = saida.slice(0, i).trim();
        saida = saida.slice(i + 1);
        if (!linha) continue;
        let msg: any;
        try {
          msg = JSON.parse(linha);
        } catch {
          continue;
        }
        if (msg.id === 1) {
          if (msg.error) return terminar(new Error(`a ferramenta recusou o início: ${msg.error.message}`));
          p.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
          p.stdin.write(`${JSON.stringify(LISTAR)}\n`);
        } else if (msg.id === 2) {
          try {
            terminar(null, ferramentasDe(msg));
          } catch (e: any) {
            terminar(e);
          }
        }
      }
    });
    p.stdin.write(`${JSON.stringify(INICIAR)}\n`);
  });
}

async function testarHttp(r: McpResolvido, timeoutMs: number): Promise<Array<{ nome: string; descricao: string }>> {
  const base = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(r.headers ?? {}) };
  const enviar = async (corpo: unknown, sessao?: string) => {
    const res = await fetch(r.url!, { method: 'POST', headers: { ...base, ...(sessao ? { 'Mcp-Session-Id': sessao } : {}) }, body: JSON.stringify(corpo), signal: AbortSignal.timeout(timeoutMs) });
    const texto = await res.text();
    if (res.status === 401 || res.status === 403) throw new Error(`o servidor recusou o acesso (${res.status}): confira o token nos cabeçalhos`);
    if (!res.ok && res.status !== 202) throw new Error(`o servidor respondeu ${res.status}: ${texto.slice(0, 200)}`);
    // Resposta em JSON ou em SSE ("data: {...}").
    const json = /^\s*\{/.test(texto) ? texto : texto.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).pop() ?? '';
    return { sessao: res.headers.get('mcp-session-id') ?? sessao, msg: json ? JSON.parse(json) : null };
  };
  const ini = await enviar(INICIAR);
  if (ini.msg?.error) throw new Error(`a ferramenta recusou o início: ${ini.msg.error.message}`);
  await enviar({ jsonrpc: '2.0', method: 'notifications/initialized' }, ini.sessao ?? undefined).catch(() => undefined);
  const lista = await enviar(LISTAR, ini.sessao ?? undefined);
  return ferramentasDe(lista.msg);
}

/** Modelos prontos para a tela (o usuário completa o token, quando houver). */
export const MCP_PRONTOS = [
  { chave: 'context7', nome: 'Documentação (Context7)', descricao: 'Documentação atualizada de bibliotecas e frameworks.', tipo: 'http', url: 'https://mcp.context7.com/mcp', cabecalhos: ['CONTEXT7_API_KEY'] },
  { chave: 'github', nome: 'GitHub', descricao: 'Issues, pull requests e repositórios do GitHub (token pessoal).', tipo: 'http', url: 'https://api.githubcopilot.com/mcp/', cabecalhos: ['Authorization'], dica: 'Authorization = "Bearer <seu token do GitHub>"' },
  { chave: '21st', nome: '21st.dev', descricao: 'Catálogo de componentes React/Tailwind. Pesquisa e código conforme a cota da conta; geração hospedada é opcional e pode cobrar créditos.', tipo: 'http', url: 'https://21st.dev/api/mcp', cabecalhos: ['x-api-key'], dica: 'Obtenha uma chave atual em 21st.dev/mcp. Use somente nos projetos escolhidos.', ajudaUrl: 'https://21st.dev/mcp', somenteProjetosEscolhidos: true },
];
