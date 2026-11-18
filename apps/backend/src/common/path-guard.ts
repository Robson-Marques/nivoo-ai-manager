import * as fs from 'node:fs';
import * as path from 'node:path';
import { ForbiddenException } from '@nestjs/common';

/**
 * Garante que um caminho resolvido (inclusive via symlinks) permanece dentro do
 * diretório autorizado. Usado para workspaces, conhecimento e artefatos.
 */
export function resolveInside(root: string, relative: string): string {
  const realRoot = fs.realpathSync(root);
  if (path.isAbsolute(relative)) {
    throw new ForbiddenException(`Caminho absoluto não permitido: ${relative}`);
  }
  const candidate = path.resolve(realRoot, relative);
  assertInside(realRoot, candidate);
  // Se existir, resolve symlinks e verifica de novo.
  if (fs.existsSync(candidate)) {
    assertInside(realRoot, fs.realpathSync(candidate));
  } else {
    // Verifica o ancestral existente mais próximo (evita symlink no meio do caminho).
    let parent = path.dirname(candidate);
    while (!fs.existsSync(parent)) parent = path.dirname(parent);
    assertInside(realRoot, fs.realpathSync(parent));
  }
  return candidate;
}

/**
 * Caminho que pode ser da MÍDIA do projeto (fora do git): "midia/..." resolve na pasta de mídia durável; o resto, na
 * pasta de trabalho (cwd/worktree). Usado por todos os executores e pela cópia de anexos, para "midia/..." significar
 * sempre o mesmo lugar (a mídia real), nunca a cópia do git.
 */
export function resolveMidiaOuTrabalho(midiaDir: string | undefined, cwd: string, rel: string): string {
  if (midiaDir && /^midia\//i.test(String(rel))) return resolveInside(midiaDir, String(rel).replace(/^midia\//i, ''));
  return resolveInside(cwd, rel);
}

export function assertInside(root: string, candidate: string): void {
  const rel = path.relative(root, candidate);
  if (rel === '' ) return;
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new ForbiddenException(`Acesso fora do diretório autorizado: ${candidate}`);
  }
}

/**
 * Caminho de arquivo do projeto, normalizado ("./a/./b/" → "a/b"). null se for a própria pasta, sair dela ou
 * cair em área protegida (.git, contexto/, .nivoo/).
 */
export function caminhoDoProjeto(p: unknown): string | null {
  const bruto = String(p ?? '').trim().replace(/\\/g, '/');
  if (!/^(?!\/)[\w\-./ ]{1,200}$/.test(bruto)) return null;
  const r = path.posix.normalize(bruto).replace(/^(\.\/)+/, '').replace(/\/+$/, '');
  if (!r || r === '.' || r.startsWith('/') || r.split('/').includes('..') || /^(\.git|contexto|\.nivoo)(\/|$)/.test(r)) return null;
  return r;
}
