import { writeSessionContextFile } from '../common/session-context-file';

/** Full text is retained as bounded UTF-8-readable pages, not summarized
 * by another model. A page fits the hosted file tools' normal read limit. */
export function writeContextArchive(worktree:string,name:string,text:string):string{
  if(!/^[a-z-]+$/.test(name))throw Error('Nome de arquivo de contexto inválido');
  const files:string[]=[];
  let start=0;
  while(start<text.length){
    let end=Math.min(start+180000,text.length);
    if(end<text.length){
      const nl=text.lastIndexOf('\n',end);
      if(nl>start+90000)end=nl+1;
      // Avoid splitting a UTF-16 surrogate pair.
      else if(/[\uD800-\uDBFF]/.test(text[end-1]))end--;
    }
    const rel='acervo/'+name+'/'+String(files.length+1).padStart(4,'0')+'.md';
    writeSessionContextFile(worktree,rel,text.slice(start,end));
    files.push('contexto/'+rel);
    start=end;
  }
  const index='acervo/'+name+'/INDICE.md';
  writeSessionContextFile(worktree,index,['# '+name,'Páginas em ordem, conteúdo integral; leia apenas o que precisar.',...files.map(f=>'- '+f)].join('\n')+'\n');
  return 'contexto/'+index;
}
export function excerpt(text:string,limit:number):string{
  if(text.length<=limit)return text;
  const half=Math.floor(limit/2);
  return text.slice(0,half)+'\n… [trecho intermediário disponível no acervo integral] …\n'+text.slice(-half);
}
