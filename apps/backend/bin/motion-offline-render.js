'use strict';

// Captura offline: o relógio da animação avança somente depois que o quadro
// anterior foi renderizado. FFmpeg codifica PNGs por pipe, sem WebM ao vivo.
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');

const FRAME_RATE = 25;

async function renderMotionOffline({ page, outputPath, seconds, width, height, fps = FRAME_RATE, onProgress = () => {} }) {
  const frames = Math.round(seconds * fps);
  if (!Number.isSafeInteger(frames) || frames < 1 || frames > 300 * fps) {
    throw new Error('Duração de vídeo inválida para captura offline');
  }
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const partial = path.join(path.dirname(outputPath), `.${path.basename(outputPath, '.mp4')}.${process.pid}.part.mp4`);
  const args = [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'image2pipe', '-framerate', String(fps), '-vcodec', 'png', '-i', 'pipe:0',
    '-an', '-frames:v', String(frames), '-c:v', 'libx264', '-preset', 'veryfast',
    '-crf', '18', '-pix_fmt', 'yuv420p', '-r', String(fps),
    '-movflags', '+faststart', partial,
  ];
  const ffmpeg = spawn('ffmpeg', args, { stdio: ['pipe', 'ignore', 'pipe'] });
  let stderr = '';
  let inputError = null;
  ffmpeg.stderr.on('data', chunk => { stderr = (stderr + String(chunk)).slice(-3000); });
  ffmpeg.stdin.on('error', err => { inputError = err; });
  const processDone = new Promise((resolve, reject) => {
    ffmpeg.once('error', reject);
    ffmpeg.once('close', code => resolve(code));
  });
  processDone.catch(() => undefined);
  let done = false;
  try {
    // A instalação do clock deve acontecer ANTES de carregar a animação.
    await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now())));
    for (let frame = 0; frame < frames; frame++) {
      if (frame) await page.clock.runFor(1000 / fps);
      if (inputError || ffmpeg.exitCode !== null || ffmpeg.signalCode !== null) {
        throw new Error(`FFmpeg parou antes do quadro ${frame}: ${inputError?.message || stderr}`);
      }
      const png = await page.screenshot({ type: 'png', animations: 'allow', caret: 'hide', timeout: 120000 });
      if (!Buffer.isBuffer(png) || png.length === 0) throw new Error(`Quadro ${frame} vazio`);
      if (!ffmpeg.stdin.write(png)) {
        await Promise.race([
          once(ffmpeg.stdin, 'drain'),
          processDone.then(code => { throw new Error(`FFmpeg encerrou antes do quadro ${frame}: ${code} ${stderr}`); }),
        ]);
      }
      if ((frame + 1) % (fps * 5) === 0 || frame + 1 === frames) onProgress(frame + 1, frames);
    }
    ffmpeg.stdin.end();
    const rc = await processDone;
    if (rc !== 0) throw new Error(`FFmpeg falhou (${rc}): ${stderr}`);

    const probe = spawnSync('ffprobe', [
      '-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=nb_frames,width,height,avg_frame_rate',
      '-of', 'json', partial,
    ], { encoding: 'utf8' });
    if (probe.status !== 0) throw new Error(`MP4 não passou no ffprobe: ${probe.stderr}`);
    const stream = JSON.parse(probe.stdout).streams?.[0];
    if (!stream || Number(stream.nb_frames) !== frames || stream.width !== width || stream.height !== height || stream.avg_frame_rate !== `${fps}/1`) {
      throw new Error(`MP4 gerado com quadros, resolução ou FPS incorretos: ${JSON.stringify(stream)}`);
    }
    fs.renameSync(partial, outputPath);
    done = true;
    return { frames, fps, bytes: fs.statSync(outputPath).size };
  } finally {
    if (!done) {
      if (!ffmpeg.killed && ffmpeg.exitCode === null) ffmpeg.kill('SIGTERM');
      ffmpeg.stdin.destroy();
      fs.rmSync(partial, { force: true });
    }
  }
}
module.exports = { FRAME_RATE, renderMotionOffline };
