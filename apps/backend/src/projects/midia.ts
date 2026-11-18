import { BadRequestException, Logger } from '@nestjs/common';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import * as yauzl from 'yauzl';

/** Log do upload de vídeo (aparece no journalctl -u nivoo-api): "recebendo" no começo, "OK/FALHOU" no fim — para
 * dar para ver, no servidor, se um envio travou (ficou só o "recebendo") ou terminou. */
const LOG_MIDIA = new Logger('Midia');

/**
 * Mídia durável do projeto (vídeos que o usuário envia para editar e os vídeos editados). Fica em
 * <projeto>/midia/ — entrada/ (enviados) e saida/ (editados) —, FORA do git (vídeo é pesado) e nunca vai para a
 * sessão da IA. O plano referencia pelos caminhos midia/entrada/<id> e midia/saida/<nome>.mp4.
 */
export const VIDEO_EXT = /\.(mp4|mov|webm|mkv|m4v)$/i;
const MAX_VIDEO_BYTES = Number(process.env.NIVOO_MAX_VIDEO_MB ?? 2048) * 1024 * 1024;
const MAX_ZIP_BYTES = Number(process.env.NIVOO_MAX_ZIP_MB ?? 4096) * 1024 * 1024;
const MAX_VIDEOS_POR_ZIP = Number(process.env.NIVOO_MAX_VIDEOS_POR_ZIP ?? 300);

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
  const t0 = Date.now();
  LOG_MIDIA.log(`upload recebendo "${nomeOk}" → ${id}`);
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
    LOG_MIDIA.warn(`upload FALHOU "${nomeOk}" após ${bytes} bytes em ${Date.now() - t0}ms: ${err?.estourou ? 'passou do limite' : String(err?.message ?? err).slice(0, 200)}`);
    if (err?.estourou) throw new BadRequestException(`O vídeo passa do limite de ${Math.round(limite / 1024 / 1024)} MB`);
    throw err;
  }
  const salvo = fs.existsSync(destino) ? fs.statSync(destino).size : 0;
  LOG_MIDIA.log(`upload OK "${nomeOk}" → ${salvo} bytes em ${Date.now() - t0}ms`);
  if (!salvo) {
    fs.rmSync(destino, { force: true });
    // Chegou ao servidor sem corpo: quase sempre um proxy/Cloudflare/nginx na frente que não repassa o envio grande.
    throw new BadRequestException('O vídeo chegou vazio (0 byte). Se há um proxy/Cloudflare/nginx na frente, libere o tamanho do upload (ex.: client_max_body_size no nginx).');
  }
  // Guarda o nome original ao lado (para mostrar na tela), sem afetar o arquivo.
  fs.writeFileSync(path.join(dir, `${id}.nome`), nomeOk);
  return { id, nome: nomeOk, bytes: salvo, caminho: `midia/entrada/${id}`, pasta: 'entrada' };
}

