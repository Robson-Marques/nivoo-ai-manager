/** Bounded actual failure excerpts, including the location immediately
 * following an exception. Output is evidence, never a command. */
export function verificationDiagnostic(output:string):string {
  const lines=output.replace(/\x1b\[[0-9;]*[A-Za-z]/g,'').split(/\r?\n/).map(l=>l.trim());
  const excluded=(l:string)=>/\[VersionHelper\]|npm warn|deprecated/i.test(l);
  const specific=(l:string)=>/(?:AssertionError|TimeoutError|TypeError|ReferenceError|SyntaxError|Error \[ERR_[A-Z_]+\]|(?:^|\s)Assertion failed|error TS\d+|^not ok\s)/i.test(l);
  const generic=(l:string)=>/(?:^|\s)Error:|^FAIL\s|^npm (?:ERR!|error) code/i.test(l);
  const hits=lines.map((l,i)=>({l,i})).filter(({l})=>!excluded(l)&&(specific(l)||generic(l)));
  if(!hits.length)return '';
  const concrete=hits.filter(({l})=>specific(l));
  const chosen=(concrete.length?concrete:hits).slice(-5);
  const excerpts:string[]=[];
  for(const {l,i} of chosen){
    excerpts.push(l.slice(0,450));
    // Keep stack and assertion context, with strict bounds. Do not
    // sweep a trailing successful suite into the diagnosis.
    const context=lines.slice(i+1,i+7).filter(x=>/^(?:at\s|Expected:|Received:|actual:|expected:|File "|Caused by:)/i.test(x)&&!excluded(x));
    for(const x of context.slice(0,3))excerpts.push(x.slice(0,350));
  }
  return [...new Set(excerpts)].join('\n').slice(0,3000);
}
