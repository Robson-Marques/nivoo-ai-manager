/**
 * Orçamento de contexto das sessões de IA.
 *
 * O prompt é montado em seções com prioridade. As obrigatórias (regras, objetivo íntegro, critérios,
 * etapas, verificação, histórico da etapa, protocolo de notas) sempre entram. A memória do projeto e a
 * lista de artefatos entram por prioridade até o limite; o que não couber é OMITIDO com aviso explícito
 * e fica disponível na íntegra em .nivoo/memoria.md (o agente lê sob demanda). Nada é resumido por IA.
 */

export interface MemoryItem {
  id: string;
  category: string;
  title: string;
  content: string;
  author: string;
  createdAt: Date;
  references: unknown;
}

export interface ContextSection {
  key: string;
  text: string;
  required: boolean;
}

export interface ContextStats {
  budgetChars: number;
  totalChars: number;
  overBudget: boolean;
  memoryIncluded: number;
  memoryOmitted: number;
  artifactsIncluded: number;
  artifactsOmitted: number;
  omittedMemoryIds: string[];
  skillIds?: string[];
  skillsVersion?: string;
  memoryTruncated?: number;
  promptChars?: number;
  profileChars?: number;
  leanExecution?: boolean;
  egmExecution?:{route:'lite'|'design';scopeHash:string;baseline:{commit:string|null;dirty:string[];complete:boolean};independentReview:'not-run'};
  memoryPromptChars?: number;
  artifactPromptChars?: number;
}

/** Ordem de importância da memória para quem continua o trabalho. */
const CATEGORY_PRIORITY: Record<string, number> = {
  DECISAO_APROVADA: 1,
  ARQUITETURA_RESTRICOES: 2,
  ESPECIFICACAO: 3,
  LICAO: 4, // lições automáticas de falhas (PENDENCIA com origem licao-automatica)
  EVIDENCIA: 5,
  PENDENCIA: 6,
};

export function isLesson(m: Pick<MemoryItem, 'references'>): boolean {
  return (m.references as any)?.origem === 'licao-automatica';
}

export function memoryRank(m: MemoryItem): number {
  return isLesson(m) ? CATEGORY_PRIORITY.LICAO : CATEGORY_PRIORITY[m.category] ?? 10;
}

export function memoryLine(m: MemoryItem, maxContent = 600): string {
  const label = isLesson(m) ? 'LIÇÃO' : m.category;
  return `- [${label}] ${m.title}: ${m.content.slice(0, maxContent)}${m.content.length > maxContent ? ' […]' : ''} (autor ${m.author})`;
}

/** Ordena: prioridade da categoria; dentro dela, o mais recente primeiro. */
export function sortMemory(items: MemoryItem[]): MemoryItem[] {
  return [...items].sort((a, b) => memoryRank(a) - memoryRank(b) || +b.createdAt - +a.createdAt);
}

export function assembleContext(
  sections: ContextSection[],
  memory: MemoryItem[],
  artifacts: string[],
  budgetChars: number,
  limits?: { memoryChars:number; artifactChars:number },
): { text: string; stats: ContextStats } {
  const required = sections.filter((s) => s.required);
  const optional = sections.filter((s) => !s.required);
  // Reserve room for headings and omission notices. Mandatory sections are never cut.
  const safeBudget=Number.isFinite(budgetChars)&&budgetChars>0?Math.floor(budgetChars):60000;
  let used = required.reduce((n, s) => n + s.text.length + 2, 0)+500;
  let memoryTruncated=0;
  let memoryUsed=0,artifactUsed=0;

  const memLines: string[] = [];
  const omittedMemoryIds: string[] = [];
  for (const m of sortMemory(memory)) {
    const line = memoryLine(m);
    if (used + line.length + 1 <= safeBudget && (!limits || memoryUsed+line.length+1<=limits.memoryChars)) {
      memLines.push(line);
      memoryUsed+=line.length+1;
      if(m.content.length>600)memoryTruncated++;
      used += line.length + 1;
    } else omittedMemoryIds.push(m.id);
  }
  const artLines: string[] = [];
  let artOmitted = 0;
  for (const a of artifacts) {
    if (used + a.length + 1 <= safeBudget && (!limits || artifactUsed+a.length+1<=limits.artifactChars)) {
      artLines.push(a);
      artifactUsed+=a.length+1;
      used += a.length + 1;
    } else artOmitted++;
  }
  const extra: string[] = [];
  for (const s of optional) {
    if (used + s.text.length + 2 <= safeBudget) {
      extra.push(s.text);
      used += s.text.length + 2;
    }
  }

  const parts: string[] = [];
  const [head, ...rest] = required;
  if (head) parts.push(head.text);
  for (const s of rest) parts.push(s.text);
  if (memLines.length || omittedMemoryIds.length) {
    parts.push(['## Memória do projeto (fonte da verdade, por prioridade; inclui notas e lições de sessões anteriores)', ...memLines].join('\n'));
  }
  if (omittedMemoryIds.length) {
    parts.push(`> Orçamento de contexto: ${omittedMemoryIds.length} entrada(s) de memória de menor prioridade foram omitidas deste prompt. A memória completa está em .nivoo/memoria.md — leia-a se precisar.`);
  }
  if(memoryTruncated)parts.push('> '+memoryTruncated+' entrada(s) acima abreviadas; conteúdo integral em .nivoo/memoria.md.');
  if (artLines.length) parts.push(['## Artefatos já produzidos neste job (em out/)', ...artLines].join('\n'));
  if (artOmitted) parts.push(`> ${artOmitted} artefato(s) omitidos por orçamento de contexto (lista completa em .nivoo/memoria.md).`);
  parts.push(...extra);

  const text = parts.join('\n\n');
  return {
    text,
    stats: {
      budgetChars:safeBudget,
      leanExecution:!!limits,
      memoryPromptChars:memoryUsed,
      artifactPromptChars:artifactUsed,
      totalChars: text.length,
      overBudget: text.length > safeBudget,
      memoryTruncated,
      memoryIncluded: memLines.length,
      memoryOmitted: omittedMemoryIds.length,
      artifactsIncluded: artLines.length,
      artifactsOmitted: artOmitted,
      omittedMemoryIds,
    },
  };
}

/** Versão completa (sem orçamento) gravada em .nivoo/memoria.md para leitura sob demanda. */
export function fullMemoryDocument(memory: MemoryItem[], artifacts: string[]): string {
  return [
    '# Memória completa do projeto (gerada pelo Nivoo a cada sessão — não edite)',
    '',
    ...sortMemory(memory).map((m) => memoryLine(m, Number.POSITIVE_INFINITY)),
    '',
    '## Artefatos do job',
    ...artifacts,
    '',
  ].join('\n');
}
