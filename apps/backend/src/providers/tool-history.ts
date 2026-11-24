/** Eliminate only exact repeated READ responses. Keep the latest full copy,
 * every tool-call ID, writes, errors and the complete request. No LLM summary.
 * The API receives a complete sequence of tool calls and replies. */
export function compactRepeatedReads<T extends {role?:unknown;content?:unknown;tool_calls?:unknown;tool_call_id?:unknown}>(messages:T[]):{messages:T[];savedChars:number}{
  const reads=new Map<string,string>();
  for(const m of messages){
    if(m.role!=='assistant'||!Array.isArray(m.tool_calls))continue;
    for(const call of m.tool_calls){
      if(typeof call?.id!=='string')continue;
      if(call.function?.name==='ler_arquivo'||call.function?.name==='listar_arquivos'){
        reads.set(call.id,JSON.stringify([call.function.name,call.function.arguments]));
      }
    }
  }
  const latest=new Map<string,string>();let savedChars=0;
  const result=messages.slice();
  for(let i=messages.length-1;i>=0;i--){
    const m=messages[i];
    if(m.role!=='tool'||typeof m.tool_call_id!=='string'||typeof m.content!=='string'||m.content.length<500)continue;
    const request=reads.get(m.tool_call_id);if(!request)continue;
    try{
      const payload=JSON.parse(m.content);
      if(payload.erro||(!Array.isArray(payload.arquivos)&&typeof payload.conteudo!=='string'))continue;
    }catch{continue;}
    const key=request+'\n'+m.content,prev=latest.get(key);
    if(!prev){latest.set(key,m.tool_call_id);continue;}
    const replacement=JSON.stringify({aviso:'Leitura idêntica repetida; conteúdo integral na resposta de ferramenta mais recente desta mesma sessão.',tool_call_id:prev});
    if(replacement.length>=m.content.length)continue;
    result[i]={...m,content:replacement};
    savedChars+=m.content.length-replacement.length;
  }
  return {messages:result,savedChars};
}
