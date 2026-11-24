import * as fs from 'node:fs';
import * as path from 'node:path';
import { caminhoDoProjeto } from './path-guard';

export type FileOperations={remover:string[];mover:Array<{de:string;para:string}>};
const protectedPart=/^(?:\.git|\.nivoo|contexto|node_modules|\.env(?:\..*)?|\.claude|\.codex|\.gemini|segredos\.json|conexoes\.json)$/i;
export function operationPath(value:unknown):string{
  if(typeof value!=='string'||value.replace(/\\/g,'/').split('/').includes('..'))throw Error('Caminho inválido.');
  const rel=caminhoDoProjeto(value);
  if(!rel||rel.split('/').some(p=>protectedPart.test(p))||/^(?:midia|out)$/i.test(rel))throw Error('Caminho protegido ou inválido: '+String(value));
  return rel;
}
export function outsideGit(rel:string):boolean{return /^(?:midia|out)\//i.test(rel);}
export function validateFileOperations(input:unknown):FileOperations{
  if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Informe as operações de arquivos.');
  const o=input as Partial<FileOperations>;
  if(o.remover!==undefined&&!Array.isArray(o.remover)||o.mover!==undefined&&!Array.isArray(o.mover))throw Error('remover e mover devem ser listas.');
  const remover=(o.remover??[]).map(operationPath);
  const mover=(o.mover??[]).map(m=>({de:operationPath(m?.de),para:operationPath(m?.para)}));
  if(!remover.length&&!mover.length)throw Error('Informe remover e/ou mover.');
  if(remover.length+mover.length>2000)throw Error('No máximo 2000 operações.');
  // A batch has independent operations; chains and overlapping paths need
  // separate, explicitly ordered steps.
  const used=[...remover,...mover.flatMap(m=>[m.de,m.para])];
  const sorted=[...used].sort();
  if(new Set(used).size!==used.length||sorted.some((p,i)=>sorted.slice(i+1).some(q=>q.startsWith(p+'/'))))throw Error('Operações sobre caminhos iguais ou sobrepostos; separe em etapas com dependências.');
  return {remover,mover};
}
export function operationsNeedApproval(o:FileOperations):boolean{
  return [...o.remover,...o.mover.flatMap(m=>[m.de,m.para])].some(outsideGit);
}
function exists(abs:string):boolean{
  try{fs.lstatSync(abs);return true;}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return false;throw e;}
}
export function resolveOperation(root:string,mediaDir:string|undefined,rel:string):string{
  rel=operationPath(rel);
  const media=/^midia\//i.test(rel);
  if(media&&!mediaDir)throw Error('Pasta de mídia não disponível.');
  let at=fs.realpathSync(media?mediaDir!:root);
  const parts=(media?rel.slice(6):rel).split('/');
  for(let i=0;i<parts.length;i++){
    at=path.join(at,parts[i]);
    if(!exists(at))continue;
    const st=fs.lstatSync(at);
    if(st.isSymbolicLink()||(i<parts.length-1&&!st.isDirectory())||(!st.isDirectory()&&!st.isFile()))throw Error('Caminho não regular ou link: '+rel);
  }
  return at;
}
export function preflightOperations(o:FileOperations,root:string,mediaDir?:string){
  const moves=o.mover.map(m=>{
    const de=resolveOperation(root,mediaDir,m.de),para=resolveOperation(root,mediaDir,m.para);
    if(!exists(de))throw Error('Origem de movimentação inexistente: '+m.de);
    if(exists(para))throw Error('Destino já existe: '+m.para);
    const parent=path.dirname(para);
    let existing=parent;
    while(!exists(existing))existing=path.dirname(existing);
    if(fs.statSync(de).dev!==fs.statSync(existing).dev)throw Error('Movimentação entre discos exige cópia e confirmação separadas: '+m.de);
    return {...m,source:de,dest:para};
  });
  const removals=o.remover.map(rel=>({rel,abs:resolveOperation(root,mediaDir,rel)}));
  return {moves,removals};
}
