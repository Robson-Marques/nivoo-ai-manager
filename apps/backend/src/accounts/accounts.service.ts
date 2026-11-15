import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import * as fs from 'node:fs';
import { minimalEnv, runProcess } from '../common/exec';
import { PrismaService } from '../prisma/prisma.service';
import { ProviderRegistry } from '../providers/provider-registry.service';
import {
  acharConexao,
  Conexao,
  ehAdicional,
  existeArquivoConexoes,
  gravarConexoes,
  listarConexoes,
  marcarFalhaLogin,
  novoId,
  TIPO_INFO,
  TipoIa,
  TIPOS_IA,
  tipoDe,
} from './connections';
import { LoginSession, LoginSessionsService } from './login-sessions.service';
import { apagarSegredosDaConexao, gravarSegredoDaConexao, isolatedHome, SecretKey, secretSource } from './secrets';

const CHAVE: Partial<Record<TipoIa, SecretKey>> = { 'claude-api': 'ANTHROPIC_API_KEY', 'gemini-api': 'GEMINI_API_KEY' };
/** Nome das conexões que já existiam antes das conexões múltiplas. */
const NOME_ANTIGO: Record<TipoIa, string> = {
  'claude-code-cli': 'Claude (conta)',
  'claude-api': 'Claude (API)',
  'codex-cli': 'ChatGPT (conta)',
  'codex-api': 'ChatGPT (API)',
  'gemini-api': 'Gemini (API)',
};

/**
 * Conexões de IA: quantas contas o usuário quiser (ex.: "ChatGPT 1" e "ChatGPT 2"), pela conta
 * (assinatura) ou por chave de API, cada uma com nome, login e pasta próprios. O projeto escolhe qual usa.
 */
@Injectable()
export class AccountsService {
  constructor(
    private readonly registry: ProviderRegistry,
    private readonly logins: LoginSessionsService,
    private readonly prisma: PrismaService,
  ) {}

  /** Tipos que podem ser criados em "+ Nova". */
  tipos() {
    return TIPOS_IA.map((t) => ({ tipo: t, ...TIPO_INFO[t] }));
  }

  /**
   * Primeira vez: as contas que já estavam conectadas (ou em uso por algum projeto) viram conexões, com
   * os nomes de antes; nada precisa ser reconectado.
   */
  private async migrar(): Promise<void> {
    if (existeArquivoConexoes()) return;
    const usados = new Set((await this.prisma.project.findMany({ select: { provider: true } })).map((p) => p.provider));
    const lista: Conexao[] = [];
    for (const t of TIPOS_IA) {
      const st = await this.registry.status(t, 5_000);
      if (st.available || usados.has(t)) lista.push({ id: t, tipo: t, nome: NOME_ANTIGO[t], padrao: false, criadaEm: new Date().toISOString() });
    }
    if (lista.length) lista[0].padrao = true;
    gravarConexoes(lista);
  }

  /** Conexão existente (ou, para os seis ids antigos, criada na hora: rotas antigas continuam valendo). */
  private conexao(id: string): Conexao {
    const c = acharConexao(id);
    if (c) return c;
    const tipo = tipoDe(id);
    if (!tipo) throw new BadRequestException('IA desconhecida');
    if (ehAdicional(id)) throw new NotFoundException('Conexão não encontrada');
    const lista = listarConexoes();
    const nova: Conexao = { id, tipo, nome: NOME_ANTIGO[tipo], padrao: false, criadaEm: new Date().toISOString() };
    gravarConexoes([...lista, nova]);
    return nova;
  }

  private exigirModo(c: Conexao, modo: 'conta' | 'api'): void {
    if (TIPO_INFO[c.tipo].modo !== modo) throw new BadRequestException(modo === 'api' ? 'Esta conexão é pela conta, não por chave' : 'Esta conexão é por chave de API');
  }

