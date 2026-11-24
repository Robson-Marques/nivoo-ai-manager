import * as fs from 'node:fs';
import * as path from 'node:path';

/** Publish a complete file on the destination filesystem, never a partially
 * copied durable video. Existing durable files are immutable. Worktree
 * outputs keep their legacy overwrite behavior. */
export function publishMediaFile(source:string,destination:string,exclusive:boolean):void{
  fs.mkdirSync(path.dirname(destination),{recursive:true});
  const staging=fs.mkdtempSync(path.join(path.dirname(destination),'.nivoo-publish-'));
  const candidate=path.join(staging,'media');
  try{
    fs.copyFileSync(source,candidate);
    if(exclusive){
      try{fs.linkSync(candidate,destination);}
      catch(e){if((e as NodeJS.ErrnoException).code==='EEXIST')throw Error('MIDIA_DESTINO_EXISTENTE: '+path.basename(destination));throw e;}
    }else fs.renameSync(candidate,destination);
  }finally{fs.rmSync(staging,{recursive:true,force:true});}
}
