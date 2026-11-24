import * as fs from 'node:fs';
import * as path from 'node:path';
import { sha256File } from '../common/hash';

/** Publish a complete, content-addressed blob without replacing an existing
 * immutable blob. Database records must be created only after this returns. */
export async function publishArtifactBlob(destination:string,hash:string,source:Buffer|string):Promise<number>{
  async function verify(file:string):Promise<number>{
    const stat=fs.lstatSync(file);
    if(!stat.isFile()||await sha256File(file)!==hash)throw Error('Artefato não corresponde ao hash esperado; conteúdo preservado: '+path.basename(destination));
    return stat.size;
  }
  try{return await verify(destination);}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
  fs.mkdirSync(path.dirname(destination),{recursive:true});
  const dir=fs.mkdtempSync(path.join(path.dirname(destination),'.nivoo-artifact-'));
  const temp=path.join(dir,'blob');
  try{
    if(Buffer.isBuffer(source))fs.writeFileSync(temp,source,{flag:'wx'});
    else{
      if(!fs.lstatSync(source).isFile())throw Error('Origem de artefato não é arquivo regular.');
      fs.copyFileSync(source,temp,fs.constants.COPYFILE_EXCL);
    }
    const size=await verify(temp);
    const fd=fs.openSync(temp,'r');
    try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
    try{fs.linkSync(temp,destination);}
    catch(e){
      if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;
      return await verify(destination);
    }
    return size;
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
}
