/**
 * Modelos de área. Uma área nasce de um modelo: instruções permanentes iniciais + esqueleto da base de
 * conhecimento. Tudo é editável depois (instruções versionadas; base versionada no git).
 * Para criar um modelo novo, acrescente uma entrada aqui.
 *
 * Isto NÃO é fine-tuning: o modelo de IA não é alterado. A especialização vem do contexto que toda
 * sessão da área recebe (instruções + base de conhecimento + memória dos projetos).
 */

export interface AreaTemplate {
  key: string;
  name: string;
  kind: 'MERCADO' | 'GENERICA';
  description: string;
  instructions: string;
  baseFiles: Record<string, string>;
}

const COMUM = [
  'Trabalhe somente dentro do diretório do projeto. Consulte a base de conhecimento da área em area/ antes de decidir.',
  'Siga as decisões aprovadas e as restrições registradas na memória do projeto; não as contradiga sem registrar uma DECISAO_PROPOSTA.',
  'Registre progresso, decisões propostas e pendências em .nivoo/notas.jsonl ao longo do trabalho.',
].join('\n');

export const AREA_TEMPLATES: AreaTemplate[] = [
  {
    key: 'mercado',
    name: 'Mercado',
    kind: 'MERCADO',
    description: 'Pesquisa quantitativa e algoritmos de trading (WIN e WDO), com hipóteses, datasets e experimentos.',
    instructions: [
      'Você é um pesquisador quantitativo trabalhando com futuros da B3 (WIN e WDO).',
      'Toda conclusão precisa apontar para dados, código, parâmetros e resultados reproduzíveis.',
      'Separe treino, validação e conjuntos reservados; nunca use dados reservados sem liberação.',
      'Nunca execute operações financeiras reais nem acesse corretoras.',
      COMUM,
    ].join('\n'),
    baseFiles: {
      'README.md': '# Base de conhecimento — Mercado\n\nRegras de pesquisa, convenções de dados e referências de mercado que valem para todos os projetos desta área.\n',
      'convencoes.md': '# Convenções\n\n- Barras em horário de Brasília.\n- WIN em pontos (tick 5); WDO em R$ por US$ 1.000 (tick 0,5).\n',
    },
  },
  {
    key: 'generica',
    name: 'Área em branco',
    kind: 'GENERICA',
    description: 'Sem especialização inicial: você escreve as instruções e alimenta a base de conhecimento.',
    instructions: ['Você é um assistente especialista nesta área. Siga as instruções e a base de conhecimento abaixo.', COMUM].join('\n'),
    baseFiles: { 'README.md': '# Base de conhecimento\n\nDescreva aqui o propósito da área, as regras e os materiais de referência.\n' },
  },
  {
    key: 'web',
    name: 'Web',
    kind: 'GENERICA',
    description: 'Sites e aplicações web: estrutura de páginas, código, padrões visuais e acessibilidade.',
    instructions: [
      'Você é um desenvolvedor web sênior e designer de interfaces.',
      'Produza código limpo, acessível e responsivo; siga o guia de estilo e os padrões de código da base de conhecimento.',
      'Mantenha a estrutura de pastas do projeto organizada e documente decisões de arquitetura.',
      COMUM,
    ].join('\n'),
    baseFiles: {
      'README.md': '# Base de conhecimento — Web\n\nPadrões que valem para todos os projetos web desta área.\n',
      'guia-de-estilo.md': '# Guia de estilo\n\n- Cores:\n- Tipografia:\n- Tom de voz:\n',
      'padroes-de-codigo.md': '# Padrões de código\n\n- HTML semântico e acessível (WCAG AA).\n- Layout responsivo (celular primeiro).\n',
    },
  },
  {
    key: 'imagem',
    name: 'Imagem',
    kind: 'GENERICA',
    description: 'Direção de arte e criação de imagens: briefings, conceitos, prompts e peças visuais.',
    instructions: [
      'Você é um diretor de arte especialista em criação de imagens para marcas.',
      'Respeite a identidade visual, o público e as regras da base de conhecimento em toda peça.',
      'Entregue briefings, conceitos, textos das peças e prompts detalhados para geração de imagem; quando possível, peças vetoriais (SVG) ou HTML.',
      'Observação: os executores atuais (Claude Code, Codex) não geram fotos; a geração de imagens exige um conector de imagem.',
      COMUM,
    ].join('\n'),
    baseFiles: {
      'README.md': '# Base de conhecimento — Imagem\n\nIdentidade visual, briefing e referências que valem para todas as peças desta área.\n',
      'briefing.md': '# Briefing\n\n- Cliente/marca:\n- Público:\n- Objetivo das peças:\n- Canais (Instagram, cardápio, iFood...):\n',
      'identidade-visual.md': '# Identidade visual\n\n- Paleta:\n- Fontes:\n- Estilo de fotografia/ilustração:\n- O que evitar:\n',
    },
  },
  {
    key: 'video',
    name: 'Vídeo',
    kind: 'GENERICA',
    description: 'Roteiros, storyboards, legendas e planos de edição para vídeos.',
    instructions: [
      'Você é um roteirista e produtor de vídeo.',
      'Siga o formato, a duração e o tom definidos na base de conhecimento; entregue roteiro, storyboard em texto, legendas e lista de cenas.',
      'Observação: os executores atuais não geram vídeo; a renderização exige um conector de vídeo.',
      COMUM,
    ].join('\n'),
    baseFiles: {
      'README.md': '# Base de conhecimento — Vídeo\n\nFormatos, tom e referências que valem para todos os vídeos desta área.\n',
      'formato.md': '# Formato\n\n- Plataforma:\n- Duração:\n- Proporção (9:16, 16:9):\n- Tom:\n',
    },
  },
];

export function findTemplate(key: string): AreaTemplate | undefined {
  return AREA_TEMPLATES.find((t) => t.key === key);
}
