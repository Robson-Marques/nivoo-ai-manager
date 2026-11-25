import type { Skill } from '../skills';
import { frontendIntent } from './frontend';

/** Original Nivoo engineering guidance, inspired by public visual references,
 * not a copy of the prompt library or Apple's proprietary rendering technology. */
export const LIQUID_GLASS_SKILL:Skill={
  id:'software-liquid-glass',domain:'software',description:'Liquid Glass com motor óptico original Liqui Design',
  source:'https://github.com/leefanv/liqui-design',
  sourceAttribution:'Liqui Design — Fan Li, MIT; núcleo e componentes originais fixados no commit 27fea1b66069fcb8dcce133486c6fe5f49744db9',
  action:'Reutilize o núcleo original e a variante aprovada em toda a identidade do software, preservando legibilidade, semântica e desempenho.',
  body:[
    'A galeria liquidglassdesign.com é referência visual, não biblioteca de código. Use o pacote original Liqui Design fornecido no contexto, sem inventar um novo efeito óptico CSS ou shader.',
    'Use NivooGlassRoot e NivooGlassSurface do adaptador local, que usa LiquiBackdrop, LiquiThemeProvider e LiquiGlass originais. O preset Prism é oficial, Frosted usa o clássico oficial, Crystal e Dark são adaptações Nivoo dos parâmetros existentes.',
    'Aplique a identidade em shell, navegação, painéis, controles, listas, formulários, menus, modais e estados. Os componentes oficiais estão no registry local; use os adequados à tecnologia aprovada e suas dependências documentadas. Para projetos React sem Tailwind use o núcleo e adaptadores semânticos locais; não imponha troca de framework. Não copie um dashboard de demonstração como produto.',
    'Mantenha o texto legível e as operações reais: o próprio sistema original usa ações accent/danger sólidas, dados densos estáveis e vidro onde há superfície óptica. Não imponha translucidez a todo pixel nem abandone a identidade fora de um cartão.',
    'O núcleo produz mapas de deslocamento via Canvas e filtros SVG; em Chromium usa o backdrop real; Safari/Firefox podem usar cópia do fundo conhecido com LiquiBackdrop ou frost conforme suporte. CSS blur sozinho não desvia a imagem de fundo; não chame fallback de refração.',
    'Verifique o resultado no navegador e nos temas pertinentes; teste contraste composto, teclado, toque, zoom, responsividade, redução de transparência/movimento, desempenho e funcionamento dos controles. Não declare equivalência Apple nem teste não executado. Preserve licença MIT e arquivos de origem.',
    'Não crie especialidades, novos renderizadores, novas sessões, CI ou revisões redundantes. Não instale dependências externas sem necessidade real e autorização; não use artefatos visuais não licenciados.'
  ].join('\n'),
};

const normalize=(text:string)=>text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/_/g,' ');
const GLASS=/\b(?:liquid[- ]glass|vidro liquido)\b/;
const NEGATED=/\b(?:sem|evitar|evite|remover|remova|retirar|retire|desativar|desative|nao (?:usar|use|aplicar|aplique))\s+(?:o estilo\s+|o\s+)?(?:liquid[- ]glass|vidro liquido)\b/;
const UI=/\b(?:frontend|front-end|ui|ux|interfaces?|telas?|dashboard|dashboards|website|sites?|landing pages?|pwa|aplicativos?|apps?|botoes?|botao|menus?|modais?|modal|componentes?|navbar|sidebar|toolbar|design system|css|layout|temas?|navegacao|formularios?|tabelas?|paineis?|painel|estilo visual|identidade visual)\b/;
const VISUAL=/\b(?:layout|composicao|design system|css|estiliz\w*|estilo visual|identidade visual|aparencia|visual|paleta|tipografia|refin\w*|redesign|responsiv\w*|transparen\w*|refra\w*|vidro|blur|backdrop-filter|borda|sombra|tema|temas|animac\w*|microinterac\w*)\b/;
const BUILD=/\b(?:criar|crie|desenvolver|desenvolva|construir|construa|projetar|projete|implementar|implemente|montar|monte|redesenh\w*|adicionar|adicione|refatorar|refatore)\b/;
const MEDIA=/\b(?:video|videos|reels|audiovisual|poster|posters|imagem de pizza|renderizar video|ffmpeg|trilha sonora)\b/;

