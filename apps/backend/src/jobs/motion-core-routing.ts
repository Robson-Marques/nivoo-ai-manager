/**
 * Conexão real entre o plano de trabalho e o compositor oficial.
 *
 * Antes, scene.json/overlays.json eram só sugestões no prompt; a IA podia
 * devolver outro HTML e o executor gastaria 625 quadros com geometria errada.
 *
 * Aqui o NÚCLEO recomenda o formato na etapa autora e preserva o
 * render oficial. Não acrescenta revisores, testes finais nem etapas.
 * Renderizações de composições antigas SEM etapa produtora seguem compatíveis.
 */

// O código do motor é a fonte do contrato. O caminho é o mesmo em
// src/jobs e dist/jobs; bin já acompanha a instalação do backend.
const { motionAuthorContract } = require('../../bin/motion-scene-core') as {
  motionAuthorContract: (overlay?: boolean) => string;
};

type RawStep = Record<string, unknown>;
type MotionMode = 'scene' | 'hybrid' | 'graphics';
const { graphicsAuthorContract } = require('../../bin/motion-graphics') as { graphicsAuthorContract: () => string };

// Explicit visual rejection, not an ordinary technical retry or soundtrack edit.
export function pedeRevisaoVisual(text: string): boolean {
  const t=text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  if (/\b(?:somente|apenas|so)\s+(?:o |a )?(?:audio|trilha|musica|narracao|locucao)\b/.test(t)) return false;
  return /\b(?:veio errado|video (?:e|esta|ficou) (?:o )?mesmo|mesmo video|nao (?:criou|mudou|alterou|evoluiu)|faltam? (?:os |as )?(?:elementos graficos|grafismos|imagens|objetos|3d)|refa(?:zer|ca)|recria(?:r|cao)|faca de novo|nova composicao)\b/.test(t);
}
function pedeGrafismos(text: string): boolean {
  return /\b(?:premium|grafismos|elementos gr[aá]ficos|dire[çc][aã]o de arte|identidade visual animada|ilustra[çc][aã]o animada)\b/i.test(text);
}

const pathIsMotion = (s: string) =>
  /^motion\/[A-Za-z0-9._/-]+$/.test(s) && !s.split('/').includes('..');
const validSource = (s: string) =>
  pathIsMotion(s) && s !== 'motion' && !s.endsWith('/index.html') && !s.endsWith('/scene.json');

// O compositor e o renderizador devem apontar para a mesma fonte.
// Uma pasta de revisão pode conter scene.json antigo e index.html novo.
const RENDER_CALL = /(?:^|[;\n])\s*(?:env\s+)?(?:\/usr\/local\/bin\/)?nivoo-renderizar-motion\s+(?:"([^"]+)"|'([^']+)'|(motion\/[A-Za-z0-9._/-]+))(?=\s|$)/m;

function renderSource(command: string): string | null {
  const m = RENDER_CALL.exec(command);
  const val = m?.[1] ?? m?.[2] ?? m?.[3] ?? '';
  const source = val.replace(/\/(?:index\.html|scene\.json)$/, '');
  return validSource(source) ? source : null;
}

function selectSource(command: string, source: string, filename = 'index.html'): string {
  return command.replace(RENDER_CALL, (match, double, single, bare) => {
    const old = double !== undefined ? '"' + double + '"' :
      single !== undefined ? "'" + single + "'" : bare;
    const entry = source + '/' + filename;
    const next = double !== undefined ? '"' + entry + '"' :
      single !== undefined ? "'" + entry + "'" : entry;
    return match.slice(0, -old.length) + next;
  });
}

function selectStandaloneHtml(command: string, source: string): string {
  const html=selectSource(command,source);
  // Standalone graphics owns the complete image. Ignore stale overlay from
  // another version; only hybrid compositions use the overlay.
  const mode=/--motor\s+(?:"[^"]+"|'[^']+'|[^\s;&|]+)/;
  if(mode.test(html))return html.replace(mode,'--motor html');
  return html.replace(RENDER_CALL,m=>m+' --motor html');
}

function isComposer(step: RawStep): boolean {
  const title = String(step.title ?? '') + ' ' + String(step.key ?? '');
  const instr = String(step.instructions ?? '');
  if (instr.includes('[NIVOO_MOTION_CORE_CONTRACT_V1]')) return true;
  return (/compos|compor|cri(ar|a[çc][aã]o)|produz|desenh|animar|anima[çc][aã]o|motion|3d|refazer|recriar|reformul|corrigir|ajustar/i.test(title) ||
      /\bmotion\/[A-Za-z0-9._/-]+\/(?:index\.html|scene\.json|overlays\.json)\b/i.test(instr)) &&
    !/revis|auditor|confer|verific|valid|aprov/i.test(title) &&
    !/\bnivoo-renderizar-motion\b/.test(instr);
}

