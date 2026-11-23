'use strict';
// Sem navegador, IA, banco, GitHub Actions nem acesso externo.
// Simula uma interrupção durante a captura e confirma retomada do checkpoint.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { renderMotionOffline, prepareFrameCache, prepareMotionClock } = require('../bin/motion-offline-render');

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nivoo-motion-resume-'));
  try {
    const events = [];
    const clockPage = {
      clock: {
        install: async ({ time }) => { events.push(['install', time.getTime()]); },
        pauseAt: async time => { events.push(['pauseAt', time.getTime()]); },
      },
      goto: async () => { events.push(['goto']); },
    };
    await prepareMotionClock(clockPage, 1234560000);
    await clockPage.goto('file:///motion/index.html');
    assert.deepEqual(events, [['install', 1234560000], ['pauseAt', 1234620000], ['goto']]);
    const sourcePath = path.join(dir, 'motion', 'v3', 'index.html');
    fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
    fs.writeFileSync(sourcePath, '<html>v3</html>');
    const jpgPath = path.join(dir, 'frame.jpg');
    const jpeg = spawnSync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi',
      '-i', 'color=c=red:s=16x16:d=1', '-frames:v', '1', jpgPath,
    ], { encoding: 'utf8' });
    assert.equal(jpeg.status, 0, jpeg.stderr);
    const sample = fs.readFileSync(jpgPath);
    const outputPath = path.join(dir, 'saida', 'motion.mp4');
    const opts = { outputPath, sourcePath, seconds: 0.4, width: 16, height: 16 };
    let firstCalls = 0;
    function page(screenshot) {
      return {
        clock: { pauseAt: async () => { throw new Error('helper não deve pausar relógio após goto'); }, runFor: async () => {} },
        evaluate: async () => Date.now(),
        screenshot,
      };
    }
    await assert.rejects(renderMotionOffline({
      ...opts,
      page: page(async () => {
        firstCalls++;
        if (firstCalls === 6) throw new Error('interrupção simulada');
        return sample;
      }),
    }), /interrupção simulada/);
    const cacheDir = prepareFrameCache(opts).cacheDir;
    assert.equal(fs.readdirSync(cacheDir).filter(f => f.endsWith('.jpg')).length, 5);
    let secondCalls = 0;
    const result = await renderMotionOffline({
      ...opts, page: page(async () => { secondCalls++; return sample; }),
    });
    assert.equal(firstCalls, 6);
    assert.equal(secondCalls, 5);
    assert.equal(result.reused, 5);
    assert.equal(result.frames, 10);
    assert.equal(result.fps, 25);
    assert.equal(fs.existsSync(cacheDir), false);
    const probe = spawnSync('ffprobe', [
      '-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height,nb_frames,avg_frame_rate',
      '-of', 'json', outputPath,
    ], { encoding: 'utf8' });
    assert.equal(probe.status, 0, probe.stderr);
    assert.deepEqual(JSON.parse(probe.stdout).streams[0],
      { width: 16, height: 16, avg_frame_rate: '25/1', nb_frames: '10' });
    const before = prepareFrameCache(opts).cacheDir;
    fs.writeFileSync(sourcePath, '<html>nova versão</html>');
    const after = prepareFrameCache(opts).cacheDir;
    assert.notEqual(before, after);
    console.log('OK: retoma 5 de 10 quadros, codifica 25 fps e invalida cache quando a composição muda');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
