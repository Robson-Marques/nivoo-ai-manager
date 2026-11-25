import type { Skill } from '../skills';

export const ART_DIRECTION_SKILL:Skill={
  id:'software-direcao-artistica',domain:'software',description:'Direção artística e identidade visual de software e sites',
  source:'https://github.com/Leonxlnx/taste-skill/blob/d1a2bb41d927083ac7118f60cfc9cdf711810ea0/skills/taste-skill/SKILL.md',
  sourceAttribution:'Design Taste Frontend — Leonxlnx (MIT)',
  action:'Derive a direção visual do negócio, da marca e do público; use voz, ativos e sistema visual coerentes, sem impor templates ou alterar funções.',
  body:[
    "Adaptação do Design Taste Frontend (tasteskill 2.5.1), de Leonxlnx, para direção artística de interfaces no Nivoo. A identidade nasce da oferta real, público, setor, personalidade e materiais do cliente; não da reprodução de um site famoso ou de uma combinação estética sorteada. Preserve decisões, marcas, ativos e padrões aprovados. Em edição pontual, não imponha nova direção artística.",
    "Classifique a finalidade a partir do briefing e código: software/SaaS, jogos, hardware, produto físico, serviço profissional, estabelecimento comercial ou aplicação operacional. Software comunica com telas e funções reais; jogos com arte e universo autorizados; hardware e produtos com imagens do objeto e usos; serviços com evidências do trabalho; estabelecimentos com fotografias do local e oferta real. Sistemas operacionais e dashboards priorizam tarefa, dados e eficiência, não hero promocional. Negócios híbridos podem combinar abordagens sem confundir a oferta.",
    "Comece pelos fatos: o que se oferece, a quem, diferencial comprovado, ação principal, limitações, materiais e vocabulário do cliente. Escolha voz reconhecível, ajuste tom para erros, preços e formulários e evite slogans intercambiáveis, jargões, promessas e estatísticas inventadas. Não invente contato, endereço, valores ou horário; não substitua dados reais por .example nem apresente rascunhos como produção.",
    "Defina direção visual proporcional: personalidade, cores semânticas, tipografia, contraste, imagens, linguagem de componentes e detalhe distintivo quando útil. Reutilize design system, tokens, logos e fontes existentes. Em projeto novo, escolha sistema coerente com o cliente; não imponha restrições universais de paleta, tema, raio, densidade ou stack. Preserve cores semânticas, legibilidade, acessibilidade e responsividade.",
    "Priorize imagens reais e autorizadas: material do cliente, produto, pessoas, espaço ou interface existente. Verifique direito de uso e registre créditos quando necessários. Imagens de referência ou banco para demonstração devem ser identificadas quando não representarem produto real; não falsifique identidade, evidências ou funções. Não importe automaticamente assets, fontes ou scripts upstream. Se faltar mídia, use composição honesta com material disponível, ou peça ativo indispensável pelo fluxo existente.",
    "Uma assinatura visual deve reforçar a finalidade do produto. Fotografia e composição tipográfica podem ser mais adequadas que efeitos especiais em comércio e serviços. Interface real, diagramas e efeitos técnicos podem servir software e tecnologia quando úteis; não invente recursos nem use WebGL, shaders, geração de mídia ou render 3D como decoração obrigatória. Respeite custo, desempenho, movimento reduzido e fallback quando aplicável.",
    "Na mesma sessão de planejamento e execução, articule a direção com componentes, estados e contratos reais. Use conferência de telas e ferramentas autorizadas existentes, distinguindo observação real de leitura de código. Não importe starter, system.css, dealers aleatórios, hooks Stop, gate.mjs, checkers, Chrome adicional ou regras compulsórias de screenshots. Não crie outro sistema de design, relatório, fila, sessão ou aprovação somente por esta Skill. Composição detalhada, movimento e biblioteca de componentes são especializações complementares.",
  ].join('\n'),
};

