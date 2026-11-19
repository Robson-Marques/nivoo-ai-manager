import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

describe('importação determinística de anexos de imagem', () => {
  const script = path.resolve(__dirname, '../../bin/nivoo-importar-imagem');
  let root: string;
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'nivoo-import-')); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });
  const run=(origem:string,destino:string)=>spawnSync(process.execPath,[script,origem,destino],{cwd:root,encoding:'utf8'});
  const fixture = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLJLAAAAABJRU5ErkJggg==','base64');

  it('copia PNG real de anexo para o destino do projeto',()=>{
    const folder=path.join(root,'contexto/anexos/1234-5678');
    fs.mkdirSync(folder,{recursive:true});
    fs.writeFileSync(path.join(folder,'pizza-lombo.png'),fixture);
    const result=run('contexto/anexos/1234-5678/pizza-lombo.png','motion/pizza-lombo.png');
    expect(result.status).toBe(0);
    expect(fs.readFileSync(path.join(root,'motion/pizza-lombo.png'))).toEqual(fixture);
  });

  it('rejeita fuga do workspace por destino',()=>{
    const result=run('contexto/anexos/1234-5678/pizza-lombo.png','../escape.png');
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/destino inválido/i);
  });

  it('não sobrescreve imagem existente',()=>{
    const folder=path.join(root,'contexto/anexos/1234-5678');
    fs.mkdirSync(folder,{recursive:true});
    fs.writeFileSync(path.join(folder,'pizza-lombo.png'),fixture);
    const dest=path.join(root,'motion/pizza.png');
    fs.mkdirSync(path.dirname(dest),{recursive:true});
    fs.writeFileSync(dest,Buffer.from('anterior'));
    const result=run('contexto/anexos/1234-5678/pizza-lombo.png','motion/pizza.png');
    expect(result.status).not.toBe(0);
    expect(fs.readFileSync(dest,'utf8')).toBe('anterior');
  });
});
