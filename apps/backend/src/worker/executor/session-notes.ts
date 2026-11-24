import * as fs from 'node:fs';
import * as path from 'node:path';
import { sha256 } from '../../common/hash';

const MAX_BYTES=8*1024*1024;
const TYPES=['DECISAO_PROPOSTA','EVIDENCIA','PENDENCIA','PROGRESSO'] as const;
type NoteType=typeof TYPES[number];
export interface AgentNote { tipo:NoteType;titulo:string;conteudo:string;arquivos:string[];hash:string }

/** Journal belongs to this worktree, not a symlink to another project. */
export function readAgentNotes(worktree:string):{text:string;warning?:string}{
  const dir=path.join(worktree,'.nivoo'),file=path.join(dir,'notas.jsonl');
  try{
    if(!fs.existsSync(dir))return {text:''};
    if(!fs.lstatSync(dir).isDirectory())return {text:'',warning:'Pasta de notas inválida; não importada.'};
    const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
    try{
      const stat=fs.fstatSync(fd);
      if(!stat.isFile()||stat.size>MAX_BYTES)return {text:'',warning:'Diário de notas inválido ou acima de 8 MiB; original preservado.'};
      const bytes=Buffer.alloc(stat.size);
      let read=0;
      while(read<bytes.length){const n=fs.readSync(fd,bytes,read,bytes.length-read,read);if(!n)break;read+=n;}
      return {text:bytes.subarray(0,read).toString('utf8')};
    }finally{fs.closeSync(fd);}
  }catch(e){
    return (e as NodeJS.ErrnoException).code==='ENOENT'?{text:''}:{text:'',warning:'Diário de notas não pôde ser lido com segurança; original preservado.'};
  }
}
export function parseAgentNotes(text:string):{notes:AgentNote[];invalid:number}{
  const notes:AgentNote[]=[];const seen=new Set<string>();let invalid=0;
  for(const raw of text.split('\n')){
    const line=raw.trim();if(!line)continue;
    try{
      if(line.length>100000)throw Error('long');
      const n=JSON.parse(line);
      if(!n||typeof n!=='object'||Array.isArray(n)||typeof n.tipo!=='string'||!TYPES.includes(n.tipo.toUpperCase())||typeof n.titulo!=='string'||typeof n.conteudo!=='string')throw Error('invalid');
      const titulo=n.titulo.trim().slice(0,200),conteudo=n.conteudo.trim().slice(0,20000);
      if(!titulo||!conteudo)throw Error('empty');
      const tipo=n.tipo.toUpperCase() as NoteType;
      const arquivos:string[]=Array.isArray(n.arquivos)?[...new Set<string>(n.arquivos.filter((a:unknown):a is string=>typeof a==='string').map((a:string)=>a.replace(/^out\//,'')).filter((a:string)=>!!a&&/^[\w./ -]{1,300}$/.test(a)&&!a.startsWith('/')&&!a.split('/').some(p=>p==='..'||p==='.'||!p)))].slice(0,100):[];
      // Preserve legacy line hashes for already imported notes. Canonical
      // dedup within this journal prevents reordered JSON fields multiplying progress.
      const hash=sha256(line),canonical=JSON.stringify([tipo,titulo,conteudo,[...arquivos].sort()]);
      if(seen.has(canonical))continue;seen.add(canonical);
      notes.push({tipo,titulo,conteudo,arquivos,hash});
    }catch{invalid++;}
  }
  return {notes,invalid};
}
