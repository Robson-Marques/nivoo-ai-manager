import { readMotionInvocation,rewriteMotionSource } from './command';

export function renderSource(command:string):string|null{
  const val=readMotionInvocation(command)?.source??'';
  const source=val.replace(/\/(?:index\.html|scene\.json)$/,'');
  return /^motion\/[A-Za-z0-9._/-]+$/.test(source)&&!source.split('/').includes('..')?source:null;
}
export function selectSource(command:string,source:string,filename='index.html'):string{
  return rewriteMotionSource(command,source+'/'+filename);
}
export function selectRenderMode(command:string,source:string,mode:'scene'|'hybrid'|'html'):string{
  return rewriteMotionSource(command,source+'/'+(mode==='scene'?'scene.json':'index.html'),mode);
}
export function selectStandaloneHtml(command:string,source:string):string{
  return selectRenderMode(command,source,'html');
}
