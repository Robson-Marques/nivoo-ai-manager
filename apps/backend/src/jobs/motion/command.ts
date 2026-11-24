/**
 * Compatibility adapter for persisted Motion CLI steps.
 * Only a literal invocation at a shell command boundary is recognized.
 * The descriptor is the shared contract for routing, output and verification.
 * Arbitrary shell and dynamic expressions remain the shell connector's job.
 */
export interface MotionInvocation {
  source: string;
  output: string | null;
  seconds?: number;
  width?: number;
  height?: number;
}
function motionCommandWords(script:string): string[][] {
  // Split only on unquoted command boundaries, without interpreting shell
  // substitutions, expansions, escapes or running the input.
  const commands: string[][] = [];
  let tokens: string[] = [], token='', quote='', escaped=false, comment=false;
  const flush=()=>{if(token){tokens.push(token);token='';}};
  const end=()=>{flush();if(tokens.length)commands.push(tokens);tokens=[];};
  for(const c of script) {
    if(comment){if(c==='\n'){comment=false;end();}continue;}
    if(escaped){if(c!=='\n')token+=c;escaped=false;continue;}
    if(c==='\\'&&quote!=="'"){escaped=true;continue;}
    if(quote){if(c===quote)quote='';else token+=c;continue;}
    if(c==="'"||c==='"'){quote=c;continue;}
    if(c==='#'&&!token){comment=true;continue;}
    if(/[;&|\n]/.test(c)){end();continue;}
    if(/\s/.test(c)){flush();continue;}
    token+=c;
  }
  if(quote||escaped)return [];
  end();
  return commands.filter(parts=>{
    const executable=parts[0]==='env'?parts[1]:parts[0];
    return executable==='nivoo-renderizar-motion'||executable==='/usr/local/bin/nivoo-renderizar-motion';
  });
}

export function hasMotionCommand(script:string):boolean {
  return motionCommandWords(script).length>0;
}
export function readMotionInvocations(script:string):MotionInvocation[] {
  return motionCommandWords(script).flatMap(words=>{
    const invocation=describe(words);
    return invocation?[invocation]:[];
  });
}
export function readMotionInvocation(script: string): MotionInvocation | null {
  const invocations=motionCommandWords(script);
  return invocations.length===1?describe(invocations[0]):null;
}
function describe(words:string[]):MotionInvocation|null {
  const source=words[words[0]==='env'?2:1];
  if(!source||!/^motion\/[A-Za-z0-9._/-]+$/.test(source)||source.split('/').includes('..'))return null;
  const flag=(key:string):string|undefined=>{
    const i=words.indexOf(key);
    return i<0?undefined:words[i+1];
  };
  const target=flag('--saida')??'';
  const output=/^midia\/saida\/[A-Za-z0-9._-]+\.mp4$/.test(target)?target:null;
  const time=flag('--segundos');
  const seconds=time&&/^\d+(?:\.\d+)?$/.test(time)?Number(time):undefined;
  const size=/^(\d{2,5})x(\d{2,5})$/.exec(flag('--tamanho')??'');
  return {source,output,seconds,width:size?Number(size[1]):undefined,height:size?Number(size[2]):undefined};
}