/**
 * "sem geometria 3D" e "não quero WebGL" NÃO solicitam geometria 3D.
 * A classificação considera o briefing da pessoa, nunca a terminologia
 * técnica que o próprio Nivo injetou na validação anterior do plano.
 */
export function pedeGeometria3D(texto: string): boolean {
  const limpo = texto
    .replace(/\b(?:sem|dispensar|dispensa|dispensando|evitar|evite|evitando)\s+(?:(?:qualquer|nenhuma?|uma?|de|geometria|malhas?|objetos?|efeitos?|visual|real|em)\s+){0,5}(?:3[\s-]*d|webgl)\b/gi, ' ')
    .replace(/\bn[aã]o\s+(?:quero|queremos|preciso|precisamos|usar|utilizar|inclua?|incluir|faça|fazer|criar|crie|tem|ter|tenha)\s+(?:(?:de|qualquer|nenhuma?|uma?|geometria|malhas?|objetos?|efeitos?|visual|real|em)\s+){0,5}(?:3[\s-]*d|webgl)\b/gi, ' ');
  return /\b3[\s-]*d\b|\bwebgl\b|\bextrud(?:ado|ada|idos?|idas?|ir|a(?:ç[aã]o|s))?\b/i.test(limpo);
}

/**
 * Obrigatório em ambos os caminhos: JobsService.validatePlan e create.
 * O retorno mantém exatamente a quantidade/ordem das etapas da IA.
 */