  /** `atualizar`: confere de novo cada conexão agora (botão "testar"), sem usar o resultado guardado. */
  async list(atualizar = false) {
    await this.migrar();
    const projetos = await this.prisma.project.groupBy({ by: ['provider'], _count: { _all: true } });
    return Promise.all(
      listarConexoes().filter((c) => TIPO_INFO[c.tipo]).map(async (c) => {
        const info = TIPO_INFO[c.tipo];
        const st = await this.registry.status(c.id, atualizar ? 0 : 5_000);
        let login: LoginSession | null = null;
        try {
          login = this.logins.get(c.id);
        } catch {
          login = null;
        }
        const chave = CHAVE[c.tipo];
        return {
          id: c.id,
          tipo: c.tipo,
          ia: info.ia,
          modo: info.modo,
          nome: c.nome,
          padrao: c.padrao,
          conta: info.conta ?? null,
          ondeChave: info.ondeChave ?? null,
          instalado: st.installed,
          conectado: st.available,
          desabilitado: st.errors.some((e) => e.includes('desabilitado')),
          configuradoPeloAdministrador:
            !ehAdicional(c.id) && ((c.tipo === 'claude-code-cli' && secretSource('CLAUDE_CODE_OAUTH_TOKEN') === 'ambiente') || (!!chave && secretSource(chave) === 'ambiente')),
          problema: st.available ? null : st.errors.join('; ') || null,
          loginRecusado: !!c.falhaLogin,
          projetos: projetos.find((p) => p.provider === c.id)?._count._all ?? 0,
          login,
        };
      }),
    );
  }

  /** Nova conexão do tipo escolhido, com o nome dado (padrão: "ChatGPT 2", "Claude API 3"...). */
  async create(body: any) {
    await this.migrar();
    const tipo = tipoDe(String(body?.tipo ?? ''));
    if (!tipo || ehAdicional(String(body?.tipo))) throw new BadRequestException(`Tipo desconhecido. Opções: ${TIPOS_IA.join(', ')}`);
    const lista = listarConexoes();
    const nome = this.nomeValido(body?.nome) ?? this.nomeLivre(TIPO_INFO[tipo].nomePadrao, lista);
    if (lista.some((c) => c.nome.toLowerCase() === nome.toLowerCase())) throw new ConflictException('Já existe uma conexão com esse nome');
    const c: Conexao = { id: novoId(tipo, lista), tipo, nome, padrao: !lista.some((x) => x.padrao), criadaEm: new Date().toISOString() };
    gravarConexoes([...lista, c]);
    this.registry.invalidate(c.id);
    return (await this.list()).find((x) => x.id === c.id);
  }

  private nomeValido(raw: unknown): string | null {
    if (raw === undefined || raw === null || String(raw).trim() === '') return null;
    const n = String(raw).trim().replace(/\s+/g, ' ');
    if (n.length > 60) throw new BadRequestException('Nome muito longo (máximo 60 letras)');
    return n;
  }

  private nomeLivre(base: string, lista: Conexao[]): string {
    const usados = new Set(lista.map((c) => c.nome.toLowerCase()));
    if (!usados.has(base.toLowerCase())) return base;
    for (let i = 2; ; i++) if (!usados.has(`${base} ${i}`.toLowerCase())) return `${base} ${i}`;
  }

  /** Renomear e/ou marcar como padrão (a IA escolhida sozinha nos projetos novos). */
  async update(id: string, body: any) {
    await this.migrar();
    const c = this.conexao(id);
    let lista = listarConexoes();
    const nome = this.nomeValido(body?.nome);
    if (nome) {
      if (lista.some((x) => x.id !== id && x.nome.toLowerCase() === nome.toLowerCase())) throw new ConflictException('Já existe uma conexão com esse nome');
      lista = lista.map((x) => (x.id === c.id ? { ...x, nome } : x));
    }
    if (body?.padrao === true) lista = lista.map((x) => ({ ...x, padrao: x.id === c.id }));
    gravarConexoes(lista);
    this.registry.invalidate(id);
    return (await this.list()).find((x) => x.id === id);
  }

