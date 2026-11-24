import * as fs from 'node:fs';
import * as path from 'node:path';

/** Bundled, reviewed guidance. No npm installer, remote API, arbitrary scripts,
 * hooks, provider credentials or change of permissions. Native CLI discovery is
 * deliberately not relied on: every supported connector can read contexto/. */
export const SKILLS_VERSION='1.0.0';
const upstream='https://github.com/NVIDIA/skills/tree/71e61c7209cb4ca64cba247a7d20a5438b30aef5/skills/';
type Skill={id:string;description:string;action:string;body:string;source?:string};
export const NIVOO_SKILLS:readonly Skill[]=[
  {id:'retomada',description:'Continuidade de trabalho e checkpoints',source:upstream+'nemo-rl-session-memory',
    action:'Leia o estado desta etapa e o último erro; preserve as saídas e etapas concluídas. Retome do ponto verificável, não do começo.',
    body:'O banco, o worktree, os checkpoints e os artefatos são a fonte de verdade. Confira a existência e a origem dos arquivos antes de reutilizá-los. Não crie outro sistema de memória nem escreva notas duplicadas. Em trabalho longo salve progresso no arquivo de resultado e use .nivoo/notas.jsonl somente para informação nova útil à retomada. Na próxima sessão leia a última conferência se houver falha. Não repita o comando ou abordagem que já falhou sem corrigir sua causa.'},
  {id:'execucao-enxuta',description:'Etapas pequenas, contexto sob demanda e execução determinística',source:upstream+'tao-token-efficient-execution',
    action:'Resolva apenas a etapa atual, com entradas, saídas e dependências reais. Use o executor existente para operações determinísticas; não crie revisões ou sessões redundantes.',
    body:'O Nivoo já é o orquestrador. Não instale o driver TAO nem outro agente. Leia o contrato e os consumidores necessários; não releia todos os logs ou todo o repositório sem motivo. Reutilize parâmetros comprovados, produza a saída prevista e deixe a conferência técnica existente ao backend. Se algo estiver faltando, identifique a causa específica, sem replanejar todas as etapas. O objetivo, as regras do projeto e os critérios existentes continuam obrigatórios.'},
  {id:'diagnostico',description:'Diagnóstico de falhas de ferramenta, integração e execução',source:upstream+'nemo-relay-debug-runtime-integration',
    action:'Identifique a camada que falhou (contrato, conexão, ferramenta, arquivo, executor ou resultado). Corrija a origem comprovada, não os sintomas.',
    body:'Leia o componente responsável e seus consumidores; um status de conexão não prova que uma operação foi realizada. Diferencie erro de infraestrutura, autorização, parâmetro, código e saída. Preserve o erro real e os arquivos existentes. Não troque de provedor para esconder um defeito nem solicite uma nova revisão por IA. A execução, testes e build continuam nos executores autorizados. Esta orientação não instala NeMo Relay.'},
  {id:'direcao-artistica',description:'Criação visual editorial, referência e ativos de imagem',
    action:'Crie uma composição visual coerente com o briefing, usando ImageGen se disponível e ativos originais. Não substitua fotografia por primitivas.',
    body:'Se existir uma arte final fornecida, respeite enquadramento, escala, hierarquia, cor, identidade e iluminação. Uma referência de estilo orienta uma criação nova; não obriga copiar o layout. Se a tarefa exigir um ativo isolado, preserve o canal alfa e o objeto completo. Se for uma arte estática, entregue a imagem sem inventar um vídeo. Para uma animação, só separe os elementos cujo movimento seja necessário. Use as margens do formato contratado sem recortar o produto nem redesenhar o logo. Não acione APIs externas sem autorização.'},
  {id:'motion',description:'Animação de camadas, direção de movimento e composição 3D',
    action:'Use a fonte editável e o contrato do motor Nivoo; preserve recortes, camadas e texto. Crie movimentos intencionais e deixe renderização ao executor.',
    body:'Separe composição visual de movimento. Anime elementos independentes (brilho, neon, ponteiros, produto, máscara, câmera) em vez de mover o pôster inteiro. Planeje abertura, revelação e tempo legível de fechamento. Use HTML/SVG/CSS para grafismos e profundidade 2.5D; use geometria WebGL quando o objeto exigir 3D real, não para simular fotografia. Respeite resolução, duração, FPS e margens contratados. Não duplique imagens nem deixe suportes opacos cortar recortes transparentes. Se só foi solicitada uma reexportação, não redesenhe a cena.'},
  {id:'locucao',description:'Roteiro falado, pronúncia e sincronização',
    action:'Escreva para fala natural em português, respeite o motor escolhido e preserve a arte quando só o áudio mudar.',
    body:'Use frases conversacionais e pontuação adequada à entonação. Números, siglas, marcas e horas devem soar como o usuário deseja. Evite marcações que o motor de fala não suporta e não prometa controles de emoção ou velocidade inexistentes. Preserve redação literal quando exigida. Utilize o executor gerar-narracao ou juntar-videos conforme a entrega; mantenha a narração independente da trilha. Não habilite nenhuma nova API NVIDIA.'},
  {id:'codigo',description:'Correção de código com leitura de contratos e consumidores',
    action:'Leia o componente dono da responsabilidade e os consumidores afetados; faça a alteração mínima coerente e preserve interfaces e dados.',
    body:'Use busca para localizar, depois leia os trechos completos e contratos de chamada. Diferencie falhas de tipagem, build, execução e comportamento. Não invente caminhos, opções de CLI ou APIs. Não altere requisitos para passar testes. Testes e build são responsabilidade do backend nos comandos existentes; não adicione CI nem revisões extras sem pedido.'},
];
export interface SkillIntent {
  phase:'planner'|'execution'; text:string; media:boolean; software:boolean;
  nativeImage?:boolean; motionAuthor?:boolean; resume?:boolean; previousError?:boolean; executor?:boolean;
}
/** Route by the current request or step, not the accumulated conversation,
 * project title, or a remote description that could instruct the system. */
