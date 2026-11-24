import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { sha256 } from '../../src/common/hash';
import { publishArtifactBlob } from '../../src/storage/artifact-publication';
describe('Publicação atômica de artefatos',()=>{
  let root:string;
  beforeEach(()=>root=fs.mkdtempSync(path.join(os.tmpdir(),'nivoo-artifact-test-')));
  afterEach(()=>fs.rmSync(root,{recursive:true,force:true}));
  it('publica bytes completos e reaproveita blob idêntico',async()=>{
    const bytes=Buffer.from('resultado'),hash=sha256(bytes),dest=path.join(root,hash);
    expect(await publishArtifactBlob(dest,hash,bytes)).toBe(bytes.length);
    expect(await publishArtifactBlob(dest,hash,bytes)).toBe(bytes.length);
    expect(fs.readFileSync(dest)).toEqual(bytes);
    expect(fs.readdirSync(root)).toEqual([hash]);
  });
  it('não publica hash errado nem sobrescreve blob corrompido',async()=>{
    const hash=sha256('correto'),dest=path.join(root,hash);
    await expect(publishArtifactBlob(dest,hash,Buffer.from('errado'))).rejects.toThrow();
    expect(fs.existsSync(dest)).toBe(false);
    fs.writeFileSync(dest,'anterior');
    await expect(publishArtifactBlob(dest,hash,Buffer.from('correto'))).rejects.toThrow();
    expect(fs.readFileSync(dest,'utf8')).toBe('anterior');
  });
  it('recusa origem simbólica',async()=>{
    const source=path.join(root,'source'),link=path.join(root,'link');
    fs.writeFileSync(source,'texto');fs.symlinkSync(source,link);
    await expect(publishArtifactBlob(path.join(root,'blob'),sha256('texto'),link)).rejects.toThrow();
  });
});