  /** Exclui a conexão (desconecta e apaga a pasta e as credenciais dela). Recusa se algum projeto a usa. */
  async remove(id: string) {
    await this.migrar();
    const c = acharConexao(id);
    if (!c) throw new NotFoundException('Conexão não encontrada');
    const usando = await this.prisma.project.findMany({ where: { provider: id }, select: { name: true } });
    if (usando.length) {
      throw new ConflictException(`Esta conexão é a IA de ${usando.length} projeto(s): ${usando.map((p) => p.name).join(', ')}. Troque a IA deles antes de excluir.`);
    }
    await this.disconnect(id);
    if (ehAdicional(id)) {
      apagarSegredosDaConexao(id);
      fs.rmSync(isolatedHome(id), { recursive: true, force: true });
    }
    let lista = listarConexoes().filter((x) => x.id !== id);
    if (c.padrao && lista.length && !lista.some((x) => x.padrao)) lista = lista.map((x, i) => ({ ...x, padrao: i === 0 }));
    gravarConexoes(lista);
    this.registry.invalidate(id);
    return { ok: true };
  }

  startLogin(id: string) {
    this.exigirModo(this.conexao(id), 'conta');
    return this.logins.start(id);
  }

  loginStatus(id: string) {
    return this.logins.get(id);
  }

  submitCode(id: string, code: unknown) {
    return this.logins.submitCode(id, code);
  }

  cancelLogin(id: string) {
    this.logins.cancel(id);
    return { ok: true };
  }

  private env(id: string): NodeJS.ProcessEnv {
    return (this.registry.get(id) as unknown as { env(): NodeJS.ProcessEnv }).env();
  }

  /** Chave de API (cobrança por uso). Cada conexão guarda a sua. */
  async saveKey(id: string, key: unknown) {
    const c = this.conexao(id);
    this.exigirModo(c, 'api');
    const k = String(key ?? '').trim();
    if (k.length < 20 || k.length > 500 || /\s/.test(k)) throw new BadRequestException('Chave inválida');
    if (c.tipo === 'codex-api') {
      // Registrada pelo comando oficial, na pasta própria desta conexão.
      const r = await runProcess(process.env.NIVOO_CODEX_BIN ?? 'codex', ['login', '--with-api-key'], { cwd: process.cwd(), env: this.env(id), input: `${k}\n`, timeoutMs: 30_000 });
      if (r.exitCode !== 0) throw new BadRequestException(`O ChatGPT recusou a chave: ${(r.stderr || r.stdout).trim().slice(0, 300)}`);
    } else {
      gravarSegredoDaConexao(ehAdicional(id) ? id : null, CHAVE[c.tipo]!, k);
    }
    marcarFalhaLogin(id, null);
    this.registry.invalidate(id);
    if (c.tipo === 'gemini-api') this.registry.invalidate('gemini-video'); // o vídeo usa a chave do Gemini
    return this.registry.status(id, 0);
  }

  /** Desconecta (sai da conta / apaga a chave) sem excluir a conexão. */
  async disconnect(id: string) {
    const c = this.conexao(id);
    const propria = ehAdicional(id) ? id : null;
    this.logins.cancel(id);
    if (c.tipo === 'claude-code-cli') {
      gravarSegredoDaConexao(propria, 'CLAUDE_CODE_OAUTH_TOKEN', null);
      if (!propria) await runProcess(process.env.NIVOO_CLAUDE_BIN ?? 'claude', ['auth', 'logout'], { cwd: process.cwd(), env: minimalEnv(), timeoutMs: 30_000 });
    } else if (c.tipo === 'codex-cli' || c.tipo === 'codex-api') {
      await runProcess(process.env.NIVOO_CODEX_BIN ?? 'codex', ['logout'], { cwd: process.cwd(), env: this.env(id), timeoutMs: 30_000 });
    } else {
      gravarSegredoDaConexao(propria, CHAVE[c.tipo]!, null);
    }
    marcarFalhaLogin(id, null);
    this.registry.invalidate(id);
    if (c.tipo === 'gemini-api') this.registry.invalidate('gemini-video'); // o vídeo usa a chave do Gemini
    return this.registry.status(id, 0);
  }
}
