import * as fs from 'node:fs';
import * as path from 'node:path';

/** Write trusted, generated context without following links into the
 * repository or other projects. This is not an agent file-write tool. */
export function writeSessionContextFile(worktree:string,relative:string,content:string):void{
  const parts=relative.split('/');
  if(!parts.length||parts.some(p=>!p||p==='.'||p==='..'||!/^[A-Za-z0-9._-]+$/.test(p)))
    throw new Error('Caminho de contexto inválido');
  let dir=fs.realpathSync(worktree);
  for(const name of ['contexto',...parts.slice(0,-1)]){
    dir=path.join(dir,name);
    try{fs.mkdirSync(dir);}catch(e){
      if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;
    }
    const stat=fs.lstatSync(dir);
    if(!stat.isDirectory()||stat.isSymbolicLink())throw new Error('Pasta de contexto inválida: '+name);
  }
  // Atomic replacement never follows an existing final-component symlink.
  const tmp=fs.mkdtempSync(path.join(dir,'.nivoo-write-'));
  try{
    const file=path.join(tmp,'content');
    fs.writeFileSync(file,content,{flag:'wx'});
    fs.renameSync(file,path.join(dir,parts[parts.length-1]));
  }finally{fs.rmSync(tmp,{recursive:true,force:true});}
}
