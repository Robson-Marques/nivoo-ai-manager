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
export function mediaImageGenerationRules(available:boolean):string[]{
  return available ? [
    '- DIREÇÃO DE ARTE COM IMAGEM REAL: para campanhas novas que precisem de fotografia, ilustração ou composição editorial inédita, use primeiro os ativos existentes ou fornecidos. Se faltarem, proponha gerar os ativos com gemini-image (Nano Banana; API paga, aprovação de custo antes de executar), não desenhá-los com caixas, polígonos ou código de programação.',
    '  Exemplo de etapa: {"key":"arte","title":"Gerar imagem editorial","provider":"gemini-image","instructions":"Briefing visual completo: composição, fotografia, luz, material, paleta, enquadramento, espaço para texto. Gerar uma única imagem sem texto nem logo quando estes forem sobrepostos depois.","providerOptions":{"arquivo":"motion/campanha/assets/arte.png","proporcao":"9:16","tamanho":"1K","referencias":[]},"requiresApproval":true}.',
    '  Referências são caminhos reais PNG/JPG/WebP no projeto; para anexos do chat use anexosNoProjeto para copiá-los antes do trabalho. Não envie material a provedor externo sem consentimento.',
    '  A etapa de composição depende da geração e cita o caminho exato do PNG. A imagem é material de produção: use seus pixels, sem reconstruí-la com primitivas. Aplique texto e logo originais separadamente; prepare camadas independentes quando houver movimentos próprios. Se só houver uma imagem plana, use câmera, zoom e parallax discreto; não prometa revelar superfícies ocultas.',
    '  Para aparência 3D editorial, prefira imagem de qualidade com movimento 2.5D; use geometria real somente quando o briefing exigir movimentação tridimensional do objeto. Não transforme "premium" ou "profissional" em obrigação de modelar um objeto.',
    '  O custo pertence à geração de imagem, não à renderização local. Não adicione etapas de parecer, auditoria ou aprovação estética automática. A aprovação financeira já existente não é uma revisão artística.',
  ] : [
    '- Não há gerador visual configurado/disponível. Reutilize arte, fotografia e logo reais do projeto ou fornecidos pelo usuário; não simule fotografia editorial com caixas e polígonos. Se faltar um ativo visual essencial, exponha essa limitação e ofereça importação ou conexão de gerador de imagem, em vez de prometer qualidade impossível.',
  ];
}
