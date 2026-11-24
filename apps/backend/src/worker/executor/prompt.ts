import type { ContextStats } from '../context-builder';

/** Local executors receive their operational options and files, not an agent prompt.
 * Lazy factories keep memory/profile/MCP assembly out of the deterministic path.
 */
export async function prepareExecutionPrompt(isAi:boolean,loadProfile:()=>Promise<string>,loadContext:(profile:string)=>Promise<{text:string;stats:ContextStats}>,docs:()=>string[]){
  if(!isAi)return {profileText:'',context:'',stats:null};
  const profileText=await loadProfile();
  const {text:contextBase,stats}=await loadContext(profileText);
  const docsDoRepo=docs();
  const context = docsDoRepo.length
      ? `${contextBase}\n\n## Documentos de instrução do repositório\nNesta sessão ${docsDoRepo.join(', ')} ficam fora da pasta (cópia para ler em contexto/repositorio/, com "_" no nome). Se o trabalho pede para alterar um deles, escreva o arquivo no caminho original (ex.: ${docsDoRepo[0]}) com o conteúdo COMPLETO atualizado (parta da cópia): essa versão entra no trabalho.`
      : contextBase;

  return {profileText,context,stats:{...stats,totalChars:context.length,overBudget:context.length>stats.budgetChars,profileChars:profileText.length}};
}
