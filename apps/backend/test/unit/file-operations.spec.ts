import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { validateFileOperations,preflightOperations,operationsNeedApproval } from '../../src/common/file-operations';
describe('Contrato de operações de arquivos',()=>{
  let root:string;
  beforeEach(()=>root=fs.mkdtempSync(path.join(os.tmpdir(),'nivoo-ops-')));
  afterEach(()=>fs.rmSync(root,{recursive:true,force:true}));
  it('protege caminhos e recusa sobreposição',()=>{
    for(const x of ['src/.git/config','src/.env','a/../b','midia','out'])expect(()=>validateFileOperations({remover:[x]})).toThrow();
    expect(()=>validateFileOperations({remover:['src'],mover:[{de:'src/a',para:'b'}]})).toThrow();
    expect(()=>validateFileOperations({mover:[{de:'a',para:'b'},{de:'b',para:'c'}]})).toThrow();
  });
  it('distingue arquivos fora do Git',()=>{
    expect(operationsNeedApproval(validateFileOperations({remover:['midia/saida/a.mp4']}))).toBe(true);
    expect(operationsNeedApproval(validateFileOperations({remover:['src/a.ts']}))).toBe(false);
  });
  it('valida lote inteiro antes de modificar e não segue links',()=>{
    fs.writeFileSync(path.join(root,'a'),'a');
    fs.writeFileSync(path.join(root,'b'),'b');
    fs.symlinkSync(path.join(root,'a'),path.join(root,'alias'));
    expect(()=>preflightOperations(validateFileOperations({mover:[{de:'a',para:'b'}]}),root)).toThrow();
    expect(()=>preflightOperations(validateFileOperations({remover:['alias']}),root)).toThrow();
    expect(fs.readFileSync(path.join(root,'a'),'utf8')).toBe('a');
  });
});
