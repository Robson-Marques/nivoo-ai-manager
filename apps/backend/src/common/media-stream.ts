import * as fs from 'node:fs';
import type { Request, Response } from 'express';

/**
 * Entrega áudio/vídeo sem carregar o arquivo inteiro na memória e com HTTP Range. Players pedem só o cabeçalho e
 * os trechos que estão tocando; sem isso, cada player aberto baixava o vídeo completo e concorria com os uploads.
 */
export function streamMedia(req: Request, res: Response, arquivo: string, tipo: string): void {
  const total = fs.statSync(arquivo).size;
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'private, no-cache');
  res.type(tipo);

  const range = String(req.headers.range ?? '');
  if (!range) {
    res.setHeader('Content-Length', String(total));
    fs.createReadStream(arquivo).pipe(res);
    return;
  }

  const m = /^bytes=(\d*)-(\d*)$/.exec(range);
  let inicio: number;
  let fim: number;
  if (!m || (!m[1] && !m[2])) return rangeInvalido(res, total);
  if (!m[1]) {
    const ultimos = Number(m[2]);
    if (!Number.isInteger(ultimos) || ultimos <= 0) return rangeInvalido(res, total);
    inicio = Math.max(0, total - ultimos);
    fim = total - 1;
  } else {
    inicio = Number(m[1]);
    fim = m[2] ? Number(m[2]) : total - 1;
  }
  if (!Number.isInteger(inicio) || !Number.isInteger(fim) || inicio < 0 || inicio >= total || fim < inicio) {
    return rangeInvalido(res, total);
  }
  fim = Math.min(fim, total - 1);
  res.status(206);
  res.setHeader('Content-Range', `bytes ${inicio}-${fim}/${total}`);
  res.setHeader('Content-Length', String(fim - inicio + 1));
  fs.createReadStream(arquivo, { start: inicio, end: fim }).pipe(res);
}

function rangeInvalido(res: Response, total: number): void {
  res.status(416);
  res.setHeader('Content-Range', `bytes */${total}`);
  res.end();
}
