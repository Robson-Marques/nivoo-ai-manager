import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { architectureContext,architectureTargets } from '../../src/specialties/software/architecture-context';

describe('Navegação de engenharia',()=>{
  let root:string;
  beforeEach(()=>root=fs.mkdtempSync(path.join(os.tmpdir(),'nivoo-architecture-')));
  afterEach(()=>fs.rmSync(root,{recursive:true,force:true}));
  function put(name:string,content:string){
    const file=path.join(root,name);
    fs.mkdirSync(path.dirname(file),{recursive:true});
    fs.writeFileSync(file,content);
  }
  it('não escolhe nomes ambíguos nem caminhos externos',()=>{
    const files=['src/a.ts','lib/a.ts','src/b.ts'];
    expect(architectureTargets('a.ts src/b.ts:8 ../a.ts',files)).toEqual({targets:['src/b.ts'],ambiguous:['a.ts: src/a.ts, lib/a.ts']});
  });
  it('usa fontes reais e aponta referências diretas sem ler links ou segredos',()=>{
    put('package.json','{}');
    put('src/service.ts','export const f=()=>1;');
    put('src/controller.ts',"import {f} from './service'; export const g=f();");
    put('src/other.ts',"// import './service';\nexport const sample='import ./service';");
    put('node_modules/dependency/index.ts','');
    put('.env','SECRET');
    put('credentials.json','SECRET');
    fs.symlinkSync(path.join(root,'src'),path.join(root,'link'));
    const guidance=architectureContext(root,'Corrigir src/service.ts').join('\n');
    const page=fs.readFileSync(path.join(root,'contexto/acervo/arquitetura-001.md'),'utf8');
    expect(guidance).toContain('contexto/acervo/arquitetura-indice.md');
    expect(page).toContain('src/controller.ts -> src/service.ts');
    expect(page).not.toContain('src/other.ts ->');
    expect(page).not.toContain('node_modules/dependency');
    expect(page).not.toContain('credentials.json');
    expect(page).not.toContain('link/service.ts');
    expect(page).not.toContain('SECRET');
  });
  it('não varre imports sem alvo explícito',()=>{
    put('app.ts','export const a=1;');
    architectureContext(root,'Ajustar arquitetura');
    expect(fs.readFileSync(path.join(root,'contexto/acervo/arquitetura-001.md'),'utf8')).toContain('não foi feita varredura de imports');
  });
});
