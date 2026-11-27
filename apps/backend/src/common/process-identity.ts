import * as fs from 'node:fs';

export type ProcessIdentity={version:1;pid:number;bootId:string;startTicks:string};
export type ProcessStat={pid:number;group:number;session:number;startTicks:string};
export type OrphanState='absent'|'foreign'|'owned'|'uncertain';
export function parseProcessStat(raw:string):ProcessStat|null{
  const end=raw.lastIndexOf(')');
  const pid=Number(raw.slice(0,raw.indexOf(' ')));
  const fields=raw.slice(end+1).trim().split(/\s+/);
  if(end<0||!Number.isSafeInteger(pid)||pid<=1||fields.length<20||!/^\d+$/.test(fields[19]))return null;
  const group=Number(fields[2]),session=Number(fields[3]);
  if(!Number.isSafeInteger(group)||!Number.isSafeInteger(session))return null;
  return {pid,group,session,startTicks:fields[19]};
}
function bootId():string|null{
  try{return fs.readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim()||null;}catch{return null;}
}
function stat(pid:number):ProcessStat|null{
  try{return parseProcessStat(fs.readFileSync('/proc/'+pid+'/stat','utf8'));}catch{return null;}
}
export function processIdentity(pid:number):ProcessIdentity|null{
  const boot=bootId(),s=stat(pid);
  if(!boot||!s||s.pid!==pid||s.group!==pid||s.session!==pid)return null;
  return {version:1,pid,bootId:boot,startTicks:s.startTicks};
}
export function compareProcessIdentity(pid:number,stored:unknown,current:ProcessIdentity|null,groupExists:boolean,boot:string|null):OrphanState{
  const old=stored as Partial<ProcessIdentity>|null;
  if(old?.version===1&&old.pid===pid&&typeof old.bootId==='string'&&typeof old.startTicks==='string'){
    if(boot&&old.bootId!==boot)return 'foreign';
    if(current)return current.bootId===old.bootId&&current.startTicks===old.startTicks?'owned':'foreign';
  }
  return groupExists?'uncertain':'absent';
}
function groupExists(pid:number):boolean{
  try{process.kill(-pid,0);return true;}catch(e){return (e as NodeJS.ErrnoException).code!=='ESRCH';}
}
export function inspectOrphan(pid:number,identity:unknown):OrphanState{
  if(!Number.isSafeInteger(pid)||pid<=1||pid===process.pid)return 'uncertain';
  return compareProcessIdentity(pid,identity,processIdentity(pid),groupExists(pid),bootId());
}
/** A saved PID alone is never authority to signal a process. A group
 * without a provable leader is not assumed dead. Recheck before signalling. */
export async function stopOwnedOrphan(pid:number,identity:unknown):Promise<OrphanState>{
  const initial=inspectOrphan(pid,identity);
  if(initial!=='owned')return initial;
  if(inspectOrphan(pid,identity)!=='owned')return inspectOrphan(pid,identity);
  try{process.kill(-pid,'SIGKILL');}catch(e){if((e as NodeJS.ErrnoException).code!=='ESRCH')return 'uncertain';}
  // SIGKILL delivery is asynchronous; do not reuse the workspace until
  // the group is gone. A zombie group may remain visible briefly.
  for(let i=0;i<20;i++){
    if(!groupExists(pid))return 'absent';
    await new Promise<void>(resolve=>setTimeout(resolve,100));
  }
  return 'uncertain';
}
