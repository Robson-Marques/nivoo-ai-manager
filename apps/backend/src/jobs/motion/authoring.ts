import type { RawStep, MotionMode } from './types';
const { motionAuthorContract } = require('../../../bin/motion-scene-core') as { motionAuthorContract: (overlay?: boolean) => string };
const { graphicsAuthorContract } = require('../../../bin/motion-graphics') as { graphicsAuthorContract: () => string };

export const MOTION_CONTRACT_MARKER = '[NIVOO_MOTION_CORE_CONTRACT_V1]';
export const MOTION_EDIT_MARKER='[NIVOO_MOTION_EDIT_V1]';

export function isComposer(step: RawStep): boolean {
  const title = String(step.title ?? '') + ' ' + String(step.key ?? '');
  const instr = String(step.instructions ?? '');
  if (instr.includes(MOTION_CONTRACT_MARKER)||instr.includes(MOTION_EDIT_MARKER)) return true;
  // Reports, scripts, standalone assets and speech are not Motion sources merely because their title says criar/ajustar.
  const output=String(step.verifyCommand??'');
  if(/\btest\s+-(?:s|f|e)\s+['"]?(?:out|motion)\/[\w./-]+\.(?:png|jpe?g|webp|mp3|wav|md|pdf|txt)\b/i.test(output)&&! /motion\/[A-Za-z0-9._/-]+\/(?:index\.html|scene\.json|overlays\.json)\b/i.test(instr+' '+output))return false;
  if(/\b(?:recuper\w*|retom\w*|edit\w*)\b/i.test(title)&&/\bmotion\/[A-Za-z0-9._/-]+\/(?:index\.html|scene\.json)\b/i.test(output)&&! /\bnivoo-renderizar-motion\b/.test(instr))return true;
  return (/compos|compor|cri(ar|a[çc][aã]o)|produz|desenh|animar|anima[çc][aã]o|motion|3d|refazer|recriar|reformul|corrigir|ajustar/i.test(title) ||
      /\bmotion\/[A-Za-z0-9._/-]+\/(?:index\.html|scene\.json|overlays\.json)\b/i.test(instr)) &&
    !/revis|auditor|confer|verific|valid|aprov/i.test(title) &&
    !/\bnivoo-renderizar-motion\b/.test(instr);
}


export function originalAuthorInstructions(compose: RawStep): string {
  return String(compose.instructions ?? '').split('\n\n'+MOTION_CONTRACT_MARKER)[0].split('\n\n'+MOTION_EDIT_MARKER)[0];
}

/** Only supplies the author with the contract for the chosen production mode. */
export function attachAuthorContract(compose: RawStep, source: string, mode: MotionMode, visualRevision: boolean): void {
    if (!String(compose.instructions ?? '').includes(MOTION_CONTRACT_MARKER)) {
      const requirements = mode === 'scene'
        ? [
            'Entregue motion/' + source.slice(7) + '/scene.json no formato v1 do motor oficial.',
            'Use layers (image, text, shape, neon), z e supportZ para fotos; animações em keys, ritmo em profile/pacing.',
            'NÃO invente implementação de fotografia com WebGL, clones de textura ou placas escuras para simular relevo.',
          ]
        : mode === 'graphics' ? [
            'Entregue '+source+'/index.html com grafismos, SVG/CSS e animação próprios do briefing. Use CSS 3D (perspective, transform-origin, rotateX/rotateY) para animar elementos PNG com alfa sem redesenhar seus pixels; sombras, luz neon, máscaras e SVG podem ter movimento próprio. Use WebGL nativo quando realmente precisar de geometria. Não use o exemplo declarativo como arte.',
          ] : [
            'Entregue ' + source + '/index.html com as MALHAS WebGL e ' + source + '/overlays.json (scene v1).',
            'Fotografias de produtos e logos de primeiro plano ficam SOMENTE em overlays.json como camadas RGBA. O fundo original fica atrás da geometria, no index.html; não coloque fundo opaco no overlay que cobre a cena 3D.',
            'Exceção: uma foto que precisa de máscara dinâmica, deformação de pixels, morphing ou animação de tecido/queijo pode ser desenhada diretamente no Canvas do HTML, sem duplicação no overlay. Se todas as mídias já pertencem ao HTML, overlays.json pode declarar layers:[]; preserve width, height, duration e version:1. Não invente uma camada só para preencher o JSON.',
            'NÃO duplique as fotos que estão no overlay no index.html nem inclíne-as para atravessar a tábua/malhas do WebGL.',
            'Remova do HTML inclusive os imports/referências aos arquivos de imagem usados no overlay, para não duplicar visualmente as fotografias.',
            'A duração overlays.json.duration deve acompanhar a duração ORIGINAL do relógio WebGL; diferenças são avisadas, não usadas para bloquear a entrega.',
            'As imagens locais podem ser PNG/WebP/JPG ou módulos JS base64 legados na pasta motion; o próprio motor as carrega.',
          ];
      compose.instructions = String(compose.instructions ?? '') + '\n\n' +
        MOTION_CONTRACT_MARKER + ' Contrato técnico aplicado pelo NÚCLEO do Nivo, sem criar etapas:\n' +
        requirements.map(s => '- ' + s).join('\n') +
        '\n- Ativos visuais reais e referências aprovadas são a base da composição. Não os substitua por livros, caixas ou polígonos genéricos inventados. Use os arquivos locais na cena, preserve a aparência, e escolha movimento compatível com a informação de profundidade disponível.' +
        '\n' + (mode === 'graphics' ? graphicsAuthorContract() : mode === 'hybrid' ? graphicsAuthorContract() + '\nO contrato seguinte vale SOMENTE para o overlay transparente.\n' + motionAuthorContract(true) : motionAuthorContract()) +
        (visualRevision ? '\nRefação visual: a versão rejeitada é referência do que corrigir, não template. Produza os novos elementos solicitados.' : '') +
        '\n- Não execute render de MP4 nesta etapa; a ferramenta local do Nivo faz isso na etapa já prevista.';
    }

}

export function attachStandalone3DContract(compose: RawStep, source: string): void {
  if (!String(compose.instructions ?? '').includes(MOTION_CONTRACT_MARKER)) {
    compose.instructions = String(compose.instructions ?? '') + '\n\n' + MOTION_CONTRACT_MARKER +
      ' Use ' + source + '/index.html como fonte da nova animação 3D, com geometria, materiais, iluminação e movimento próprios; não reapresente a cena 2D anterior.\n' + graphicsAuthorContract();
  }
}

/** Output contract for an internally created producer; no extra session. */
export function authorOutputCheck(source: string, mode: MotionMode): string {
  const files=mode==='scene'?['scene.json']:mode==='hybrid'?['index.html','overlays.json']:['index.html'];
  return files.map(name=>"test -s '"+source+'/'+name+"'").join(' && ');
}

/** A generated file-existence check must follow the source selected by the
 * workflow. Preserve custom verification (tests, reports, content checks).
 * This replaces the existing simple output check; it adds no verification step.
 */
export function reconcileAuthorOutput(compose:RawStep,source:string,mode:MotionMode):void{
  const check=String(compose.verifyCommand??'').trim();
  if(!check){compose.verifyCommand=authorOutputCheck(source,mode);return;}
  const parts=check.split(/\s*&&\s*/);
  const isSourceCheck=parts.every(part=>{
    const m=/^test\s+-(?:s|f|e)\s+(?:"([^"]+)"|'([^']+)'|([^\s]+))$/.exec(part.trim());
    if(!m)return false;
    const file=m[1]??m[2]??m[3];
    return ['scene.json','index.html','overlays.json'].some(name=>file===source+'/'+name);
  });
  if(isSourceCheck)compose.verifyCommand=authorOutputCheck(source,mode);
}

/** Edit a real source without imposing a new artistic or rendering format. */
export function attachEditContract(compose:RawStep,source:string,entry:string,mode:string):void{
  const original=originalAuthorInstructions(compose);
  compose.instructions=original+'\n\n'+MOTION_EDIT_MARKER+
    ' Edite a composição existente em '+source+'. Entrada do render: '+entry+'; motor: '+mode+'. '+
    'Localize a versão realmente aprovada no trabalho de origem, leia as fontes e copie os arquivos necessários, inclusive JS, CSS, imagens e máscaras. '+
    'Altere exclusivamente os elementos solicitados, preservando os demais pixels, textos, relógio, fundo, posição, tempo, dimensões e ativos. '+
    'Não migre o motor nem recrie uma arte aprovada por causa de instruções genéricas. Preserve overlays não vazios e não duplique no HTML os elementos que eles já desenham. '+
    'Para imagem nova ou correção de pixels que não se resolve por máscara/transformação, use o editor de imagem compatível e autorizado numa etapa de ativo, com referência real; não simule PNG com texto. '+
    'Se a correção é de movimento, máscara ou encaixe, edite o código responsável. Não invente uma camada para preencher overlays.json: um overlay explicitamente vazio e válido é permitido. '+
    'A etapa deve produzir os arquivos fonte corrigidos, não só um relato; o render local existente exportará o MP4. Sem nova sessão de revisão.';
}