/** Select from the current request/step and the validated project style.
 * A persisted style alone never triggers guidance on unrelated backend work. */
export function liquidGlassIntent(text:string,visualStyleId?:string):boolean{
  const t=normalize(text);
  if(NEGATED.test(t))return false;
  const ui=UI.test(t);
  if(GLASS.test(t)){
    if(ui)return true;
    if(MEDIA.test(t))return false;
    return /^(?:liquid[- ]glass|vidro liquido)$/.test(t.trim())||
      /\b(?:aplicar|aplique|usar|use|adotar|adote|estilo|design|template)\s+(?:o\s+)?(?:liquid[- ]glass|vidro liquido)\b/.test(t);
  }
  return visualStyleId==='liquid-glass'&&!MEDIA.test(t)&&(frontendIntent(t)||ui&&(VISUAL.test(t)||BUILD.test(t)));
}

type Focus='material'|'camadas'|'refracao'|'acessibilidade'|'desempenho'|'movimento';
type Facet={id:Focus;match:RegExp;rule:string};
const FACETS:readonly Facet[]=[
  {id:'material',match:/\b(?:vidro|glass|frosted|transluc\w*|transparen\w*|iluminac\w*|reflex\w*|borda|sombra|profundidade|materia\w*|blur|backdrop-filter)\b/,rule:'Material: use tonalidade controlada, contornos e luz discretos; mantenha raios e sombras coerentes com os tokens. Reutilize a iluminação e o material do núcleo Liqui Design.'},
  {id:'camadas',match:/\b(?:botoes?|botao|menus?|navbar|toolbar|sidebar|modais?|modal|paineis?|painel|dashboard|tabelas?|formularios?|navegacao|camadas?|overlays?)\b/,rule:'Camadas: identidade estrutural do aplicativo, com material coerente na navegação, painéis, controles, menus e overlays; dados e formulários críticos em superfícies estáveis do mesmo design system. Não entregue um painel comum com uma amostra decorativa de vidro.'},
  {id:'refracao',match:/\b(?:refra\w*|distorc\w*|displacement|svg|webgl|shaders?|canvas|optica)\b/,rule:'Refração: use o núcleo original Canvas/SVG; valide a deformação real e a tier de renderização. Fallback frost/clear não equivale a refração.'},
  {id:'acessibilidade',match:/\b(?:acessib\w*|a11y|contraste|legibilidade|texto|zoom|teclado|foco|toque|mobile|celular|transparen\w*)\b/,rule:'Acessibilidade: teste contraste composto sobre fundos reais, foco, toque, zoom e alternativa opaca; preserve preferências de redução de movimento/transparência quando aplicáveis.'},
  {id:'desempenho',match:/\b(?:performance|desempenho|fps|gpu|cpu|mobile|celular|navegadores?|safari|firefox|chrome|fallback|compatib\w*)\b/,rule:'Desempenho: limite blur e camadas, use melhoria progressiva, descarte recursos e verifique fallback por navegador. Não prometa FPS sem medir.'},
  {id:'movimento',match:/\b(?:animac\w*|microinterac\w*|motion|transic\w*|movimento|hover|clique|morph\w*)\b/,rule:'Movimento: feedback breve ligado a estado real, sem loops decorativos; preserve operação sem animação e movimento reduzido.'},
];
export function liquidGlassFocus(text:string):Focus[]{
  const t=normalize(text);
  return FACETS.filter(f=>f.match.test(t)).map(f=>f.id);
}
export function liquidGlassContext(phase:'planner'|'execution',text:string):string[]{
  const ids=new Set(liquidGlassFocus(text));
  return [
    '## Liquid Glass — material, profundidade e melhoria progressiva',
    phase==='planner'?'No plano, reutilize o núcleo original Liqui Design e o preset aprovado; preserve conteúdo legível e identidade estrutural.':'Na etapa atual, aplique a identidade em toda a interface no escopo, reutilize tokens e componentes; use vidro seletivo nas camadas e a mesma linguagem visual em conteúdo opaco. Preserve ações, contraste, fallback e verifique o resultado.',
    ...FACETS.filter(f=>ids.has(f.id)).map(f=>'- '+f.rule),
    'Não trate blur como refração. Use o pacote licenciado local; não reinvente o motor nem crie sessão ou revisão extra. Preserve o perfil visual aprovado; se houver conflito, mantenha o padrão e esclareça a decisão.',
  ];
}