export function conectarMotorMotion(raw: unknown, defaultProvider: string, objective = ''): unknown {
  if (!Array.isArray(raw) || !raw.length) return raw;
  const steps: RawStep[] = raw.map(item =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? { ...item as RawStep } : item);

  for (let ri = 0; ri < steps.length; ri++) {
    const render = steps[ri];
    if (!render || typeof render !== 'object') continue;
    if (String(render.provider ?? defaultProvider) !== 'local-shell') continue;
    const command = String(render.instructions ?? '');
    const source = renderSource(command);
    if (!source) continue;

    const candidateIndices = steps.slice(0, ri).flatMap((s, i) => {
      if (!s || typeof s !== 'object' || !isComposer(s)) return [];
      const provider = String(s.provider ?? defaultProvider);
      if (['local-shell','juntar-videos','gemini-video','arquivos-projeto'].includes(provider)) return [];
      return [i];
    });
    if (!candidateIndices.length && pedeRevisaoVisual(objective) &&
        !['local-shell','juntar-videos','gemini-video','arquivos-projeto'].includes(defaultProvider)) {
      // A rejected creative result requires an author, not a second export.
      let key='compor-nova-arte';
      for(let n=2;steps.some(s=>s&&s.key===key);n++)key='compor-nova-arte-'+n;
      const author: RawStep = {
        key, title:'Refazer composição visual', provider:defaultProvider,
        instructions:'Crie a composição corrigida em '+source+' atendendo à última solicitação. Preserve os ativos e restrições válidos, não o visual rejeitado.',
        dependsOn:Array.isArray(render.dependsOn)?[...render.dependsOn]:[],
      };
      steps.splice(ri,0,author);
      candidateIndices.push(ri);
      ri++;
    }
    if (!candidateIndices.length) {
      // Uma nova renderização pode corrigir um problema do MOTOR sem tocar
      // em UMA linha do HTML/overlays.json já produzido. Não impedir o
      // caminho local-shell nem exigir uma nova sessão de IA para refazer v4.
      continue;
    }

    const matchesSource = candidateIndices.filter(i =>
      (String(steps[i].instructions ?? '') + ' ' + String(steps[i].verifyCommand ?? '')).includes(source));
    if (matchesSource.length > 1) continue; // não adivinhar qual IA produz a fonte
    if (!matchesSource.length && candidateIndices.length !== 1) continue;
    const ci = matchesSource[0] ?? candidateIndices[0];
    const compose = steps[ci];
    const marker = '[NIVOO_MOTION_CORE_CONTRACT_V1]';
    // Na segunda passagem (validatePlan→create) ignorar instruções que o
    // próprio Nivo acrescentou, para não inferir WebGL do texto "NÃO use WebGL".
    const original = String(compose.instructions ?? '').split('\n\n' + marker)[0];
    const text = [
      objective, String(compose.title ?? ''), original, String(render.title ?? ''),
    ].join(' ');
    const real3d = pedeGeometria3D(text);
    const hasPhotos = /pizzas?|fotografias?|imagens?|produtos?|logomarcas?|logos?|png|webp|assets?|fotos?|recort/i.test(text);
    // Se precisa de geometria 3D real, o HTML mantém a geometria; imagens
    // passam obrigatoriamente para overlay independente. Fotos 2D usam JSON.
    // 3D não pode voltar silenciosamente ao scene.json de uma revisão
    // antiga. Uma entrada HTML explícita também funciona com --motor auto.
    // Retomadas sem etapa autora mantêm a fonte originalmente escolhida.
    if (real3d) render.instructions = selectSource(command, source);
    if (real3d && !hasPhotos) {
      render.instructions=selectStandaloneHtml(command,source);
      const authorKey=String(compose.key??'');
      if(authorKey && authorKey!==String(render.key??''))
        render.dependsOn=[...new Set([...(Array.isArray(render.dependsOn)?render.dependsOn.map(String):[]),authorKey])];
      if (!String(compose.instructions ?? '').includes(marker)) {
        compose.instructions = String(compose.instructions ?? '') + '\n\n' + marker +
          ' Use ' + source + '/index.html como fonte da nova animação 3D, com geometria, materiais, iluminação e movimento próprios; não reapresente a cena 2D anterior.\n' + graphicsAuthorContract();
      }
      continue;
    }
    const mode: MotionMode = real3d ? 'hybrid' : pedeGrafismos(text) ? 'graphics' : 'scene';
    if(mode==='graphics') render.instructions=selectStandaloneHtml(command,source);
    else if(mode==='scene' && /\/index\.html(?=["'\s]|$)/.test(command)) render.instructions=selectSource(command,source,'scene.json');
    const authorKey=String(compose.key??'');
    if(authorKey && authorKey!==String(render.key??'')){
      render.dependsOn=[...new Set([...(Array.isArray(render.dependsOn)?render.dependsOn.map(String):[]),authorKey])];
    }
    if (!String(compose.instructions ?? '').includes(marker)) {
      const requirements = mode === 'scene'
        ? [
            'Entregue motion/' + source.slice(7) + '/scene.json no formato v1 do motor oficial.',
            'Use layers (image, text, shape, neon), z e supportZ para fotos; animações em keys, ritmo em profile/pacing.',
            'NÃO invente implementação de fotografia com WebGL, clones de textura ou placas escuras para simular relevo.',
          ]
        : mode === 'graphics' ? [
            'Entregue '+source+'/index.html com grafismos, SVG/CSS e animação próprios do briefing. Use WebGL nativo quando ajudar. Não use o exemplo declarativo como arte.',
          ] : [
            'Entregue ' + source + '/index.html com as MALHAS WebGL e ' + source + '/overlays.json (scene v1).',
            'Fotografias de produtos e logos de primeiro plano ficam SOMENTE em overlays.json como camadas RGBA. O fundo original fica atrás da geometria, no index.html; não coloque fundo opaco no overlay que cobre a cena 3D.',
            'NÃO duplique essas fotos no index.html nem inclíne-as para atravessar a tábua/malhas do WebGL.',
            'Remova do HTML inclusive os imports/referências aos arquivos de imagem usados no overlay, para não duplicar visualmente as fotografias.',
            'A duração overlays.json.duration deve acompanhar a duração ORIGINAL do relógio WebGL; diferenças são avisadas, não usadas para bloquear a entrega.',
            'As imagens locais podem ser PNG/WebP/JPG ou módulos JS base64 legados na pasta motion; o próprio motor as carrega.',
          ];
      compose.instructions = String(compose.instructions ?? '') + '\n\n' +
        marker + ' Contrato técnico aplicado pelo NÚCLEO do Nivo, sem criar etapas:\n' +
        requirements.map(s => '- ' + s).join('\n') +
        '\n' + (mode === 'graphics' ? graphicsAuthorContract() : mode === 'hybrid' ? graphicsAuthorContract() + '\nO contrato seguinte vale SOMENTE para o overlay transparente.\n' + motionAuthorContract(true) : motionAuthorContract()) +
        (pedeRevisaoVisual(objective) ? '\nRefação visual: a versão rejeitada é referência do que corrigir, não template. Produza os novos elementos solicitados.' : '') +
        '\n- Não execute render de MP4 nesta etapa; a ferramenta local do Nivo faz isso na etapa já prevista.';
    }
    // NÃO transformar o trabalho feito e NÃO acrescentar testes extras.
    // O próprio renderer seleciona o motor e respeita os movimentos criados
    // pela IA, sem acelerar DUAS vezes o néon após a edição da composição.
    // Critérios de entrega originais permanecem intocados.
  }
  return steps;
}