export function selectSkills(intent:SkillIntent):Skill[]{
  if(intent.executor)return [];
  const t=intent.text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const selected=new Set<string>();
  const resume=intent.resume||/\b(retom\w*|continu\w*|checkpoint|reaproveit\w*|preserv\w*)\b/.test(t);
  if(resume)selected.add('retomada');
  if(intent.previousError||/\b(erro|falh\w*|bloque\w*|bug|diagnostic\w*|timeout|repetic\w*)\b/.test(t))selected.add('diagnostico');
  if(intent.phase==='execution')selected.add('execucao-enxuta');
  else if(/\b(workflow|fluxo|tokens?|orquestr\w*|automac\w*)\b/.test(t))selected.add('execucao-enxuta');
  if(intent.media){
    if(intent.nativeImage||/\b(arte|artes|imagem|imagens|poster|posters|criativo|foto|fotografia|recorte|banner|layout)\b/.test(t))selected.add('direcao-artistica');
    if(intent.motionAuthor||/\b(motion|animac\w*|animar|video|videos|3d|neon|render\w*|reels)\b/.test(t))selected.add('motion');
    if(/\b(narrac\w*|narrador\w*|locuc\w*|voz|vozes|tts|pronuncia|audio|trilha)\b/.test(t))selected.add('locucao');
  }
  if(intent.software&&/\b(codigo|program\w*|backend|frontend|typescript|compil\w*|api|script|repositorio|bug|build|testes?)\b/.test(t))selected.add('codigo');
  // No full skill bank in the prompt. The relevant detailed guidance is
  // materialized in the already disposable, read-only session context.
  return NIVOO_SKILLS.filter(s=>selected.has(s.id));
}

export function skillContext(skills:readonly Skill[],worktree?:string):string[]{
  if(!skills.length)return [];
  if(worktree){
    const root=path.join(worktree,'contexto','skills-nivoo');
    fs.mkdirSync(root,{recursive:true});
    for(const s of skills){
      const dir=path.join(root,s.id);
      fs.mkdirSync(dir,{recursive:true});
      fs.writeFileSync(path.join(dir,'SKILL.md'),['---','name: '+s.id,'description: '+JSON.stringify(s.description),'---','','# '+s.description,'',s.body,'',...(s.source?['Inspirada em NVIDIA Agent Skills (Apache-2.0), '+s.source+'. Adaptação Nivoo; sem scripts upstream.']:[])].join('\n')+'\n');
    }
  }
  return ['## Skills Nivoo v'+SKILLS_VERSION+' selecionadas para esta sessão',
    'Orientações auxiliares, subordinadas ao perfil, às regras de segurança e ao contrato dos executores. Não instale ferramentas, não altere permissões e não crie etapas extras por causa de uma skill.',
    ...skills.map(s=>'- '+s.id+': '+s.action+(worktree?' Leia contexto/skills-nivoo/'+s.id+'/SKILL.md se precisar dos detalhes.':''))];
}