/** Nome visível seguro para o .nome (não lança: só limpa e corta). */
function nomeDisplaySeguro(base: string): string {
  return (base.replace(/[\u0000-\u001f<>:"|?*]/g, '_').trim() || 'video').slice(0, 150);
}

export interface ResultadoZip {
  adicionados: VideoDaMidia[];
  ignorados: number; // entradas que não eram vídeo (ou passaram do limite)
}

/**
 * Recebe um .zip por streaming, salva num temporário e extrai TODOS os vídeos de dentro (em qualquer subpasta) para
 * midia/entrada. Segurança: o arquivo em disco usa um id gerado (NUNCA o caminho de dentro do zip → sem "zip-slip");
 * só extrai extensões de vídeo; respeita limites de tamanho (por vídeo, total) e de quantidade.
 */
export async function gravarZipDeVideos(midia: string, nome: string, corpo: Readable): Promise<ResultadoZip> {
  if (!/\.zip$/i.test(String(nome ?? '').trim())) throw new BadRequestException('Envie um arquivo .zip');
  const dir = entradaDir(midia);
  fs.mkdirSync(dir, { recursive: true });
  const tmpZip = path.join(os.tmpdir(), `nivoo-zip-${crypto.randomUUID()}.zip`);
  // 1) Salva o zip no temporário (streaming, com limite, contrapressão dentro do pipeline).
  let bytes = 0;
  const contador = new Transform({
    transform(chunk: Buffer, _e, cb) {
      bytes += chunk.length;
      if (bytes > MAX_ZIP_BYTES) {
        cb(Object.assign(new Error('LIMITE'), { estourou: true }));
        return;
      }
      cb(null, chunk);
    },
  });
  try {
    await pipeline(corpo, contador, fs.createWriteStream(tmpZip));
  } catch (err: any) {
    fs.rmSync(tmpZip, { force: true });
    if (err?.estourou) throw new BadRequestException(`O .zip passa do limite de ${Math.round(MAX_ZIP_BYTES / 1024 / 1024)} MB`);
    throw err;
  }
  if (!fs.existsSync(tmpZip) || !fs.statSync(tmpZip).size) {
    fs.rmSync(tmpZip, { force: true });
    throw new BadRequestException('O .zip chegou vazio (0 byte). Se há um proxy/Cloudflare/nginx na frente, libere o tamanho do upload.');
  }
  try {
    const r = await extrairVideosDoZip(tmpZip, dir);
    if (!r.adicionados.length) throw new BadRequestException('O .zip não tinha nenhum vídeo (MP4, MOV, WEBM, MKV, M4V).');
    return r;
  } finally {
    fs.rmSync(tmpZip, { force: true });
  }
}

function extrairVideosDoZip(zipPath: string, dir: string): Promise<ResultadoZip> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(new BadRequestException('Não consegui abrir o .zip (arquivo inválido ou corrompido).'));
      const adicionados: VideoDaMidia[] = [];
      let ignorados = 0;
      let total = 0;
      const encerrar = (e?: any) => {
        try {
          zip.close();
        } catch {
          /* já fechado */
        }
        e ? reject(e) : resolve({ adicionados, ignorados });
      };
      zip.on('error', (e) => encerrar(new BadRequestException(`Falha ao ler o .zip: ${String((e as any)?.message ?? e).slice(0, 160)}`)));
      zip.on('end', () => encerrar());
      zip.readEntry();
      zip.on('entry', (entry: yauzl.Entry) => {
        const base = path.basename(entry.fileName.replace(/\\/g, '/'));
        const ehPasta = /\/$/.test(entry.fileName);
        // Só vídeos de verdade: nada de pasta, de arquivo oculto nem do lixo do macOS (__MACOSX/._*).
        if (ehPasta || !VIDEO_EXT.test(base) || base.startsWith('.') || entry.fileName.startsWith('__MACOSX')) {
          ignorados++;
          return zip.readEntry();
        }
        if (entry.uncompressedSize > MAX_VIDEO_BYTES) {
          ignorados++;
          return zip.readEntry();
        }
        if (adicionados.length >= MAX_VIDEOS_POR_ZIP) return encerrar();
        total += entry.uncompressedSize;
        if (total > MAX_ZIP_BYTES) return encerrar(new BadRequestException(`Os vídeos do .zip passam do limite de ${Math.round(MAX_ZIP_BYTES / 1024 / 1024)} MB`));
        const e = (VIDEO_EXT.exec(base)?.[0] ?? '').toLowerCase();
        const id = `${crypto.randomUUID()}${e}`;
        const destino = path.join(dir, id);
        zip.openReadStream(entry, (er, stream) => {
          if (er || !stream) {
            ignorados++;
            return zip.readEntry();
          }
          pipeline(stream, fs.createWriteStream(destino))
            .then(() => {
              const size = fs.existsSync(destino) ? fs.statSync(destino).size : 0;
              if (!size) {
                fs.rmSync(destino, { force: true });
                ignorados++;
                return zip.readEntry();
              }
              fs.writeFileSync(path.join(dir, `${id}.nome`), nomeDisplaySeguro(base));
              adicionados.push({ id, nome: nomeDisplaySeguro(base), bytes: size, caminho: `midia/entrada/${id}`, pasta: 'entrada' });
              zip.readEntry();
            })
            .catch((e2) => encerrar(e2));
        });
      });
    });
  });
}

/** Pastas que a varredura NUNCA importa (o repositório, o git, auxiliares). */
const PASTAS_FORA_DA_VARREDURA = new Set(['repo', 'worktrees', '.nivoo', 'conhecimento', 'contexto', '.git', 'node_modules', 'saida']);

/**
 * Varre a pasta do projeto (root) atrás de vídeos que o usuário colocou "na mão" (ex.: por SCP/FTP, direto no
 * servidor) e MOVE cada um para midia/entrada — assim aparecem na tela e para a IA mesmo que tenham caído na pasta
 * errada. Ignora o repositório/git e o que já está em midia/entrada. O nome em disco é um id gerado (sem zip-slip).
 */
export function importarVideosDaPasta(root: string, midia: string): { adicionados: VideoDaMidia[] } {
  const entrada = entradaDir(midia);
  fs.mkdirSync(entrada, { recursive: true });
  const achados: string[] = [];
  const visitar = (dir: string, nivel: number) => {
    if (nivel > 6) return;
    let itens: fs.Dirent[];
    try {
      itens = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const it of itens) {
      if (it.isSymbolicLink()) continue;
      const abs = path.join(dir, it.name);
      if (it.isDirectory()) {
        if (PASTAS_FORA_DA_VARREDURA.has(it.name)) continue;
        visitar(abs, nivel + 1);
      } else if (it.isFile() && VIDEO_EXT.test(it.name) && path.dirname(abs) !== entrada) {
        achados.push(abs);
      }
    }
  };
  visitar(root, 0);
  const adicionados: VideoDaMidia[] = [];
  for (const abs of achados) {
    try {
      if (!fs.statSync(abs).size) continue;
      const e = (VIDEO_EXT.exec(abs)?.[0] ?? '').toLowerCase();
      const id = `${crypto.randomUUID()}${e}`;
      const destino = path.join(entrada, id);
      try {
        fs.renameSync(abs, destino);
      } catch {
        fs.copyFileSync(abs, destino); // outro sistema de arquivos: copia e apaga a origem
        fs.rmSync(abs, { force: true });
      }
      fs.writeFileSync(path.join(entrada, `${id}.nome`), nomeDisplaySeguro(path.basename(abs)));
      adicionados.push({ id, nome: nomeDisplaySeguro(path.basename(abs)), bytes: fs.statSync(destino).size, caminho: `midia/entrada/${id}`, pasta: 'entrada' });
    } catch {
      /* o que não der para mover, ignora */
    }
  }
  return { adicionados };
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
