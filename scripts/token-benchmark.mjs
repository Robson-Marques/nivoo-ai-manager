// Usage: journalctl -u nivoo-worker --since '...' --no-pager -o cat > /tmp/nivoo-bench.log
// node scripts/token-benchmark.mjs /tmp/nivoo-bench.log REFERENCE_UUID OPTIMIZED_UUID
import fs from 'node:fs';
const [file,reference,optimized]=process.argv.slice(2);
if(!file||!reference||!optimized||reference===optimized){console.error('Uso: node scripts/token-benchmark.mjs LOG UUID_REFERENCIA UUID_OTIMIZADO');process.exit(2);}
const groups=new Map([[reference,new Map()],[optimized,new Map()]]);
let malformed=0;
for(const line of fs.readFileSync(file,'utf8').split('\n')){
  const marker='[NIVOO_TOKEN_BENCH] ';
  const i=line.indexOf(marker);
  if(i<0)continue;
  try{
    const r=JSON.parse(line.slice(i+marker.length));
    const g=groups.get(r.projectId);
    if(!g)continue;
    if(!r.callId||!['start','finish'].includes(r.event)){malformed++;continue;}
    const entry=g.get(r.callId)??{};
    if(entry[r.event]){malformed++;continue;}
    entry[r.event]=r;g.set(r.callId,entry);
  }catch{malformed++;}
}
const count=v=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
function summarize(g,variant){
  const rows=[...g.values()],finished=rows.filter(r=>r.finish).map(r=>r.finish);
  const incomplete=rows.filter(r=>!r.start||!r.finish||r.start.variant!==variant||r.finish.variant!==variant||r.start.provider!==r.finish.provider||r.start.model!==r.finish.model||r.finish.complete!==true||!count(r.finish.inputTotal)||!count(r.finish.outputTokens)).length;
  const comparable=rows.length>0&&incomplete===0;
  const sum=key=>finished.reduce((n,r)=>n+r[key],0);
  const allCost=finished.length===rows.length&&rows.length>0&&finished.every(r=>typeof r.costUsd==='number'&&Number.isFinite(r.costUsd)&&r.costUsd>=0&&!r.costEstimated);
  return {calls:rows.length,finished:finished.length,incomplete,providers:[...new Set(finished.map(r=>r.provider))],models:[...new Set(finished.map(r=>r.model))],skillsVersions:[...new Set(finished.map(r=>r.skillsVersion))],
    leanCalls:finished.filter(r=>r.skillIds?.includes('execucao-enxuta')).length,
    byPhase:Object.fromEntries(['planner','repair','execution','goldfish'].map(p=>[p,finished.filter(r=>r.phase===p).length])),
    failed:finished.filter(r=>r.exitCode!==0||r.interrupted||r.resourceUnavailable).length,
    inputTokens:comparable?sum('inputTotal'):null,outputTokens:comparable?sum('outputTokens'):null,
    totalTokens:comparable?sum('inputTotal')+sum('outputTokens'):null,
    providerReportedCostUsd:allCost?sum('costUsd'):null,
    providerCallDurationMs:finished.reduce((n,r)=>n+(r.durationMs??0),0)};
}
const a=summarize(groups.get(reference),'reference'),b=summarize(groups.get(optimized),'optimized');
const same=(x,y)=>x.length===1&&y.length===1&&x[0]!=null&&x[0]===y[0];
const valid=!malformed&&a.totalTokens>0&&b.totalTokens!==null&&same(a.providers,b.providers)&&same(a.models,b.models)&&same(a.skillsVersions,b.skillsVersions)&&a.leanCalls===0&&b.leanCalls>0;
console.log(JSON.stringify({reference:a,optimized:b,malformed,tokenReductionPct:valid?100*(a.totalTokens-b.totalTokens)/a.totalTokens:null,
  warning:'Comparação preliminar: confirme mesma versão real do modelo, briefing, ambiente, cache, ferramentas, período completo e qualidade funcional/visual equivalente. Custo reportado não é necessariamente cobrança da assinatura. Duração é soma das chamadas, não tempo total do trabalho. null = indisponível ou comparação inválida.'},null,2));
