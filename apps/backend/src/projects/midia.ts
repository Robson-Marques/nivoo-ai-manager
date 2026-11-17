import { BadRequestException } from '@nestjs/common';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Readable, Transform } from 'node:stream';
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
  // Conta os bytes DENTRO do pipeline (respeitando a contrapressão): nada de ouvir 'data' por fora, que colocaria o
  // fluxo em modo corrente e poderia perder pedaços de arquivos grandes. Passou do limite → erra o pipeline e apaga.
  let bytes = 0;
  const limite = MAX_VIDEO_BYTES;
  const contador = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      bytes += chunk.length;
      if (bytes > limite) {
        cb(Object.assign(new Error('LIMITE'), { estourou: true }));
        return;
      }
      cb(null, chunk);
    },
  });
  try {
    await pipeline(corpo, contador, fs.createWriteStream(destino));
  } catch (err: any) {
    fs.rmSync(destino, { force: true });
    if (err?.estourou) throw new BadRequestException(`O vídeo passa do limite de ${Math.round(limite / 1024 / 1024)} MB`);
    throw err;
  }
  const salvo = fs.existsSync(destino) ? fs.statSync(destino).size : 0;
  if (!salvo) {
    fs.rmSync(destino, { force: true });
    // Chegou ao servidor sem corpo: quase sempre um proxy/Cloudflare/nginx na frente que não repassa o envio grande.
    throw new BadRequestException('O vídeo chegou vazio (0 byte). Se há um proxy/Cloudflare/nginx na frente, libere o tamanho do upload (ex.: client_max_body_size no nginx).');
  }
  // Guarda o nome original ao lado (para mostrar na tela), sem afetar o arquivo.
  fs.writeFileSync(path.join(dir, `${id}.nome`), nomeOk);
  return { id, nome: nomeOk, bytes: salvo, caminho: `midia/entrada/${id}`, pasta: 'entrada' };
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
      .filter((v) => v.bytes > 0) // ignora restos de 0 byte (envio que falhou): não confundem a IA nem a tela
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
