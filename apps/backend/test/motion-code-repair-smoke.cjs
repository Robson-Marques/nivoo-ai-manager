'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { fixWebglPizzaAndRhythm, run } = require('../bin/nivoo-ajustar-motion');

const fixture = [
  '<title>Black na sua Quinta · Nivoo Gastronomia · 3D v3</title>',
  '<script>',
  'window.__motionSegundos = 25;',
  'function exemplo() {',
  'gl.enable(gl.DEPTH_TEST);',
  '      for (let k = 0; k < 3; k++) {',
  '        const z = 17 + k * 3, top = k === 2;',
  '        blend.push({ z, f: () => draw(QUAD, M.chain(M.T(cxs + E.dx, wy(cys) - E.dy + E.hover - (2 - k) * 2.2, z), M.Rz(-rot * DEG), M.Rx(E.tilt), M.S(E.s, E.s, 1), M.S(w, h, 1)),',
  '          { mode: 1, tex: imgTex, alpha: E.a, tint: top ? [1, 1, 1] : [.38, .3, .24] }) });',
  '      }',
  '  function renderAt(t) {',
  '    const P = pose(t);',
  '  }',
  '  renderAt(clamp(Number(q), 0, 25));',
  '  const t = Math.min(25, (now - t0) / 1000);',
  '  if (t < 25) requestAnimationFrame(tick);',
  '}',
  '</script>'
].join('\n');
const fixed = fixWebglPizzaAndRhythm(fixture);
assert.match(fixed, /window.__motionSegundos = 20/);
assert.match(fixed, /const fotoZ = 34/);
assert.match(fixed, /M\.Rz\(-rot \* DEG \+ E\.tilt \* \.28\)/);
assert.doesNotMatch(fixed, /M\.Rx\(E\.tilt\)/);
assert.doesNotMatch(fixed, /tint: top/);
assert.match(fixed, /const RITMO =/);
assert.match(fixed, /pose\(tempoDaCena\(t\)\)/);
const script = fixed.match(/<script>([\s\S]*?)<\/script>/)?.[1];
new vm.Script(script);
assert.throws(() => fixWebglPizzaAndRhythm(fixed), /já contém a correção/);
assert.throws(() => fixWebglPizzaAndRhythm(fixture.replace('M.Rx(E.tilt)', 'M.Ry(E.tilt)')), /não reconhecida/);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nivoo-webgl-fix-'));
try {
  const old = path.join(dir, 'motion', 'black-v3');
  const output = path.join(dir, 'motion', 'black-v3-fix');
  fs.mkdirSync(old, { recursive: true });
  fs.writeFileSync(path.join(old, 'index.html'), fixture);
  run([old, '--saida', output]);
  assert.equal(fs.readFileSync(path.join(old, 'index.html'), 'utf8'), fixture);
  assert.match(fs.readFileSync(path.join(output, 'index.html'), 'utf8'), /NIVOO_WEBGL_PIZZA_FIX_V1/);
  assert.throws(() => run([old, '--saida', output]), /já existe/);
  assert.throws(() => run([old, '--saida', old]), /origem deve permanecer intacta/);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log('OK: motion WebGL sem recorte por profundidade, neon BLACK mais rápido, backup natural da fonte original.');
