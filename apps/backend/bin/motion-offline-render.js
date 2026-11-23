'use strict';

// Motion sem depender da velocidade da gravação em tempo real.
// Quadros JPEG individuais são persistidos por projeto até a captura terminar;
// uma falha, update ou timeout não descarta os quadros já produzidos.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawn } = require('node:child_process');

const FRAME_RATE = 25;
const MAX_SOURCE_FILES = 3000;
const MAX_SOURCE_BYTES = 512 * 1024 * 1024;

/**
 * Inicializa o relógio virtual em uma data conhecida e pausa ANTES do goto.
 * Um deslocamento de 60s evita arredondamento/atraso entre install e pauseAt.
 * Como a página ainda está vazia, nenhum timer da composição é avançado.
 */
async function prepareMotionClock(page, epochMs) {
  if (!Number.isFinite(epochMs)) throw new Error('Tempo inicial da composição inválido');
  await page.clock.install({ time: new Date(epochMs) });
  await page.clock.pauseAt(new Date(epochMs + 60_000));
}

function sourceFingerprint(sourcePath) {
  // Animadores normalmente usam motion/<cena>/index.html e assets de cenas
  // vizinhas. Para HTML fora da pasta motion, não varrer o projeto inteiro.
  let root = path.resolve(path.dirname(sourcePath));
  // Cenas declarativas têm assets locais à própria cena. Não recalcular
  // centenas de hashes por vídeos não relacionados de outras pastas motion.
  if (path.basename(sourcePath) !== 'scene.json') {
    for (let atual = root; path.dirname(atual) !== atual; atual = path.dirname(atual)) {
      if (path.basename(atual) === 'motion') { root = atual; break; }
    }
  }
  const hasher = createHash('sha256');
  let arquivos = 0, bytes = 0;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue; // não visitar links para fora da pasta do trabalho
      if (entry.isDirectory()) { walk(full); continue; }
      if (!entry.isFile()) continue;
      const stat = fs.statSync(full);
      arquivos++;
      bytes += stat.size;
      if (arquivos > MAX_SOURCE_FILES || bytes > MAX_SOURCE_BYTES) {
        throw new Error('Pasta motion grande demais para validar cache de quadros com segurança');
      }
      hasher.update(path.relative(root, full).replace(/\\/g, '/') + '\0');
      hasher.update(String(stat.size) + '\0');
      const fd = fs.openSync(full, 'r');
      try {
        const buf = Buffer.allocUnsafe(65536);
        let count;
        while ((count = fs.readSync(fd, buf, 0, buf.length, null)) > 0) hasher.update(buf.subarray(0, count));
      } finally { fs.closeSync(fd); }
    }
  };
  walk(root);
  return hasher.digest('hex');
}

function validJpeg(filename) {
  try {
    const stat = fs.statSync(filename);
    if (!stat.isFile() || stat.size < 100) return false;
    const fd = fs.openSync(filename, 'r');
    try {
      const start = Buffer.allocUnsafe(2), end = Buffer.allocUnsafe(2);
      fs.readSync(fd, start, 0, 2, 0);
      fs.readSync(fd, end, 0, 2, stat.size - 2);
      return start[0] === 0xff && start[1] === 0xd8 && end[0] === 0xff && end[1] === 0xd9;
    } finally { fs.closeSync(fd); }
  } catch { return false; }
}

/** Mapeia quadros da saída para tempo da composição original. */
function mapMotionTime(time, outputDuration, pacing) {
  if (!pacing) return time;
  const src = pacing.sourceDuration;
  const openingEnd = pacing.openingEnd, openingSeconds = pacing.openingSeconds;
  if (!Number.isFinite(src) || src <= 0 || !Number.isFinite(outputDuration) || outputDuration <= 0)
    throw new Error('Ritmo motion: duração de origem/saída inválida');
  if (openingEnd === undefined && openingSeconds === undefined) return time * src / outputDuration;
  if (!Number.isFinite(openingEnd) || !Number.isFinite(openingSeconds) ||
      openingEnd <= 0 || openingEnd >= src || openingSeconds <= 0 || openingSeconds >= outputDuration)
    throw new Error('Ritmo motion: duração da abertura inválida');
  const t=Math.max(0,Math.min(time,outputDuration));
  return t <= openingSeconds ? t*openingEnd/openingSeconds :
    openingEnd+(t-openingSeconds)*(src-openingEnd)/(outputDuration-openingSeconds);
}

function prepareFrameCache({ outputPath, sourcePath, seconds, width, height, fps = FRAME_RATE, pacing = null }) {
  if (!sourcePath || !fs.existsSync(sourcePath)) throw new Error('Fonte HTML da animação não encontrada para reutilizar quadros');
  const frames = Math.round(seconds * fps);
  if (!Number.isSafeInteger(frames) || frames < 1 || frames > 300 * fps) throw new Error('Duração de vídeo inválida');
  const fingerprint = sourceFingerprint(sourcePath);
  const signature = createHash('sha256')
    .update(JSON.stringify({ outputPath: path.resolve(outputPath), sourcePath: path.resolve(sourcePath), fingerprint, frames, width, height, fps, pacing }))
    .digest('hex').slice(0, 24);
  const cacheDir = path.join(path.dirname(outputPath), '.nivoo-motion-cache', signature);
  fs.mkdirSync(cacheDir, { recursive: true });
  return { cacheDir, frames, fingerprint };
}

