import { BadRequestException, Logger } from '@nestjs/common';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Readable, Transform, Writable } from 'node:stream';
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
export const AUDIO_EXT = /\.(wav|mp3|m4a|aac|ogg|flac)$/i;
/** Mídia que entra no projeto para a montagem: vídeo OU áudio (trilha/narração própria do usuário). */
export const MIDIA_EXT = /\.(mp4|mov|webm|mkv|m4v|wav|mp3|m4a|aac|ogg|flac|png|jpg|jpeg|webp)$/i;
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
  return (MIDIA_EXT.exec(nome)?.[0] ?? '').toLowerCase();
}

/** Nome visível seguro (sem pastas), só para mostrar; o arquivo em disco usa um id gerado. Aceita vídeo E áudio
 * (a trilha/narração própria do usuário também entra na mídia do projeto, para a montagem usar). */
export function nomeSeguroVideo(raw: unknown): string {
  const base = path.basename(String(raw ?? '').replace(/\\/g, '/')).replace(/[\u0000-\u001f<>:"|?*]/g, '_').trim();
  if (!base || !MIDIA_EXT.test(base) || base.length > 150) throw new BadRequestException('Envie um vídeo (MP4, MOV, WEBM, MKV, M4V) ou áudio (WAV, MP3, M4A, AAC, OGG, FLAC)');
  return base;
}

const entradaDir = (midia: string) => path.join(midia, 'entrada');
const saidaDir = (midia: string) => path.join(midia, 'saida');

/** Consome um corpo repetido sem guardá-lo, conferindo que é exatamente o pedaço que o cliente declarou. */
async function consumirCorpoExato(corpo: Readable, tamanho: number): Promise<void> {
  let recebidos = 0;
  try {
    await pipeline(corpo, new Writable({
      write(chunk: Buffer, _enc, cb) {
        recebidos += chunk.length;
        cb(recebidos > tamanho ? new Error('TAMANHO') : undefined);
      },
    }));
  } catch {
    throw new BadRequestException('Repetição do pedaço chegou com tamanho diferente');
  }
  if (recebidos !== tamanho) throw new BadRequestException('Repetição do pedaço chegou com tamanho diferente');
}

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

/**
 * Upload EM PEDAÇOS (robusto para arquivo grande): cada pedaço é uma requisição pequena que termina rápido, então um
 * engasgo da rede trava só um pedaço (que o app reenvia), nunca o arquivo inteiro. Os pedaços vão para um arquivo
 * temporário midia/entrada/.partes/<uploadId>.part (append, na ordem); no último (final=true) ele vira o vídeo real.
 * O uploadId é do cliente (um token) e o offset tem que bater com o tamanho atual (envio sequencial).
 */
export async function gravarPedacoDeVideo(
  midia: string,
  nome: string,
  uploadId: string,
  offset: number,
  tamanhoEsperado: number | undefined,
  isFinal: boolean,
  corpo: Readable,
): Promise<VideoDaMidia | { ok: true; bytes: number }> {
  const nomeOk = nomeSeguroVideo(nome); // valida a extensão (vídeo/áudio) antes de aceitar pedaços
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(String(uploadId))) throw new BadRequestException('uploadId inválido');
  if (!Number.isInteger(offset) || offset < 0) throw new BadRequestException('offset inválido');
  if (tamanhoEsperado !== undefined && (!Number.isInteger(tamanhoEsperado) || tamanhoEsperado < 0 || tamanhoEsperado > MAX_VIDEO_BYTES)) {
    throw new BadRequestException('tamanho do pedaço inválido');
  }
  const dir = entradaDir(midia);
  const tmpDir = path.join(dir, '.partes');
  fs.mkdirSync(tmpDir, { recursive: true });
  limparPartesVelhas(tmpDir);
  const part = path.join(tmpDir, `${uploadId}.part`);
  const concluido = path.join(tmpDir, `${uploadId}.done.json`);

  // O último pedaço também é idempotente: se a resposta final se perdeu, devolve o MESMO arquivo/caminho em vez de
  // tentar criar outro ou deixar o compositor preso em 99%.
  if (isFinal && tamanhoEsperado !== undefined && fs.existsSync(concluido)) {
    try {
      const salvo = JSON.parse(fs.readFileSync(concluido, 'utf8')) as { nome: string; offset: number; tamanho: number; resultado: VideoDaMidia };
      if (salvo.nome === nomeOk && salvo.offset === offset && salvo.tamanho === tamanhoEsperado && salvo.resultado?.caminho) {
        await consumirCorpoExato(corpo, tamanhoEsperado);
        LOG_MIDIA.log(`upload (pedaços) final repetido confirmado "${nomeOk}" → ${salvo.resultado.bytes} bytes`);
        return salvo.resultado;
      }
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      // Marcador corrompido/incompatível: segue para a validação normal, que dará um erro claro de offset.
    }
  }
  let atual = fs.existsSync(part) ? fs.statSync(part).size : 0;

  // A resposta do pedido anterior pode ter se perdido depois que o servidor já gravou tudo. Nesse caso o navegador
  // repete o MESMO pedaço: consumimos o corpo e confirmamos o offset atual, sem anexar os bytes pela segunda vez.
  if (tamanhoEsperado !== undefined && offset < atual && offset + tamanhoEsperado === atual) {
    await consumirCorpoExato(corpo, tamanhoEsperado);
    LOG_MIDIA.log(`upload (pedaços) repetido confirmado "${nomeOk}" offset ${offset} → ${atual} bytes`);
    return { ok: true, bytes: atual };
  }

  // Processo/servidor caiu no meio do pedaço: descarta somente a parte incompleta dele e retoma do offset pedido.
  if (tamanhoEsperado !== undefined && offset < atual && atual < offset + tamanhoEsperado) {
    fs.truncateSync(part, offset);
    atual = offset;
  }
  if (offset !== atual) throw new BadRequestException(`Pedaço fora de ordem: esperava offset ${atual}, veio ${offset}`);
  let bytes = atual;
  const limite = MAX_VIDEO_BYTES;
  const t0 = Date.now();
  LOG_MIDIA.log(`upload (pedaços) recebendo "${nomeOk}" offset ${offset}${tamanhoEsperado === undefined ? '' : ` + ${tamanhoEsperado}`}`);
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
    await pipeline(corpo, contador, fs.createWriteStream(part, { flags: 'a' }));
  } catch (err: any) {
    // Nunca perde os pedaços anteriores por uma queda no pedaço atual: volta exatamente ao tamanho confirmado.
    try { fs.truncateSync(part, atual); } catch { /* o erro original é mais útil */ }
    LOG_MIDIA.warn(`upload (pedaços) FALHOU "${nomeOk}" offset ${offset} em ${Date.now() - t0}ms: ${String(err?.message ?? err).slice(0, 160)}`);
    if (err?.estourou) throw new BadRequestException(`O vídeo passa do limite de ${Math.round(limite / 1024 / 1024)} MB`);
    if (err?.code === 'ENOSPC') throw new BadRequestException('Sem espaço em disco no servidor para gravar o vídeo. Libere espaço (ex.: backups antigos) e tente de novo.');
    throw err;
  }
  if (tamanhoEsperado !== undefined && bytes - atual !== tamanhoEsperado) {
    fs.truncateSync(part, atual);
    throw new BadRequestException(`Pedaço incompleto: esperava ${tamanhoEsperado} bytes, recebeu ${bytes - atual}`);
  }
  LOG_MIDIA.log(`upload (pedaços) OK "${nomeOk}" offset ${offset} → ${bytes} bytes em ${Date.now() - t0}ms`);
  if (!isFinal) return { ok: true, bytes };
  // Último pedaço: o .part vira o vídeo de verdade em midia/entrada/<id>.
  const e = ext(nomeOk);
  const id = `${crypto.randomUUID()}${e}`;
  const destino = path.join(dir, id);
  fs.renameSync(part, destino);
  const salvo = fs.existsSync(destino) ? fs.statSync(destino).size : 0;
  LOG_MIDIA.log(`upload (pedaços) OK "${nomeOk}" → ${salvo} bytes`);
  if (!salvo) {
    fs.rmSync(destino, { force: true });
    throw new BadRequestException('O vídeo chegou vazio (0 byte).');
  }
  fs.writeFileSync(path.join(dir, `${id}.nome`), nomeOk);
  const resultado: VideoDaMidia = { id, nome: nomeOk, bytes: salvo, caminho: `midia/entrada/${id}`, pasta: 'entrada' };
  // Pequeno marcador fora da listagem de mídia, limpo junto com restos de upload após 6h.
  fs.writeFileSync(concluido, JSON.stringify({ nome: nomeOk, offset, tamanho: bytes - atual, resultado }));
  return resultado;
}

