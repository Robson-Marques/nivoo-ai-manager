import { writeSessionContextFile } from '../common/session-context-file';
import { SOFTWARE_SKILLS,selectSoftwareSkillIds } from './software/catalog';

/** Bundled, reviewed guidance. No npm installer, remote API, arbitrary scripts,
 * hooks, provider credentials or change of permissions. Native CLI discovery is
 * deliberately not relied on: every supported connector can read contexto/. */
export const SKILLS_VERSION='1.4.2';
const upstream='https://github.com/NVIDIA/skills/tree/71e61c7209cb4ca64cba247a7d20a5438b30aef5/skills/';
export type Skill={id:string;description:string;action:string;body:string;source?:string;sourceAttribution?:string;domain?:'software'};
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
    body:'Se existir uma arte final fornecida, respeite enquadramento, escala, hierarquia, cor, identidade e iluminação. Uma referência de estilo orienta uma criação nova; não obriga copiar o layout. Se a tarefa exigir um ativo isolado, preserve o canal alfa e o objeto completo. Defina enquadramento, contraste, hierarquia, direção da luz, escala e material conforme o objetivo. Em campanha nova, use um key visual como referência quando necessário, não como pôster inteiro que se move. Se for uma arte estática, entregue a imagem sem inventar um vídeo. Para uma animação, só separe os elementos cujo movimento seja necessário. Use as margens do formato contratado sem recortar o produto nem redesenhar o logo. Não acione APIs externas sem autorização.'},
  {id:'motion',description:'Animação de camadas, direção de movimento e composição 3D',
    action:'Use a fonte editável e o contrato do motor Nivoo; preserve recortes, camadas e texto. Crie movimentos intencionais e deixe renderização ao executor.',
    body:'Separe composição visual de movimento. Anime elementos independentes (brilho, neon, ponteiros, produto, máscara, câmera) em vez de mover o pôster inteiro. Planeje a linha do tempo antes de programar: posição inicial e final, início/duração de cada movimento, sobreposição, curva de aceleração e tempo de leitura. Use sinais de movimento naturais, antecipação e continuidade; fixe a identidade visual e fundos que devem permanecer imóveis. Planeje abertura, revelação e tempo legível de fechamento. Use HTML/SVG/CSS para grafismos e profundidade 2.5D; use geometria WebGL quando o objeto exigir 3D real, não para simular fotografia. Respeite resolução, duração, FPS e margens contratados. Não duplique imagens nem deixe suportes opacos cortar recortes transparentes. Se só foi solicitada uma reexportação, não redesenhe a cena.'},
  {id:'locucao',description:'Roteiro falado, pronúncia e sincronização',
    action:'Escreva para fala natural em português, respeite o motor escolhido e preserve a arte quando só o áudio mudar.',
    body:'Use frases conversacionais e pontuação adequada à entonação. Números, siglas, marcas e horas devem soar como o usuário deseja. Evite marcações que o motor de fala não suporta e não prometa controles de emoção ou velocidade inexistentes. Preserve redação literal quando exigida. Utilize o executor gerar-narracao ou juntar-videos conforme a entrega; mantenha a narração independente da trilha. Não habilite nenhuma nova API NVIDIA.'},
  {id:'montagem',description:'Edição, montagem, continuidade e preservação de mídias',
    action:'Use os arquivos existentes, na ordem declarada, e o executor juntar-videos. Preserve FPS, duração visual e voz quando não houver pedido para alterar.',
    body:'Não regenere cenas aprovadas para mudar trilha, voz, cortes ou legendas. Use caminhos reais e dependências dos produtores. A montagem preserva a taxa da primeira cena por padrão; fps explícito só quando solicitado. Sincronização global da duração visual com a locução requer autorização; se apenas áudio mudar, use sincronizarVideoComNarracao:false. Não prometa sincronização por palavra. Não altere texto aprovado nem escolha uma trilha diferente. O executor entrega o MP4; não crie revisão independente, nem invente arquivo ou encoder. Se faltar insumo, informe exatamente qual.'},
  {id:'arquivos',description:'Criação, edição e entrega de arquivos persistentes',
    action:'Use a ferramenta de leitura e edição disponível nesta conexão. Grave no caminho contratado; preserve o original e diferencie fonte editável de resultado entregue.',
    body:'Leia o conteúdo e o formato reais antes de editar. Use caminhos relativos ao workspace e as ferramentas autorizadas pelo Nivoo; nunca escreva credenciais em código, contexto, notas ou artefatos. Não use uma operação de texto para simular um arquivo binário. Preserve arquivos não relacionados, não sobrescreva versões aprovadas sem pedido, e não declare que gravou um arquivo apenas porque o mencionou na resposta. Arquivos finais destinados ao usuário ficam no destino contratado ou em out/; não grave a entrega em contexto/, que é descartável. Para mover ou apagar, use o mecanismo autorizado pelo sistema. Não altere hooks, permissões ou regras do projeto.'},
  {id:'codigo',domain:'software',description:'Correção de código com leitura de contratos e consumidores',
    action:'Leia o componente dono da responsabilidade e os consumidores afetados; faça a alteração mínima coerente e preserve interfaces e dados.',
    body:'Use busca somente para localizar; depois leia a implementação completa pertinente, seus contratos de entrada/saída, consumidores e testes existentes. Não conclua que funciona apenas por encontrar o nome de uma função. Diferencie o que foi lido, compilado, testado e executado; nunca afirme validação que não ocorreu. Diferencie falhas de tipagem, build, execução e comportamento. Não invente caminhos, opções de CLI ou APIs. Não altere requisitos para passar testes. Testes e build são responsabilidade do backend nos comandos existentes; não adicione CI nem revisões extras sem pedido.'},
  ...SOFTWARE_SKILLS,
];
export interface SkillIntent {
  phase:'planner'|'execution'; text:string; media:boolean; software:boolean;
  nativeImage?:boolean; motionAuthor?:boolean; resume?:boolean; previousError?:boolean; executor?:boolean;
}
/** Route by the current request or step, not the accumulated conversation,
 * project title, or a remote description that could instruct the system. */
