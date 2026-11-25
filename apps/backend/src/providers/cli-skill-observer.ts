import * as path from 'node:path';

type Cli='claude'|'gemini';
type Log=(line:string)=>void;
/** Observe only correlated native Read/tool_result events. The CLI owns the
 * actual read; unlike HTTP tools, we do not know the returned byte range.
 * Do not log result contents, arguments other than authorized skill paths,
 * or infer success from a tool invocation alone. */
export function nativeSkillReadObserver(cli:Cli,cwd:string,log:Log):(line:string)=>void{
  const pending=new Map<string,string>(),reported=new Set<string>();
  const skillPath=(value:unknown):string|null=>{
    if(typeof value!=='string'||value.includes('\0'))return null;
    const rel=path.relative(path.resolve(cwd),path.resolve(cwd,value)).split(path.sep).join('/');
    return /^contexto\/(?:skills-nivoo\/[a-z0-9-]+\/SKILL\.md|egm\/original\/(?:[A-Za-z0-9_-][A-Za-z0-9._-]*\/)*[A-Za-z0-9_-][A-Za-z0-9._-]*)$/.test(rel)?rel:null;
  };
  function remember(id:unknown,file:unknown){
    if(typeof id!=='string'||!id||pending.size>=1000)return;
    const rel=skillPath(file);
    if(rel)pending.set(id,rel);
  }
  function finish(id:unknown,success:boolean){
    if(typeof id!=='string')return;
    const rel=pending.get(id);pending.delete(id);
    if(!rel||!success||reported.has(rel))return;
    reported.add(rel);
    log('Skill — CLI '+cli+' informou leitura bem-sucedida: '+rel+'; cobertura e aplicação não comprovadas.');
  }
  return line=>{
    let e:any;try{e=JSON.parse(line);}catch{return;}
    if(cli==='claude'){
      if(e?.type==='assistant'&&Array.isArray(e.message?.content))for(const c of e.message.content){
        if(c?.type==='tool_use'&&c.name==='Read')remember(c.id,c.input?.file_path);
      }
      if(e?.type==='user'&&Array.isArray(e.message?.content))for(const c of e.message.content){
        if(c?.type==='tool_result')finish(c.tool_use_id,c.is_error!==true&&c.content!==undefined);
      }
    }else{
      if(e?.type==='tool_use'&&e.tool_name==='read_file')remember(e.tool_id,e.parameters?.file_path);
      if(e?.type==='tool_result')finish(e.tool_id,e.status==='success');
    }
  };
}
