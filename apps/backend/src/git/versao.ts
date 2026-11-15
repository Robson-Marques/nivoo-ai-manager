import { minimalEnv, runProcess } from '../common/exec';

/**
 * Versão do projeto: a DECLARADA nos arquivos (package.json, pyproject.toml, VERSION) e a última ETIQUETA do Git.
 * As duas precisam andar juntas: a IA sobe o número dentro do projeto e o Nivoo publica a etiqueta com o mesmo
 * número. Antes a IA só via o CHANGELOG (ex.: 0.11.94 → escolheu 0.11.95) enquanto o Git já estava em v0.12.1, e o
 * Nivoo publicou v0.12.2: número dentro do projeto e etiqueta diferentes.
 */
export type Versao = [number, number, number];

/**
 * Padrão de versão de TODOS os projetos do usuário: 0.X.Y; cada casa depois do ponto vai de 0 a 99. Depois de .99 a
 * casa da esquerda sobe e a de baixo volta a 0 (0.11.99 → 0.12.0; 0.99.99 → 1.0.0). Sempre a próxima da sequência.
 */
export function proximaNoPadrao(v: Versao): Versao {
  let [maior, menor, correcao] = v;
  correcao += 1;
  if (correcao > 99) {
    correcao = 0;
    menor += 1;
  }
  if (menor > 99) {
    menor = 0;
    maior += 1;
  }
  return [maior, menor, correcao];
}

export const REGRA_DE_VERSAO =
  'Padrão de versão (vale para todos os projetos): 0.X.Y, cada casa de 0 a 99, sempre a próxima da sequência a partir da maior ' +
  'entre a versão dos arquivos e a última etiqueta do Git: 0.11.98 → 0.11.99 → 0.12.0 → 0.12.1; depois de 0.99.99 vem 1.0.0. ' +
  'Nunca pule números, nunca volte para trás e nunca escolha "menor/maior" livremente.';

export function acima(x: Versao, y: Versao | null): boolean {
  if (!y) return true;
  return x[0] !== y[0] ? x[0] > y[0] : x[1] !== y[1] ? x[1] > y[1] : x[2] > y[2];
}

export function maiorEtiqueta(tags: string[]): { versao: Versao; prefixo: string } | null {
  let maior: { versao: Versao; prefixo: string } | null = null;
  for (const t of tags) {
    const m = /^(v?)(\d+)\.(\d+)\.(\d+)$/.exec(t.trim());
    if (!m) continue;
    const v: Versao = [Number(m[2]), Number(m[3]), Number(m[4])];
    if (!maior || acima(v, maior.versao)) maior = { versao: v, prefixo: m[1] };
  }
  return maior;
}

const DECLARACOES: Array<[string, RegExp]> = [
  ['package.json', /"version"\s*:\s*"v?(\d+)\.(\d+)\.(\d+)"/],
  ['pyproject.toml', /^\s*version\s*=\s*"v?(\d+)\.(\d+)\.(\d+)"/m],
  ['VERSION', /^\s*v?(\d+)\.(\d+)\.(\d+)\s*$/m],
];

async function git(repo: string, args: string[]) {
  return runProcess('git', ['-c', 'safe.directory=*', ...args], { cwd: repo, env: minimalEnv(), timeoutMs: 30_000 });
}

/** Versão declarada num ref (padrão: main) — o primeiro arquivo que declarar uma versão X.Y.Z. */
export async function versaoDeclarada(repo: string, ref = 'main'): Promise<{ versao: Versao; arquivo: string } | null> {
  for (const [arq, re] of DECLARACOES) {
    const r = await git(repo, ['show', `${ref}:${arq}`]);
    const m = r.exitCode === 0 ? re.exec(r.stdout) : null;
    if (m) return { versao: [Number(m[1]), Number(m[2]), Number(m[3])], arquivo: arq };
  }
  return null;
}

export interface InfoDeVersao {
  declarada: { versao: Versao; arquivo: string } | null;
  etiqueta: { versao: Versao; prefixo: string } | null;
  /** O número a usar se o trabalho sobe a versão (acima da declarada e da última etiqueta). */
  proxima: Versao;
  /** A declarada ainda não tem etiqueta e está acima da última: já é a próxima (não subir de novo). */
  declaradaPendente: boolean;
}

export function calcularVersao(declarada: InfoDeVersao['declarada'], etiqueta: InfoDeVersao['etiqueta'], tags: string[]): InfoDeVersao {
  const prefixo = etiqueta?.prefixo ?? 'v';
  const pendente = !!declarada && acima(declarada.versao, etiqueta?.versao ?? null) && !tags.includes(`${prefixo}${declarada.versao.join('.')}`) && !!etiqueta;
  const base = declarada && acima(declarada.versao, etiqueta?.versao ?? null) ? declarada.versao : etiqueta?.versao ?? declarada?.versao ?? null;
  let proxima: Versao = pendente && declarada ? declarada.versao : base ? proximaNoPadrao(base) : [0, 1, 0];
  while (tags.includes(`${prefixo}${proxima.join('.')}`)) proxima = proximaNoPadrao(proxima);
  return { declarada, etiqueta, proxima, declaradaPendente: pendente };
}

export async function infoDeVersao(repo: string, ref = 'main'): Promise<InfoDeVersao | null> {
  const tags = (await git(repo, ['tag', '-l'])).stdout.split('\n').map((t) => t.trim()).filter(Boolean);
  const declarada = await versaoDeclarada(repo, ref);
  const etiqueta = maiorEtiqueta(tags);
  if (!declarada && !etiqueta) return null;
  return calcularVersao(declarada, etiqueta, tags);
}

/** Linhas para o prompt (plano e sessões). */
export function textoDaVersao(i: InfoDeVersao | null): string[] {
  if (!i) return [];
  const d = i.declarada ? `${i.declarada.versao.join('.')} (em ${i.declarada.arquivo})` : 'nenhuma declarada nos arquivos';
  const e = i.etiqueta ? `${i.etiqueta.prefixo}${i.etiqueta.versao.join('.')}` : 'nenhuma ainda';
  return [
    '## Versão do projeto',
    `- Versão nos arquivos: ${d}. Última versão publicada (etiqueta no Git): ${e}.`,
    `- Se este trabalho sobe a versão, a próxima é EXATAMENTE ${i.proxima.join('.')}. Use o MESMO número no arquivo de versão e no`,
    '  CHANGELOG (o Nivoo publica a etiqueta do Git com o número do arquivo). Confira a anterior antes de aplicar.',
    `- ${REGRA_DE_VERSAO}`,
    ...(i.declaradaPendente ? [`- ${i.declarada!.versao.join('.')} ainda não foi publicada: é ela a próxima; não suba de novo.`] : []),
  ];
}
