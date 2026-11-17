import { BadRequestException } from '@nestjs/common';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/**
 * Mídia durável do projeto (vídeos que o usuário envia para editar e os vídeos editados). Fica em
 * <projeto>/midia/ — entrada/ (enviados) e saida/ (editados) —, FORA do git (vídeo é pesado) e nunca vai para a
 * sessão da IA. O plano referencia pelos caminhos midia/entrada/<id> e midia/saida/<nome>.mp4.
 */
export const VIDEO_EXT = /\.(mp4|mov|webm|mkv|m4v)$/i;
const MAX_VIDEO_BYTES = Number(process.env.NIVOO_MAX_VIDEO_MB ?? 2048) * 1024 * 1024;

export interface VideoDaMidia {
  id: string;
  nome: string;
  bytes: number;
  caminho: string; // midia/entrada/<id> ou midia/saida/<nome>
  pasta: 'entrada' | 'saida';
}

function ext(nome: string): string {
  return (VIDEO_EXT.exec(nome)?.[0] ?? '').toLowerCase();
}

/** Nome visível seguro (sem pastas), só para mostrar; o arquivo em disco usa um id gerado. */
export function nomeSeguroVideo(raw: unknown): string {
  const base = path.basename(String(raw ?? '').replace(/\\/g, '/')).replace(/[\u0000-\u001f<>:"|?*]/g, '_').trim();
  if (!base || !VIDEO_EXT.test(base) || base.length > 150) throw new BadRequestException('Envie um vídeo (MP4, MOV, WEBM, MKV, M4V)');
  return base;
}

const entradaDir = (midia: string) => path.join(midia, 'entrada');
const saidaDir = (midia: string) => path.join(midia, 'saida');

/** Grava o vídeo enviado (streaming, sem carregar na memória) em midia/entrada/<id>.<ext>. */
export async function gravarVideoEnviado(midia: string, nome: string, corpo: Readable): Promise<VideoDaMidia> {
  const nomeOk = nomeSeguroVideo(nome);
  const e = ext(nomeOk);
  const id = `${crypto.randomUUID()}${e}`;
  const dir = entradaDir(midia);
  fs.mkdirSync(dir, { recursive: true });
  const destino = path.join(dir, id);
  // Limite de tamanho enquanto grava: aborta e apaga se passar.
  let bytes = 0;
  let estourou = false;
  corpo.on('data', (c: Buffer) => {
    bytes += c.length;
    if (bytes > MAX_VIDEO_BYTES) {
      estourou = true;
      corpo.destroy();
    }
  });
  try {
    await pipeline(corpo, fs.createWriteStream(destino));
  } catch (err) {
    fs.rmSync(destino, { force: true });
    if (estourou) throw new BadRequestException(`O vídeo passa do limite de ${Math.round(MAX_VIDEO_BYTES / 1024 / 1024)} MB`);
    throw err;
  }
  if (estourou || !fs.existsSync(destino) || !fs.statSync(destino).size) {
    fs.rmSync(destino, { force: true });
    throw new BadRequestException(estourou ? `O vídeo passa do limite de ${Math.round(MAX_VIDEO_BYTES / 1024 / 1024)} MB` : 'Vídeo vazio');
  }
  // Guarda o nome original ao lado (para mostrar na tela), sem afetar o arquivo.
  fs.writeFileSync(path.join(dir, `${id}.nome`), nomeOk);
  return { id, nome: nomeOk, bytes: fs.statSync(destino).size, caminho: `midia/entrada/${id}`, pasta: 'entrada' };
}

/** Lista os vídeos enviados (entrada) e os editados (saida). */
export function listarVideos(midia: string): VideoDaMidia[] {
  const ler = (pasta: 'entrada' | 'saida'): VideoDaMidia[] => {
    const dir = pasta === 'entrada' ? entradaDir(midia) : saidaDir(midia);
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((f) => VIDEO_EXT.test(f))
      .map((f) => {
        const nomeArq = path.join(dir, `${f}.nome`);
        const nome = pasta === 'entrada' && fs.existsSync(nomeArq) ? fs.readFileSync(nomeArq, 'utf8').trim() : f;
        return { id: f, nome, bytes: fs.statSync(path.join(dir, f)).size, caminho: `midia/${pasta}/${f}`, pasta };
      })
      .sort((a, b) => a.nome.localeCompare(b.nome));
  };
  return [...ler('entrada'), ...ler('saida')];
}

/** Resolve um caminho midia/<pasta>/<arquivo> para o arquivo em disco (sem sair da pasta de mídia). */
export function arquivoDaMidia(midia: string, caminho: string): string | null {
  const m = /^midia\/(entrada|saida)\/([^/]+)$/.exec(String(caminho ?? ''));
  if (!m || !VIDEO_EXT.test(m[2])) return null;
  const abs = path.resolve(midia, m[1], m[2]);
  if (abs !== path.resolve(midia, m[1], path.basename(m[2]))) return null;
  return fs.existsSync(abs) ? abs : null;
}

/** Apaga um vídeo enviado (só da pasta entrada; os editados saíram de um trabalho). */
export function apagarVideoEnviado(midia: string, id: string): boolean {
  if (!VIDEO_EXT.test(id) || path.basename(id) !== id) return false;
  const abs = path.join(entradaDir(midia), id);
  if (!fs.existsSync(abs)) return false;
  fs.rmSync(abs, { force: true });
  fs.rmSync(`${abs}.nome`, { force: true });
  return true;
}
