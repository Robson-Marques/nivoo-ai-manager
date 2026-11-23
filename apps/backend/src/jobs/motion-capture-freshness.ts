import * as fs from 'node:fs';
import * as path from 'node:path';

/** Quadro gerado antes da última mudança na composição não é evidência atual. */
export function capturasMotionDesatualizadas(worktree: string, steps: Array<{key:string; provider:string|null; instructions:string; status:string}>): string[] {
  const vencidas: string[] = [];
  for (const step of steps) {
    if (step.provider !== 'local-shell' || step.status !== 'CONCLUIDO') continue;
    const match = /\bnivoo-conferir-arte\s+(motion\/[A-Za-z0-9._/-]+)\s+--saida\s+(out\/qualidade\/[A-Za-z0-9_-]+)/.exec(step.instructions);
    if (!match || match[1].split('/').includes('..')) continue;
    const dir = path.resolve(worktree, match[1]);
    const png = path.resolve(worktree, match[2], 'quadro.png');
    if (!dir.startsWith(worktree + path.sep) || !fs.existsSync(dir) || !fs.existsSync(png)) continue;
    const pngTime = fs.statSync(png).mtimeMs;
    const fontes: string[] = [];
    const ler = (pasta: string, level: number) => {
      if (level > 3 || fontes.length > 200) return;
      for (const item of fs.readdirSync(pasta, {withFileTypes:true})) {
        if (item.isSymbolicLink()) continue;
        const full = path.join(pasta,item.name);
        if (item.isDirectory()) ler(full,level+1);
        else if(item.isFile() && /\.(html|css|js|mjs|png|jpe?g|svg|webp)$/i.test(item.name)) fontes.push(full);
      }
    };
    ler(dir,0);
    if(fontes.some(f=>fs.statSync(f).mtimeMs>pngTime+200)) vencidas.push(step.key);
  }
  return vencidas;
}

/** Revisão visual precisa de recaptura local, não de outra sessão de IA lendo PNG antigo. */
export function capturasParaRecuperar(worktree: string, step: {key:string;verifyCommand:string|null}, steps: Array<{key:string;provider:string|null;instructions:string;status:string}>): string[] {
  if (!/^direcao-arte-/.test(step.key) && !/out\/qualidade\/[A-Za-z0-9_-]+\/parecer\.json/.test(step.verifyCommand ?? '')) return [];
  return capturasMotionDesatualizadas(worktree, steps);
}

/** Se uma aprovação visual JSON reprova sem stdout, mostrar a causa de verdade.
 * Não confundir a saída genérica exit 1 com a identidade do defeito visual. */
export function diagnosticoParecerVisual(worktree: string, verifyCommand: string): string | null {
  const match = /out\/qualidade\/[A-Za-z0-9_-]+\/parecer\.json/.exec(verifyCommand);
  if (!match) return null;
  const arquivo = path.resolve(worktree, match[0]);
  if (!arquivo.startsWith(path.resolve(worktree) + path.sep)) return null;
  try {
    const d = JSON.parse(fs.readFileSync(arquivo, 'utf8')) as Record<string, unknown>;
    const pendencias = Array.isArray(d.pendencias) ? d.pendencias.filter((v): v is string => typeof v === 'string') : [];
    const comparacoes = Array.isArray(d.comparacoes) ? d.comparacoes : [];
    const motivos = [
      ...pendencias,
      ...(d.movimentoConforme === false ? ['movimento não aprovado: verificar orientação, efeitos e molduras nos quadros temporais'] : []),
      ...(pendencias.length === 0 && d.conforme !== true ? comparacoes
        .filter((v): v is Record<string, unknown> => !!v && typeof v === 'object')
        .map((v) => String(v.observacao ?? ''))
        .filter(Boolean)
        .slice(-3) : []),
    ];
    return 'parecer visual: conforme=' + String(d.conforme) +
      (motivos.length ? '; pendencias: ' + motivos.join('; ').slice(0, 1200) : '; sem pendencia detalhada no JSON');
  } catch {
    return 'parecer visual ausente ou ilegível: ' + match[0];
  }
}
