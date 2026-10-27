import * as fs from 'node:fs';
import * as path from 'node:path';
import { ForbiddenException } from '@nestjs/common';

/**
 * Garante que um caminho resolvido (inclusive via symlinks) permanece dentro do
 * diretório autorizado. Usado para workspaces, datasets e artefatos.
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

export function assertInside(root: string, candidate: string): void {
  const rel = path.relative(root, candidate);
  if (rel === '' ) return;
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new ForbiddenException(`Acesso fora do diretório autorizado: ${candidate}`);
  }
}
