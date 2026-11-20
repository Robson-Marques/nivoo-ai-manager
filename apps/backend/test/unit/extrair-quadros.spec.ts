import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

describe('nivoo-extrair-quadros', () => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'nivoo-quadros-test-'));
  const bin = path.resolve(__dirname, '../../bin/nivoo-extrair-quadros');
  beforeAll(() => {
    fs.mkdirSync(path.join(pasta, 'fake-bin'), { recursive: true });
    fs.writeFileSync(path.join(pasta, 'video.mp4'), 'teste');
    // Simula apenas a saída sequencial do FFmpeg para isolar o contrato do CLI.
    const fake = [
      '#!/usr/bin/env node',
      "const fs=require('node:fs'),path=require('node:path');",
      "const a=process.argv.slice(2);",
      "const frame=Number(a[a.indexOf('-frames:v')+1]);",
      "const pad=a[a.indexOf('-start_number')+1];",
      "if(a[a.indexOf('-vf')+1].includes('select='))process.exit(87);",
      "const f=a.at(-1);",
      "for(let i=Number(pad);i<frame;i++){const p=f.replace('%06d',String(i).padStart(6,'0'));fs.writeFileSync(p,'PNG');}",
    ].join('\n');
    const ff = path.join(pasta, 'fake-bin', 'ffmpeg');
    fs.writeFileSync(ff, fake, { mode: 0o755 });
  });
  afterAll(() => fs.rmSync(pasta, { recursive: true, force: true }));
  it('extrai índices pedidos sem filtro select gigante', () => {
    const result = spawnSync(process.execPath, [
      bin, 'video.mp4', '--pasta', 'out/quadros', '--indices', '0,2,4', '--largura', '540'
    ], { cwd: pasta, env: { ...process.env, PATH: path.join(pasta, 'fake-bin') + ':' + process.env.PATH }, encoding: 'utf8' });
    expect(result.status).toBe(0);
    const saida = path.join(pasta, 'out', 'quadros');
    expect(JSON.parse(fs.readFileSync(path.join(saida, 'quadros.json'), 'utf8')).frames).toEqual([0,2,4]);
    expect(fs.readdirSync(saida).filter(f => f.endsWith('.png')).sort()).toEqual([
      'quadro-000000.png', 'quadro-000002.png', 'quadro-000004.png'
    ]);
  });
  it('rejeita caminhos fora de out/', () => {
    const result = spawnSync(process.execPath, [bin, 'video.mp4', '--pasta', '../escape'], { cwd: pasta, encoding: 'utf8' });
    expect(result.status).toBe(2);
  });
});