function execute(cmd, args, onProgress = () => {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    p.stderr.on('data', c => { stderr = (stderr + String(c)).slice(-5000); });
    p.once('error', reject);
    p.once('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} falhou (${code}): ${stderr || 'sem diagnóstico'}`));
    });
    onProgress(p);
  });
}

async function renderMotionOffline({ page, outputPath, sourcePath, seconds, width, height, fps = FRAME_RATE, pacing = null, onProgress = () => {} }) {
  const { cacheDir, frames, fingerprint } = prepareFrameCache({ outputPath, sourcePath, seconds, width, height, fps, pacing });
  const already = Array.from({ length: frames }, (_, frame) =>
    validJpeg(path.join(cacheDir, `${String(frame).padStart(6, '0')}.jpg`)));
  const reused = already.filter(Boolean).length;
  if (reused) onProgress({ done: reused, frames, reused, message: `reaproveitando ${reused}/${frames} quadros preservados` });
  let produced = 0;
  const hasMediaOverlay = await page.evaluate(() => typeof window.__nivooOverlayRenderAt === 'function');
  // A página já está pausada ANTES do primeiro goto pelo executável de
  // renderização. Não tentar pauseAt(Date.now()) aqui: o tempo avança entre
  // avaliar Date.now no browser e chamar pauseAt, causando "past".
  // Avançar o relógio mesmo ao reutilizar frames preserva o estado do JS.
  let previousMotionTime=0;
  for (let frame = 0; frame < frames; frame++) {
    const motionTime=mapMotionTime(frame/fps,seconds,pacing);
    if (frame) await page.clock.runFor(Math.max(0,(motionTime-previousMotionTime)*1000));
    previousMotionTime=motionTime;
    if (already[frame]) continue;
    // Overlay RGBA deve mostrar precisamente o mesmo tempo do WebGL de fundo,
    // mesmo que os assets da camada levem tempo adicional para carregar.
    if (hasMediaOverlay) await page.evaluate(t => window.__nivooOverlayRenderAt(t), motionTime);
    const jpg = await page.screenshot({ type: 'jpeg', quality: 90, animations: 'allow', caret: 'hide', timeout: 120000 });
    if (!Buffer.isBuffer(jpg) || jpg.length < 100 || jpg[0] !== 0xff || jpg[1] !== 0xd8 || jpg.at(-2) !== 0xff || jpg.at(-1) !== 0xd9) {
      throw new Error(`Quadro ${frame} JPEG inválido`);
    }
    const dst = path.join(cacheDir, `${String(frame).padStart(6, '0')}.jpg`);
    const tmp = dst + `.${process.pid}.tmp`;
    try {
      fs.writeFileSync(tmp, jpg);
      fs.renameSync(tmp, dst);
    } finally { fs.rmSync(tmp, { force: true }); }
    produced++;
    if (produced % fps === 0 || produced + reused === frames) {
      onProgress({ done: produced + reused, frames, reused, message: `quadros ${produced + reused}/${frames} (captura offline, ${reused} recuperados)` });
    }
  }
  for (let frame = 0; frame < frames; frame++) {
    if (!validJpeg(path.join(cacheDir, `${String(frame).padStart(6, '0')}.jpg`))) throw new Error(`Quadro ${frame} não foi preservado corretamente`);
  }
  if (sourceFingerprint(sourcePath) !== fingerprint) {
    throw new Error('Os arquivos da composição mudaram durante a renderização; os quadros existentes foram preservados e não será publicado um vídeo misturado.');
  }
  // Apenas agora o FFmpeg comprime. EPIPE do encerramento do navegador não
  // destrói a captura; JPEGs persistem até o MP4 ser validado e publicado.
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const partial = path.join(path.dirname(outputPath), `.${path.basename(outputPath, '.mp4')}.${process.pid}.part.mp4`);
  try {
    onProgress({ done: frames, frames, reused, message: `codificando ${frames} quadros JPEG com FFmpeg` });
    await execute('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y', '-framerate', String(fps),
      '-start_number', '0', '-i', path.join(cacheDir, '%06d.jpg'),
      '-frames:v', String(frames), '-an', '-c:v', 'libx264', '-preset', 'veryfast',
      '-crf', '18', '-pix_fmt', 'yuv420p', '-r', String(fps), '-movflags', '+faststart', partial,
    ]);
    const { spawnSync } = require('node:child_process');
    const probe = spawnSync('ffprobe', [
      '-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=nb_frames,width,height,avg_frame_rate', '-of', 'json', partial,
    ], { encoding: 'utf8' });
    if (probe.status !== 0) throw new Error(`FFprobe reprovou MP4: ${probe.stderr}`);
    const stream = JSON.parse(probe.stdout).streams?.[0];
    if (!stream || Number(stream.nb_frames) !== frames || stream.width !== width || stream.height !== height || stream.avg_frame_rate !== `${fps}/1`) {
      throw new Error(`MP4 com quadros, FPS ou resolução incorretos: ${JSON.stringify(stream)}`);
    }
    // Não substituir outro vídeo já existente. O planejador deve usar novo nome.
    fs.linkSync(partial, outputPath);
    fs.unlinkSync(partial);
    const bytes = fs.statSync(outputPath).size;
    fs.rmSync(cacheDir, { recursive: true, force: true });
    return { frames, fps, bytes, reused, fingerprint };
  } finally {
    fs.rmSync(partial, { force: true });
  }
}

module.exports = { FRAME_RATE, prepareMotionClock, sourceFingerprint, mapMotionTime, prepareFrameCache, renderMotionOffline };