export function selectSkills(intent:SkillIntent):Skill[]{
  if(intent.executor)return [];
  const t=intent.text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/_/g,' ');
  const selected=new Set<string>();
  const resume=intent.resume||/\b(retom\w*|continu\w*|checkpoint|reaproveit\w*)\b/.test(t);
  if(resume)selected.add('retomada');
  if(intent.previousError||/\b(erro|falh\w*|bloque\w*|bug|diagnostic\w*|timeout|repetic\w*)\b/.test(t))selected.add('diagnostico');
  if(intent.phase==='execution')selected.add('execucao-enxuta');
  else if(/\b(workflow|fluxo|tokens?|orquestr\w*|automac\w*)\b/.test(t))selected.add('execucao-enxuta');
  if(intent.media){
    if(intent.nativeImage||/\b(arte|artes|imagem|imagens|poster|posters|criativo|foto|fotografia|recorte|banner|layout)\b/.test(t))selected.add('direcao-artistica');
    if(intent.motionAuthor||(!intent.nativeImage&&/\b(motion|animac\w*|animar|video|videos|3d|neon|render\w*|reels)\b/.test(t)))selected.add('motion');
    if(!intent.nativeImage&&!intent.motionAuthor&&/\b(montagem|montar|juntar|mixar|mixagem|sincroniz\w*|recortar|cortes|legendas)\b/.test(t))selected.add('montagem');
    if(!intent.nativeImage&&/\b(narrac\w*|narrador\w*|locuc\w*|voz|vozes|tts|pronuncia|audio|trilha)\b/.test(t))selected.add('locucao');
  }
  if(!intent.nativeImage&&/\b(arquivo|arquivos|gravar|gravacao|salvar|escrever|editar|exportar|planilha|documento|relatorio|file|files)\b/.test(t))selected.add('arquivos');
  if(intent.software&&!intent.nativeImage&&!intent.motionAuthor){
    const specialists=selectSoftwareSkillIds(t);
    if(specialists.length||/\b(codigo|program\w*|backend|frontend|typescript|javascript|python|compil\w*|api|script|repositorio|bug|build|testes?|endpoint|controller|funcao|funcoes|classe|modulo|implement\w*|refator\w*|prisma|sql|migrac\w*)\b/.test(t))selected.add('codigo');
    for(const id of specialists)selected.add(id);
    // A prior failure can deepen an actual code step without routing on raw logs.
    if(intent.phase==='execution'&&intent.previousError&&selected.has('codigo'))selected.add('software-manutencao');
  }
  // No full skill bank in the prompt. The relevant detailed guidance is
  // materialized in the already disposable, read-only session context.
  return NIVOO_SKILLS.filter(s=>selected.has(s.id));
}

export function skillContext(skills:readonly Skill[],worktree?:string):string[]{
  if(!skills.length)return [];
  if(worktree){
    for(const s of skills){
      writeSessionContextFile(worktree,'skills-nivoo/'+s.id+'/SKILL.md',['---','name: '+s.id,'description: '+JSON.stringify(s.description),'---','','# '+s.description,'',s.body,'',...(s.source?['Inspirada em '+(s.sourceAttribution??'NVIDIA Agent Skills (Apache-2.0)')+', '+s.source+'. Adaptação Nivoo; sem scripts upstream.']:[])].join('\n')+'\n');
    }
  }
  return ['## Skills Nivoo v'+SKILLS_VERSION+' selecionadas para esta sessão',
    'Orientações auxiliares, subordinadas ao perfil, às regras de segurança e ao contrato dos executores. Não instale ferramentas, não altere permissões e não crie etapas extras por causa de uma skill.',
    ...skills.map(s=>'- '+s.id+': '+s.action+(worktree?' Leia contexto/skills-nivoo/'+s.id+'/SKILL.md se precisar dos detalhes.':''))];
}
