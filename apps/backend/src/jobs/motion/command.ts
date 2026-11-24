/** Literal CLI adapter: parses and rewrites only actual Motion invocations.
 * No shell execution, interpolation, or rewriting unrelated commands.
 */
export interface MotionInvocation {
  source: string;
  output: string | null;
  seconds?: number;
  width?: number;
  height?: number;
}
type Word={value:string;start:number;end:number};
type Edit={start:number;end:number;text:string};
function motionCommandWords(script:string):Word[][] {
  const commands:Word[][]=[];
  let words:Word[]=[],value='',start=-1,quote='',escaped=false,comment=false;
  const flush=(end:number)=>{if(start>=0){words.push({value,start,end});value='';start=-1;}};
  const finish=(end:number)=>{flush(end);if(words.length)commands.push(words);words=[];};
  for(let i=0;i<script.length;i++){
    const c=script[i];
    if(comment){if(c==='\n'){comment=false;finish(i);}continue;}
    if(escaped){if(c!=='\n')value+=c;else if(start===i-1)start=-1;escaped=false;continue;}
    if(c==='\\'&&quote!=="'"){if(start<0)start=i;escaped=true;continue;}
    if(quote){if(c===quote)quote='';else value+=c;continue;}
    if(c==="'"||c==='"'){if(start<0)start=i;quote=c;continue;}
    if(c==='#'&&start<0){comment=true;continue;}
    if(/[;&|\n]/.test(c)){finish(i);continue;}
    if(/\s/.test(c)){flush(i);continue;}
    if(start<0)start=i;
    value+=c;
  }
  if(quote||escaped)return [];
  finish(script.length);
  return commands.filter(w=>{
    const name=w[w[0]?.value==='env'?1:0]?.value;
    return name==='nivoo-renderizar-motion'||name==='/usr/local/bin/nivoo-renderizar-motion';
  });
}
const sourceWord=(w:Word[])=>w[w[0].value==='env'?2:1];
function flagWord(w:Word[],name:string):Word|undefined {
  const i=w.findIndex(x=>x.value===name);
  return i<0?undefined:w[i+1];
}
const validSource=(s:string)=>/^motion\/[A-Za-z0-9._/-]+$/.test(s)&&!s.split('/').includes('..');
const validOutput=(s:string)=>/^midia\/saida\/[A-Za-z0-9._-]+\.mp4$/i.test(s);
function applyEdits(script:string,edits:Edit[]):string {
  for(const e of edits.sort((a,b)=>b.start-a.start||b.end-a.end))script=script.slice(0,e.start)+e.text+script.slice(e.end);
  return script;
}
function replacement(script:string,w:Word,value:string):Edit {
  const original=script.slice(w.start,w.end),quote=original[0];
  return {start:w.start,end:w.end,text:(quote==="'"||quote==='"')&&original.endsWith(quote)?quote+value+quote:value};
}
export function hasMotionCommand(script:string):boolean{return motionCommandWords(script).length>0;}
export function readMotionInvocations(script:string):MotionInvocation[]{
  return motionCommandWords(script).flatMap(w=>{const op=describe(w);return op?[op]:[];});
}
export function readMotionInvocation(script:string):MotionInvocation|null{
  const commands=motionCommandWords(script);
  return commands.length===1?describe(commands[0]):null;
}
/** Explicit renderer choice, when the author has already selected a mode. */
export function readMotionMode(script:string):'scene'|'hybrid'|'html'|undefined{
  const commands=motionCommandWords(script);
  if(commands.length!==1)return undefined;
  const mode=flagWord(commands[0],'--motor')?.value;
  return mode==='scene'||mode==='hybrid'||mode==='html'?mode:undefined;
}
function describe(w:Word[]):MotionInvocation|null{
  const source=sourceWord(w)?.value;
  if(!source||!validSource(source))return null;
  const target=flagWord(w,'--saida')?.value??'';
  const time=flagWord(w,'--segundos')?.value;
  const size=/^(\d{2,5})x(\d{2,5})$/.exec(flagWord(w,'--tamanho')?.value??'');
  return {source,output:validOutput(target)?target:null,seconds:time&&/^\d+(?:\.\d+)?$/.test(time)?Number(time):undefined,width:size?Number(size[1]):undefined,height:size?Number(size[2]):undefined};
}
/** Change the single recognized invocation, not a quoted example or another command's flags. */
export function rewriteMotionSource(script:string,source:string,mode?:'scene'|'hybrid'|'html'):string{
  const commands=motionCommandWords(script);
  if(commands.length!==1||!validSource(source))return script;
  const w=commands[0],entry=sourceWord(w);
  if(!entry||!validSource(entry.value))return script;
  const edits=[replacement(script,entry,source)];
  if(mode){
    const flag=flagWord(w,'--motor');
    if(flag)edits.push(replacement(script,flag,mode));
    else if(!w.some(x=>x.value==='--motor'))edits.push({start:entry.end,end:entry.end,text:' --motor '+mode});
    else return script;
  }
  return applyEdits(script,edits);
}
/** Resolve old durable-output aliases before routing/dependency compilation.
 * Only explicit --saida arguments are changed. Callers can propagate exact
 * path aliases to the corresponding verification and assembly inputs.
 */
export function normalizeMotionOutputs(script:string):{command:string;aliases:Record<string,string>;invalid:boolean}{
  const edits:Edit[]=[],aliases:Record<string,string>={};
  let invalid=false;
  for(const w of motionCommandWords(script)){
    const output=flagWord(w,'--saida');
    if(!output){invalid=true;continue;}
    if(/^out\/[A-Za-z0-9._-]+\.mp4$/i.test(output.value)){
      const target='midia/saida/'+output.value.slice(4);
      aliases[output.value]=target;
      edits.push(replacement(script,output,target));
    }else if(!validOutput(output.value))invalid=true;
  }
  return {command:applyEdits(script,edits),aliases,invalid};
}
