'use strict';
// Teste isolado, sem browser, IA, banco ou GitHub Actions.
// Executar com: node apps/backend/test/motion-offline-render-smoke.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { renderMotionOffline } = require('../bin/motion-offline-render');

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nivoo-offline-test-'));
  const frames = [
    Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAF0lEQVR4nGP8z0AaYCJR/aiGUQ1DSAMAQC4BH2bjRnMAAAAASUVORK5CYII=', 'base64'),
    Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAGElEQVR4nGNk+M9AEmAiTfmohlENQ0kDAD8vAR9zDRbLAAAAAElFTkSuQmCC', 'base64'),
  ];
  let calls = 0;
  let ticks = 0;
  let pauseCalls = 0;
  const page = {
    clock: {
      pauseAt: async () => { pauseCalls++; },
      runFor: async ms => { ticks += ms; },
    },
    evaluate: async () => Date.now(),
    screenshot: async () => frames[(calls++) % 2],
  };
  try {
    const output = path.join(dir, 'motion.mp4');
    const result = await renderMotionOffline({ page, outputPath: output, seconds: 0.4, width: 16, height: 16 });
    assert.equal(result.frames, 10);
    assert.equal(result.fps, 25);
    assert.equal(calls, 10);
    assert.equal(pauseCalls, 1);
    assert.equal(ticks, 360);
    const probe = spawnSync('ffprobe', ['-v','error','-select_streams','v:0','-show_entries','stream=nb_frames,avg_frame_rate','-of','json',output], { encoding:'utf8' });
    assert.equal(probe.status, 0);
    assert.equal(Number(JSON.parse(probe.stdout).streams[0].nb_frames), 10);
    console.log('OK: captura offline 10 quadros, 25 fps, relógio controlado, MP4 válido');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
