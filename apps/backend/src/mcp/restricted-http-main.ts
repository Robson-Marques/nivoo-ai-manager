import { createInterface } from 'node:readline';
import { RestrictedHttpMcp,handleRestrictedMcp } from './restricted-http';
import { validateMcpToolNames } from './tool-policy';

async function main(){
  const names:unknown=JSON.parse(process.env.NIVOO_MCP_BRIDGE_HEADER_NAMES??'[]');
  if(!Array.isArray(names)||names.length>100||names.some(n=>typeof n!=='string'||!/^[A-Za-z][A-Za-z0-9-]{0,63}$/.test(n)))throw Error('Cabeçalhos MCP inválidos.');
  const headers=Object.fromEntries(names.map((name,i)=>[name,process.env['NIVOO_MCP_BRIDGE_HEADER_'+i]??'']));
  const client=new RestrictedHttpMcp(process.env.NIVOO_MCP_BRIDGE_URL??'',headers,validateMcpToolNames(JSON.parse(process.env.NIVOO_MCP_BRIDGE_TOOLS??'[]')),fetch,line=>process.stderr.write(line+'\n'));
  const input=createInterface({input:process.stdin,crlfDelay:Infinity});
  let closing=false;
  const close=async()=>{if(closing)return;closing=true;input.close();await client.close();};
  for(const signal of ['SIGTERM','SIGINT'] as const)process.once(signal,()=>{void close().finally(()=>process.exit(0));});
  try{
    for await(const line of input){
      if(closing)break;
      if(Buffer.byteLength(line)>2*1024*1024)throw Error('Pedido MCP acima do limite.');
      let msg:unknown;try{msg=JSON.parse(line);}catch{continue;}
      const result=await handleRestrictedMcp(client,msg);
      if(result)process.stdout.write(JSON.stringify(result)+'\n');
    }
  }finally{await close();}
}
void main().catch(()=>{process.stderr.write('Ponte MCP filtrada: erro de configuração ou transporte.\n');process.exitCode=1;});
