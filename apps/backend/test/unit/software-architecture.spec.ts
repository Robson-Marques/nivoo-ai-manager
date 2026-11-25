import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { architectureContext,architectureTargets,architecturalDocumentPaths } from '../../src/specialties/software/architecture-context';

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
  it('indexa decisões e documentação sem ler conteúdo ou criar READMEs',()=>{
    put('README.md','RAIZ_ORIGINAL');
    put('docs/adr/001-storage.md','DECISAO_ORIGINAL');
    put('docs/designs/payment.md','DESIGN_ORIGINAL');
    put('packages/core/EGM.md','CONTRATO_ORIGINAL');
    put('docs/adr/diagram.png','imagem');
    put('src/design/components.ts','');
    put('docs/marketing/campaign.md','');
    put('docs/architecture/.hidden.md','segredo');
    fs.symlinkSync(path.join(root,'docs/adr'),path.join(root,'docs/decisions'));
    const candidates=architecturalDocumentPaths(['README.md','docs/adr/001-storage.md','docs/designs/payment.md','packages/core/EGM.md','docs/adr/diagram.png','src/design/components.ts','docs/marketing/campaign.md']);
    expect(candidates).toEqual(['README.md','docs/adr/001-storage.md','docs/designs/payment.md','packages/core/EGM.md']);
    architectureContext(root,'Mapear contexto arquitetural');
    const page=fs.readFileSync(path.join(root,'contexto/acervo/arquitetura-001.md'),'utf8');
    const docs=page.split('## Documentação arquitetural encontrada')[1].split('## Arquivos citados na tarefa')[0];
    expect(docs).toContain('docs/adr/001-storage.md');
    expect(docs).toContain('docs/designs/payment.md');
    expect(docs).toContain('packages/core/EGM.md');
    expect(docs).not.toContain('docs/marketing/campaign.md');
    expect(docs).not.toContain('docs/adr/diagram.png');
    expect(page).not.toContain('docs/architecture/.hidden.md');
    expect(page).not.toContain('docs/decisions/001-storage.md');
    expect(page).not.toContain('DECISAO_ORIGINAL');
    expect(fs.readFileSync(path.join(root,'README.md'),'utf8')).toBe('RAIZ_ORIGINAL');
    expect(fs.existsSync(path.join(root,'packages/core/README.md'))).toBe(false);
  });
  it('não varre imports sem alvo explícito',()=>{
    put('app.ts','export const a=1;');
    architectureContext(root,'Ajustar arquitetura');
    expect(fs.readFileSync(path.join(root,'contexto/acervo/arquitetura-001.md'),'utf8')).toContain('não foi feita varredura de imports');
  });
});
