import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { verifyAdoptionInventory,officialAdoptionComponents,adoptionInventorySpec } from '../../src/jobs/workflow/adoption-evidence';
import { liquidGlassTemplate,LIQUI_UPSTREAM_COMMIT } from '../../src/projects/liquid-glass-template';
import { liquidGlassIntegratedFiles } from '../../src/projects/liquid-glass-components';
import type { Adoption } from '../../src/jobs/workflow/adoption-contract';

const PKG='design-system/liquid-glass';
const SOURCE='https://github.com/leefanv/liqui-design';
function write(root:string,rel:string,content:string){
  const full=path.join(root,rel);
  fs.mkdirSync(path.dirname(full),{recursive:true});
  fs.writeFileSync(full,content);
}
function materializePackage(root:string){
  const original=[...liquidGlassTemplate().files.filter(f=>f.name.startsWith('engine/')),...liquidGlassIntegratedFiles()];
  for(const f of original)write(root,PKG+'/'+f.name,f.content);
  return original.length;
}
const adoption=(families:string[]):Adoption=>({artifact:'liquid-glass',source:SOURCE,revision:LIQUI_UPSTREAM_COMMIT,mode:'complete',manifest:'docs/adocao-liquid-glass.json',families,pending:[],packagePath:PKG});
const manifest=(root:string,families:unknown[])=>write(root,'docs/adocao-liquid-glass.json',JSON.stringify({artifact:'liquid-glass',source:SOURCE,revision:LIQUI_UPSTREAM_COMMIT,families}));

describe('Inventário de adoção Liquid Glass — escopo fechado',()=>{
  let root:string;
  beforeEach(()=>{root=fs.mkdtempSync(path.join(os.tmpdir(),'nivoo-adocao-'));});
  afterEach(()=>{fs.rmSync(root,{recursive:true,force:true});});

  it('expõe um conjunto FECHADO de nomes oficiais',()=>{
    const names=officialAdoptionComponents();
    expect(names).toContain('engine/nivoo.tsx');
    expect(names).toContain('approved-design.tsx');
    expect(names).toContain('registry/ui/dialog.tsx');
    expect(names.every(n=>n==='engine/nivoo.tsx'||n==='approved-design.tsx'||/^registry\/ui\/.*\.tsx$/.test(n))).toBe(true);
  });

  it('a especificação canônica traz o schema e a lista de nomes válidos',()=>{
    const spec=adoptionInventorySpec(adoption(['shell','data']));
    expect(spec).toContain('docs/adocao-liquid-glass.json');
    expect(spec).toContain('engine/nivoo.tsx');
    expect(spec).toContain('registry/ui/button.tsx');
    expect(spec).toContain('"id": "shell"');
  });

  it('aprova um inventário correto que segue o formato',()=>{
    const originalFiles=materializePackage(root);
    write(root,'app/Shell.tsx','import { NivooGlassRoot } from "../design-system/liquid-glass/engine/nivoo";\nexport const App=()=>null;\n');
    manifest(root,[
      {id:'shell',callsites:['app/Shell.tsx'],components:['engine/nivoo.tsx']},
      {id:'data',callsites:[],notApplicable:'Sem grade de dados densos neste piloto inicial.'},
    ]);
    const r=verifyAdoptionInventory(root,adoption(['shell','data']));
    expect(r).toEqual({families:['shell','data'],callsites:1,originalFiles});
  });

  it('reprova componente inválido com erro ACIONÁVEL (lista o que vale)',()=>{
    materializePackage(root);
    write(root,'app/Shell.tsx','import { NivooGlassRoot } from "../design-system/liquid-glass/engine/nivoo";\n');
    manifest(root,[{id:'shell',callsites:['app/Shell.tsx'],components:['Shell.tsx']}]);
    expect(()=>verifyAdoptionInventory(root,adoption(['shell']))).toThrow(/engine\/nivoo\.tsx/);
    expect(()=>verifyAdoptionInventory(root,adoption(['shell']))).toThrow(/dialog/);
  });

  it('reprova componente oficial que nenhum callsite importa (anti-suposição)',()=>{
    materializePackage(root);
    write(root,'app/Shell.tsx','import { algo } from "./outro";\n');
    manifest(root,[{id:'shell',callsites:['app/Shell.tsx'],components:['engine/nivoo.tsx']}]);
    expect(()=>verifyAdoptionInventory(root,adoption(['shell']))).toThrow(/não é importado/);
  });
});