type Focus="segmento"|"marca"|"voz"|"tipografia"|"imagem"|"assinatura"|"coerencia";
type Facet={id:Focus;match:RegExp;rule:string};
const FACETS:readonly Facet[]=[
  {id:"segmento",match:/\b(?:segmentos?|publico|audiencia|audience|negocios?|mercado|empresa|empresas|setor|trade|categoria|posicionamento|identidade visual)\b/,rule:"Segmento: identifique oferta, público, propósito e ação principal. Distinga site institucional, produto, serviço, comércio local e aplicação operacional; escolha recursos adequados ao negócio."},
  {id:"marca",match:/\b(?:marca|branding|brand|identidade|logo|logotipo|paleta|cores?|color|colours?|tokens?|design system)\b/,rule:"Marca: leia identidade, logo, cores e ativos aprovados; estabeleça papéis semânticos de fundo, texto, destaque e estados com contraste suficiente. Preserve elementos oficiais e preferências explícitas, inclusive temas e cores de marca."},
  {id:"voz",match:/\b(?:voz|voice|copy|microcopy|textos?|conteudo|headline|titulos?|slogan|cta|comunicac\w*|mensagens?|tom)\b/,rule:"Voz: derive a comunicação dos fatos, vocabulário, público e personalidade do cliente. Use títulos específicos e ações claras; nunca fabrique números, preços, horários, contatos, avaliações, depoimentos ou promessas. Se faltarem fatos, simplifique e sinalize a lacuna."},
  {id:"tipografia",match:/\b(?:tipografia|typography|fontes?|fonts?|pareamento|pairing|legibilidade|hierarquia|pesos?)\b/,rule:"Tipografia: defina uma hierarquia legível e um pareamento justificado pela marca; reutilize fontes licenciadas disponíveis e o sistema existente. Use pesos e tamanhos coerentes, leitura fluida, contraste e zoom."},
  {id:"imagem",match:/\b(?:fotograf\w*|fotos?|imagens?|images?|ativos?|assets?|ilustrac\w*|renders?|referencias?|hero|key art)\b/,rule:"Imagem: priorize ativos reais autorizados, fotografias do negócio/produto, telas reais ou arte oficial do jogo. Referências licenciadas podem ilustrar rascunhos, identificadas como tais; não as apresente como fotos do cliente. Não gere 3D por padrão nem imagens pagas sem autorização."},
  {id:"assinatura",match:/\b(?:assinatura|signature|personalidade|direcao artistica|art direction|conceito visual|creative direction|momentos?|diferenciacao|efeitos?|shaders?|webgl)\b/,rule:"Assinatura: proponha um recurso memorável coerente com a oferta. Em negócios físicos privilegie produto, pessoas, material e fotografia; em tecnologia, interface real, diagramas ou efeitos pertinentes. Efeitos são opcionais, acessíveis e proporcionais."},
  {id:"coerencia",match:/\b(?:coerencia|consistenc\w*|consistency|sistema visual|design system|componentes?|responsiv\w*|mobile|desktop|acessib\w*|contraste)\b/,rule:"Coerência: use o mesmo sistema visual na entrega, mantendo componentes, espaçamento e estados compatíveis. Aplique responsividade, foco e legibilidade; preserve contratos e ações reais. Utilize a prévia existente, sem outro checker."},
];
const normalize=(text:string)=>text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/_/g,' ');
const INTENT:readonly RegExp[]=[
  /\b(?:design[- ]taste(?:[- ]frontend)?|taste[- ]skill|tasteskill)\b/,
  /\b(?:direcao artistica|art direction|creative direction|identidade visual|visual identity|conceito visual|branding|brand identity|sistema visual)\b.{0,90}\b(?:frontend|front-end|interfaces?|site|website|landing pages?|dashboard|dashboards|portal|aplicativo|app|erp|crm|ui|pagina web|software)\b/,
  /\b(?:frontend|front-end|interfaces?|site|website|landing pages?|dashboard|dashboards|portal|aplicativo|app|erp|crm|ui|pagina web|software)\b.{0,90}\b(?:direcao artistica|art direction|creative direction|identidade visual|visual identity|conceito visual|branding|brand identity|sistema visual)\b/,
  /\b(?:criar|crie|desenvolver|desenvolva|construir|construa|projetar|projete|desenhar|desenhe|design de)\b.{0,75}\b(?:site|website|landing pages?|pagina institucional|pagina web|loja virtual)\b/,
  /\b(?:definir|criar|ajustar|refinar|desenvolver)\b.{0,60}\b(?:paleta|tipografia|voz da marca|linguagem visual|assinatura visual)\b.{0,75}\b(?:site|website|interface|frontend|dashboard|landing page|ui)\b/,
];
export function artDirectionIntent(text:string):boolean{
  return INTENT.some(r=>r.test(normalize(text)));
}
export function artDirectionFocus(text:string):Focus[]{
  const t=normalize(text);
  return FACETS.filter(f=>f.match.test(t)).map(f=>f.id);
}
export function artDirectionContext(phase:'planner'|'execution',text:string):string[]{
  const ids=new Set(artDirectionFocus(text));
  return [
    '## Direção artística — negócio, identidade e voz',
    phase==='planner'?"No plano, derive uma direção artística do tipo de negócio, oferta, público, voz, marca e ativos comprovados. Escolha sistema visual coerente e proporcional, com assinatura quando útil. Preserve identidade existente e organize decisões no contrato atual, sem documento obrigatório ou nova aprovação.":"Na etapa atual, leia marca e sistema visual reais, aplique escolhas aprovadas aos componentes existentes, mantenha conteúdo verdadeiro, ações, estados e acessibilidade. Use imagens autorizadas e confira aparência disponível sem instalar outro kit.",
    ...FACETS.filter(f=>ids.has(f.id)).map(f=>'- '+f.rule),
    "Reutilize tokens, componentes e a prévia Nivoo; não importe hooks, dealers, gate ou checkers do Design Taste. Não invente fatos, imagens reais ou verificações; sem geração paga, dependência, sessão ou revisão automática adicional.",
  ];
}
