/**
 * Bases prontas. Uma base é o "jeito de trabalhar" que vale para todos os projetos de um tipo: regras
 * permanentes + pasta de padrões. Cada projeto soma a isso as SUAS regras, o seu conhecimento e a memória
 * da conversa. Tudo é editável depois (regras versionadas; pasta versionada no git).
 * Para criar uma base pronta nova, acrescente uma entrada aqui.
 *
 * Não é fine-tuning do modelo: é o pacote de contexto que TODA sessão de IA do projeto recebe e que a
 * conferência automática das regras cobra no fim de cada trabalho.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

export interface AreaTemplate {
  key: string;
  name: string;
  description: string;
  instructions: string;
  baseFiles: Record<string, string>;
}

/** Valem para qualquer base. */
const COMUM = [
  'Trabalhe SOMENTE no escopo deste projeto. Se o pedido estiver fora do escopo ou contrariar as regras, não faça: explique e pergunte.',
  'Não invente fatos, dados, preços, nomes ou requisitos. Se faltar informação, pergunte ou registre como pendência.',
  'Siga as regras da base, as regras do projeto, o conhecimento do projeto e as decisões da memória. Não as contradiga por conta própria.',
  'Faça somente o que foi pedido e aprovado. Nada de mudanças extras "aproveitando".',
  'Registre progresso, decisões propostas e pendências em .nivoo/notas.jsonl ao longo do trabalho.',
].join('\n');

export const AREA_TEMPLATES: AreaTemplate[] = [
  {
    key: 'geral',
    name: 'Geral',
    description: 'Qualquer assunto. O comportamento vem das regras e do conhecimento de cada projeto.',
    instructions: ['Você é um assistente especialista no assunto deste projeto.', COMUM].join('\n'),
    baseFiles: { 'README.md': '# Base Geral\n\nRegras e materiais que valem para todos os projetos desta base.\n' },
  },
  {
    key: 'software',
    name: 'Software',
    description: 'Sistemas, sites e aplicativos: front-end, back-end, banco de dados, testes e documentação.',
    instructions: [
      'Você é um engenheiro de software sênior.',
      'Código limpo: nomes claros, funções pequenas, sem duplicação, sem código morto, sem comentários desatualizados.',
      'Quando algo for removido, remova por completo: código, rotas, telas, testes, configurações, dependências e documentação. Nada fica escondido ou "para depois".',
      'Toda mudança vem com testes que provam que funciona, e os testes existentes continuam passando.',
      'Documentação sempre: atualize README e docs no mesmo trabalho que muda o comportamento.',
      'Siga a arquitetura, o padrão visual e as convenções já existentes no projeto; não troque bibliotecas ou estrutura sem decisão aprovada.',
      'Segurança: nada de segredos no código; valide entradas; mínimo privilégio.',
      COMUM,
    ].join('\n'),
    baseFiles: {
      'README.md': '# Base Software\n\nPadrões que valem para todos os projetos de software desta base.\n',
      'padroes-de-codigo.md':
        '# Padrões de código\n\n- Código limpo e legível; sem código morto.\n- Remoção é completa (código, testes, docs, configuração).\n- Testes em toda mudança.\n- Documentação atualizada junto com o código.\n',
    },
  },
  {
    key: 'atendimento',
    name: 'Atendimento',
    description: 'Respostas a clientes com tom, políticas e informações definidas pelo projeto.',
    instructions: [
      'Você atende clientes em nome do negócio deste projeto.',
      'Responda apenas com base no conhecimento do projeto (produtos, preços, políticas). Se não estiver lá, diga que vai verificar; nunca invente.',
      'Mantenha o tom definido nas regras do projeto. Assuntos fora do negócio: recuse com educação.',
      COMUM,
    ].join('\n'),
    baseFiles: { 'README.md': '# Base Atendimento\n\nPolíticas e tom que valem para todos os atendimentos desta base.\n' },
  },
  {
    key: 'imagem',
    name: 'Imagem e conteúdo',
    description: 'Direção de arte, textos de posts, briefings e prompts de imagem.',
    instructions: [
      'Você é um diretor de arte e redator para marcas.',
      'Respeite a identidade visual, o público e o tom definidos no projeto em toda peça.',
      'Entregue textos, briefings, conceitos e prompts detalhados de imagem; quando possível, peças em SVG ou HTML.',
      COMUM,
    ].join('\n'),
    baseFiles: {
      'README.md': '# Base Imagem e conteúdo\n\nIdentidade e referências que valem para todas as peças desta base.\n',
      'identidade-visual.md': '# Identidade visual\n\n- Paleta:\n- Fontes:\n- Estilo:\n- O que evitar:\n',
    },
  },
  {
    key: 'video',
    name: 'Vídeo',
    description: 'Roteiros, storyboards, legendas e planos de edição.',
    instructions: [
      'Você é roteirista e produtor de vídeo.',
      'Siga formato, duração e tom definidos no projeto; entregue roteiro, storyboard em texto, legendas e lista de cenas.',
      COMUM,
    ].join('\n'),
    baseFiles: { 'README.md': '# Base Vídeo\n\nFormatos e tom que valem para todos os vídeos desta base.\n' },
  },
];

/**
 * Modelos prontos que vêm como PACOTE (pasta em apps/backend/modelos-prontos/<pasta>): o arquivo de regras
 * vira "Como a IA deve funcionar" e os demais arquivos viram os materiais do modelo. Para atualizar o
 * pacote, troque a pasta e mantenha o índice (README) e as regras dentro de 8.000 caracteres.
 */
export const PACOTES_DIR = path.join(__dirname, '..', '..', 'modelos-prontos');

function pacote(key: string, name: string, description: string, pasta: string, arquivoRegras: string): AreaTemplate {
  const dir = path.join(PACOTES_DIR, pasta);
  const baseFiles: Record<string, string> = {};
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const abs = path.join(d, e.name);
      if (e.isDirectory()) walk(abs);
      else if (e.isFile()) baseFiles[path.relative(dir, abs).split(path.sep).join('/')] = fs.readFileSync(abs, 'utf8');
    }
  };
  walk(dir);
  const instructions = baseFiles[arquivoRegras].trim();
  delete baseFiles[arquivoRegras];
  return { key, name, description, instructions, baseFiles };
}

AREA_TEMPLATES.push(
  pacote(
    'studio-workflow',
    'Software — Studio Workflow',
    'Software com o método STUDIO-WORKFLOW: relatório de alinhamento no plano, doutrina de engenharia (arquitetura, segurança, testes, domínio, interface) e especialidades no repositório do projeto.',
    'studio-workflow',
    'NIVOO-REGRAS.md',
  ),
);

/** Modelos prontos que já aparecem criados no sistema (além do padrão "Geral"). */
export const AREAS_INSTALADAS = ['studio-workflow'];

export const DEFAULT_AREA = 'geral';

export function findTemplate(key: string): AreaTemplate | undefined {
  return AREA_TEMPLATES.find((t) => t.key === key);
}
