import * as fs from 'node:fs';
import * as path from 'node:path';
import { MemoryCategory, Prisma, PrismaClient } from '@prisma/client';

/**
 * Memória do projeto em camadas.
 *
 * - BASE (o "organismo"): regras e materiais do modelo (workflow). Não mora aqui; a IA lê e não altera.
 * - PROJETO: o que o usuário vê — decisões, preferências, fatos e pendências concretas, ditos ou confirmados por
 *   ele. UMA entrada por assunto (`chave`): o mesmo assunto com conteúdo novo ATUALIZA (a versão anterior fica no
 *   histórico, `supersededById`), nunca empilha.
 * - INTERNA: o processo — notas das sessões, lições de falhas, registro de trabalhos. A IA usa; o painel não mostra.
 *
 * O banco é onde se grava (API e worker escrevem ao mesmo tempo; transação, sem arquivo corrompido). A cada mudança,
 * o arquivo <projeto>/memoria/MEMORIA.md é regravado com a memória do projeto (e memoria/interna.md com a interna):
 * legível, copiável e na pasta definitiva do projeto.
 */
export type Camada = 'PROJETO' | 'INTERNA';

type Db = PrismaClient | Prisma.TransactionClient;

export function chaveDe(titulo: string): string {
  return titulo
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

export interface NovaMemoria {
  projectId: string;
  category: MemoryCategory;
  title: string;
  content: string;
  references?: Record<string, unknown>;
  author: string;
  /** Assunto; padrão: o título normalizado. */
  chave?: string;
}

/**
 * Grava na memória do PROJETO: assunto novo cria; assunto existente com conteúdo diferente vira versão nova (a
 * anterior vai para o histórico); conteúdo igual não grava nada. Devolve a entrada gravada ou null.
 */
export async function gravarNoProjeto(db: Db, m: NovaMemoria) {
  const chave = (m.chave ?? chaveDe(m.title)) || chaveDe(m.content.slice(0, 80));
  const atual = await db.memoryEntry.findFirst({ where: { projectId: m.projectId, camada: 'PROJETO', chave, supersededById: null }, orderBy: { createdAt: 'desc' } });
  const mesmo = (a: string, b: string) => a.replace(/\s+/g, ' ').trim().toLowerCase() === b.replace(/\s+/g, ' ').trim().toLowerCase();
  if (atual && mesmo(atual.content, m.content) && atual.category === m.category) return null;
  const novo = await db.memoryEntry.create({
    data: {
      projectId: m.projectId,
      camada: 'PROJETO',
      chave,
      category: m.category,
      title: m.title.slice(0, 300),
      content: m.content.slice(0, 50_000),
      references: (m.references ?? {}) as Prisma.InputJsonValue,
      author: m.author.slice(0, 100),
      version: atual ? atual.version + 1 : 1,
    },
  });
  if (atual) await db.memoryEntry.update({ where: { id: atual.id }, data: { supersededById: novo.id } });
  return novo;
}

/** Grava na memória INTERNA (processo). Não aparece no painel do usuário. */
export function gravarInterna(db: Db, m: NovaMemoria) {
  return db.memoryEntry.create({
    data: {
      projectId: m.projectId,
      camada: 'INTERNA',
      chave: m.chave ?? null,
      category: m.category,
      title: m.title.slice(0, 300),
      content: m.content.slice(0, 50_000),
      references: (m.references ?? {}) as Prisma.InputJsonValue,
      author: m.author.slice(0, 100),
    },
  });
}

const SECOES: Array<{ titulo: string; categorias: string[] }> = [
  { titulo: 'Decisões', categorias: ['DECISAO_APROVADA'] },
  { titulo: 'Preferências e regras', categorias: ['ARQUITETURA_RESTRICOES'] },
  { titulo: 'Sobre o projeto', categorias: ['ESPECIFICACAO'] },
  { titulo: 'Pendências', categorias: ['PENDENCIA'] },
  { titulo: 'Evidências', categorias: ['EVIDENCIA'] },
];

type Item = { title: string; content: string; category: string; version: number; author: string; createdAt: Date };

export function memoriaComoMarkdown(nome: string, itens: Item[], titulo = 'Memória do projeto'): string {
  const linhas = [`# ${titulo} — ${nome}`, '', `Atualizada em ${new Date().toISOString()}. Gerada pelo Nivoo a cada mudança (editar pela tela).`, ''];
  for (const s of SECOES) {
    const daSecao = itens.filter((i) => s.categorias.includes(i.category));
    if (!daSecao.length) continue;
    linhas.push(`## ${s.titulo}`, '');
    for (const i of daSecao) linhas.push(`### ${i.title}`, '', i.content.trim(), '', `<sub>versão ${i.version} · ${i.author} · ${i.createdAt.toISOString().slice(0, 10)}</sub>`, '');
  }
  if (linhas.length <= 4) linhas.push('(vazia)');
  return `${linhas.join('\n')}\n`;
}

function gravarAtomico(arq: string, conteudo: string) {
  fs.mkdirSync(path.dirname(arq), { recursive: true });
  const tmp = `${arq}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, conteudo);
  fs.renameSync(tmp, arq);
}

/** Regrava <projeto>/memoria/MEMORIA.md e memoria/interna.md a partir do banco. Nunca lança. */
export async function escreverArquivosDaMemoria(db: Db, projectId: string): Promise<void> {
  try {
    const p = await db.project.findUnique({ where: { id: projectId }, select: { name: true, workspacePath: true } });
    if (!p?.workspacePath || !fs.existsSync(p.workspacePath)) return;
    const [projeto, interna] = await Promise.all([
      db.memoryEntry.findMany({ where: { projectId, camada: 'PROJETO', supersededById: null }, orderBy: { createdAt: 'asc' } }),
      db.memoryEntry.findMany({ where: { projectId, camada: 'INTERNA', supersededById: null }, orderBy: { createdAt: 'desc' }, take: 500 }),
    ]);
    gravarAtomico(path.join(p.workspacePath, 'memoria', 'MEMORIA.md'), memoriaComoMarkdown(p.name, projeto));
    gravarAtomico(path.join(p.workspacePath, 'memoria', 'interna.md'), memoriaComoMarkdown(p.name, interna, 'Memória interna do processo (notas da IA, lições, trabalhos)'));
  } catch {
    /* o arquivo é um espelho: o banco continua com tudo; a próxima mudança regrava */
  }
}
