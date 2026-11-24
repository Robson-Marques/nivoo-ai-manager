/** Conversation in chronological order, retaining the original request and
 * the latest revisions even when the history exceeds the storage budget. */
export function conversaComoTexto(msgs:Array<{role:string;content:string;kind:string|null;createdAt:Date;attachments?:unknown}>):string{
  const head=['# Conversa que gerou este trabalho',''];
  const blocks=msgs.map(m=>{
    const quem=m.role==='USUARIO'?'Usuário':m.kind==='sistema'?'Sistema':'IA';
    const limite=m.role==='USUARIO'?40_000:6_000;
    const c=m.content.length>limite?m.content.slice(0,limite/2)+'\n… (mensagem cortada) …\n'+m.content.slice(-limite/2):m.content;
    const anexos=Array.isArray(m.attachments)&&m.attachments.length?'\n(anexos: '+m.attachments.map((a:any)=>a?.nome).filter(Boolean).join(', ')+' — em contexto/anexos/)':'';
    return '## '+quem+' — '+m.createdAt.toISOString()+'\n\n'+c+anexos+'\n';
  });
  const budget=600_000;
  if(blocks.reduce((n,b)=>n+b.length+1,0)<=budget)return [...head,...blocks].join('\n');
  const early:string[]=[],late:string[]=[];
  let left=0,right=blocks.length-1,used=0;
  while(left<=right&&used+blocks[left].length+1<=budget/2){
    used+=blocks[left].length+1;early.push(blocks[left++]);
  }
  while(right>=left&&used+blocks[right].length+1<=budget){
    used+=blocks[right].length+1;late.unshift(blocks[right--]);
  }
  // If there is a very long assistant tail, preserve the latest user turn too.
  let lastUser=msgs.length-1;
  while(lastUser>=0&&msgs[lastUser].role!=='USUARIO')lastUser--;
  if(lastUser>=left&&lastUser<=right){
    const latest=blocks[lastUser];
    return [...head,...early,'… (histórico intermediário omitido por tamanho; última solicitação do usuário preservada) …',latest,'… (outros trechos omitidos) …',...late].join('\n');
  }
  return [...head,...early,'… (histórico intermediário omitido por tamanho) …',...late].join('\n');
}
