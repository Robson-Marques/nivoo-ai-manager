import { VIDEO_QUALITY_POLICY } from '../../jobs/video-quality-policy';
import { motionPlannerRules } from './motion-planner';
import { audioPlannerRules } from './audio-planner';
import { assemblyPlannerRules } from './assembly-planner';
import { generationPlannerRules } from './generation-planner';
const { graphicsAuthorContract } = require('../../../bin/motion-graphics') as { graphicsAuthorContract: () => string };

/** A planner selects capabilities. The specialist/renderer owns authoring details. */
export function mediaPlannerRules():string[]{
  return [
    '## Capacidades locais de mídia',
    ...VIDEO_QUALITY_POLICY.map(line=>'- '+line),
    ...motionPlannerRules(),
    ...audioPlannerRules(),
    ...assemblyPlannerRules(),
  ];
}
export function mediaOptionalGenerationRules(videoDisponivel:boolean):string[]{
  return videoDisponivel?generationPlannerRules():[];
}
export function mediaAuthorRules():string[]{
  return ['## Acabamento audiovisual obrigatório (o estilo depende do briefing)',...VIDEO_QUALITY_POLICY.map(s=>'- '+s),graphicsAuthorContract()];
}

/** Visual generation is a production capability, not a review session. */
export function mediaImageGenerationRules(available:boolean,codexProvider?:string):string[]{
  if(codexProvider)return [
    '- DIREÇÃO DE ARTE: a conexão Codex do projeto pode usar ImageGen nativo através do adaptador local do Nivoo. Crie primeiro a composição visual e os elementos fotográficos/ilustrados que faltam, com briefing de alta qualidade; use o gerador nativo antes de recorrer a qualquer API externa.',
    '  Para cada ativo realmente necessário, use a conexão selecionada, por exemplo: '+JSON.stringify({key:'arte',title:'Criar ativo editorial',provider:codexProvider,instructions:'Use ImageGen nativo; descreva objeto, luz, material, enquadramento, referência e acabamento. Um único PNG por etapa.',providerOptions:{visualAsset:{arquivo:'motion/campanha/assets/objeto.png',transparente:true},visualReferences:[]}})+'. O destino é novo e o Nivoo recupera o PNG da sessão; não peça ao agente copiar do CODEX_HOME.',
    '  Para fundo use transparente:false; para objetos isolados use transparente:true, com canal alfa real. Use referências reais do projeto; visualReferences aceita até cinco caminhos locais. Não gere novamente logo, foto ou fundo já aprovado. Para arte estática em out/ a etapa de geração é a própria entrega.',
    '  Crie a composição HTML/SVG/CSS ou 3D depois dos ativos, referencie cada caminho e declare as dependências. Anime camadas independentes, luz neon, câmera e geometria quando realmente exigida. Preserve o fundo e os recortes; não redesenhe imagens com primitivas. Um efeito 3D não implica construir tudo com malhas.',
    '  Gemini ou outra API externa paga: somente se o usuário pedir ou autorizar expressamente a alternativa. Não use como substituição automática da conexão Codex. Se ImageGen falhar, informe a falha concreta do conector sem inventar arte ou iniciar repetidas sessões.',
  ];
  return available ? [
    '- DIREÇÃO DE ARTE COM IMAGEM REAL: para campanhas novas que precisem de fotografia, ilustração ou composição editorial inédita, use primeiro os ativos existentes ou fornecidos. Se faltarem e o usuário tiver escolhido expressamente essa alternativa, proponha gemini-image (API paga; aprovação de custo antes de executar). Não substitua a IA escolhida pelo usuário nem simule fotografia com polígonos.',
    '  Exemplo de etapa: {"key":"arte","title":"Gerar imagem editorial","provider":"gemini-image","instructions":"Briefing visual completo: composição, fotografia, luz, material, paleta, enquadramento, espaço para texto. Gerar uma única imagem sem texto nem logo quando estes forem sobrepostos depois.","providerOptions":{"arquivo":"motion/campanha/assets/arte.png","proporcao":"9:16","tamanho":"1K","referencias":[]},"requiresApproval":true}.',
    '  Referências são caminhos reais PNG/JPG/WebP no projeto; para anexos do chat use anexosNoProjeto para copiá-los antes do trabalho. Não envie material a provedor externo sem consentimento.',
    '  A etapa de composição depende da geração e cita o caminho exato do PNG. A imagem é material de produção: use seus pixels, sem reconstruí-la com primitivas. Aplique texto e logo originais separadamente; prepare camadas independentes quando houver movimentos próprios. Se só houver uma imagem plana, use câmera, zoom e parallax discreto; não prometa revelar superfícies ocultas.',
    '  Para aparência 3D editorial, prefira imagem de qualidade com movimento 2.5D; use geometria real somente quando o briefing exigir movimentação tridimensional do objeto. Não transforme "premium" ou "profissional" em obrigação de modelar um objeto.',
    '  O custo pertence à geração de imagem, não à renderização local. Não adicione etapas de parecer, auditoria ou aprovação estética automática. A aprovação financeira já existente não é uma revisão artística.',
  ] : [
    '- Não há gerador visual configurado/disponível. Reutilize arte, fotografia e logo reais do projeto ou fornecidos pelo usuário; não simule fotografia editorial com caixas e polígonos. Se faltar um ativo visual essencial, exponha essa limitação e ofereça importação ou conexão de gerador de imagem, em vez de prometer qualidade impossível.',
  ];
}
