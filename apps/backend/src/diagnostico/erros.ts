import * as fs from 'node:fs';
import * as path from 'node:path';
import { appConfig } from '../config';

/**
 * Registro de erros inesperados do sistema (API e worker) num arquivo próprio — o que não é erro "do trabalho"
 * (esse fica no log do trabalho). Uma linha JSON por erro; passa de 2 MB → o anterior vira `erros.log.1`.
 * Entra no diagnóstico (tela Diagnóstico e `nivoo diagnostico`), sempre sem segredos.
 */
function arquivo(): string {
  return process.env.NIVOO_ERROS_FILE ?? path.join(path.dirname(appConfig().workspacesRoot), 'erros.log');
}

export function registrarErro(origem: string, mensagem: string, detalhe?: unknown): void {
  try {
    const alvo = arquivo();
    fs.mkdirSync(path.dirname(alvo), { recursive: true });
    if (fs.existsSync(alvo) && fs.statSync(alvo).size > 2 * 1024 * 1024) fs.renameSync(alvo, `${alvo}.1`);
    const d = detalhe instanceof Error ? detalhe.stack ?? detalhe.message : detalhe === undefined ? undefined : typeof detalhe === 'string' ? detalhe : JSON.stringify(detalhe);
    fs.appendFileSync(alvo, `${JSON.stringify({ em: new Date().toISOString(), origem, mensagem: redigir(mensagem).slice(0, 2000), detalhe: d ? redigir(d).slice(0, 6000) : undefined })}\n`, { mode: 0o600 });
  } catch {
    /* registrar erro nunca pode derrubar nada */
  }
}

export function lerErros(n = 100): Array<{ em: string; origem: string; mensagem: string; detalhe?: string }> {
  const ler = (f: string) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean) : []);
  const linhas = [...ler(`${arquivo()}.1`), ...ler(arquivo())].slice(-n);
  return linhas.map((l) => {
    try {
      return JSON.parse(l);
    } catch {
      return { em: '', origem: '?', mensagem: l.slice(0, 500) };
    }
  });
}

/** Apaga segredos de um texto (tokens, chaves, senhas, cabeçalhos de autorização, chaves privadas). */
export function redigir(texto: string): string {
  return texto
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[CHAVE PRIVADA OCULTA]')
    .replace(/\b(sk-ant-[A-Za-z0-9_-]{8})[A-Za-z0-9_-]+/g, '$1…[oculto]')
    .replace(/\b(sk-(?:proj-)?[A-Za-z0-9]{4})[A-Za-z0-9_-]{16,}/g, '$1…[oculto]')
    .replace(/\b(AIza[0-9A-Za-z_-]{4})[0-9A-Za-z_-]{20,}/g, '$1…[oculto]')
    .replace(/\b(gh[pousr]_[A-Za-z0-9]{4})[A-Za-z0-9]{20,}/g, '$1…[oculto]')
    .replace(/\b(github_pat_[A-Za-z0-9]{4})[A-Za-z0-9_]{20,}/g, '$1…[oculto]')
    .replace(/\b(glpat-[A-Za-z0-9]{2})[A-Za-z0-9_-]{10,}/g, '$1…[oculto]')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, '$1[oculto]')
    .replace(/(postgres(?:ql)?:\/\/[^:\s/]+:)[^@\s]+@/gi, '$1[oculto]@')
    .replace(/((?:senha|password|passwd|token|secret|api[_-]?key|chave)["']?\s*[:=]\s*["']?)[^\s"',;]{4,}/gi, '$1[oculto]');
}
