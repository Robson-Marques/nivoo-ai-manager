import { createHash } from 'node:crypto';
import * as fs from 'node:fs';

export function sha256(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

export function sha256File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    fs.createReadStream(file)
      .on('data', (c) => h.update(c))
      .on('error', reject)
      .on('end', () => resolve(h.digest('hex')));
  });
}

/** Normaliza saída para detecção de repetição (remove números voláteis, datas, espaços). */
export function normalizedOutputHash(output: string, error?: string | null): string {
  const norm = `${output}\n${error ?? ''}`
    .replace(/\d{4}-\d{2}-\d{2}[T ][\d:.]+Z?/g, '<ts>')
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, '<uuid>')
    .replace(/\b\d+(\.\d+)?(ms|s)\b/g, '<dur>')
    .replace(/\s+/g, ' ')
    .trim();
  return sha256(norm);
}