/** Remove restos de upload em pedaços parados há mais de 6h (envio abandonado). */
function limparPartesVelhas(tmpDir: string): void {
  try {
    const agora = Date.now();
    for (const f of fs.readdirSync(tmpDir)) {
      const p = path.join(tmpDir, f);
      try {
        if (agora - fs.statSync(p).mtimeMs > 6 * 3600 * 1000) fs.rmSync(p, { force: true });
      } catch {
        /* ignora */
      }
    }
  } catch {
    /* sem pasta de partes ainda */
  }
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
      .filter((f) => MIDIA_EXT.test(f))
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
  if (!m || !MIDIA_EXT.test(m[2])) return null;
  const abs = path.resolve(midia, m[1], m[2]);
  if (abs !== path.resolve(midia, m[1], path.basename(m[2]))) return null;
  return fs.existsSync(abs) ? abs : null;
}

/** Apaga um vídeo enviado (só da pasta entrada; os editados saíram de um trabalho). */
export function apagarVideoEnviado(midia: string, id: string): boolean {
  if (!MIDIA_EXT.test(id) || path.basename(id) !== id) return false;
  const abs = path.join(entradaDir(midia), id);
  if (!fs.existsSync(abs)) return false;
  fs.rmSync(abs, { force: true });
  fs.rmSync(`${abs}.nome`, { force: true });
  fs.rmSync(`${abs}.roteiro.txt`, { force: true });
  return true;
}
