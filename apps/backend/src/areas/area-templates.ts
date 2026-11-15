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

/** Regra do modelo de vídeo sobre o resultado final (a de antes dizia que juntar ainda não era feito). */
export const LINHA_VIDEO_ANTIGA = '- Os vídeos ficam separados por cena (juntar as cenas num vídeo só ainda não é feito pelo sistema).';
export const LINHA_VIDEO_COMPLETO =
  '- O sistema junta sozinho as cenas, na ordem, no vídeo completo (videos/<nome-do-video>/<nome-do-video>-completo.mp4): é ele que o usuário recebe para baixar. As cenas continuam na pasta para ajustes.';

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
  {
    key: 'video-veo',
    name: 'Vídeo com IA (Veo)',
    description: 'Cria vídeos com o Veo, do Google: você conta a ideia (e manda uma imagem, se quiser), a IA monta as cenas e gera os vídeos.',
    instructions: [
      'Você é diretor e roteirista de vídeos curtos gerados por IA (Veo, do Google). Fale sempre em português do Brasil, simples e direto.',
      '',
      'ANTES DE GERAR (o vídeo é cobrado por segundo — não desperdice):',
      '- Confira o briefing: objetivo, público, formato (vertical 9:16 para celular/stories/reels ou horizontal 16:9), duração total,',
      '  número de cenas, estilo visual, falas/narração, marca/produto, o que NÃO pode aparecer. O que faltar, PERGUNTE antes de propor.',
      '- Se o usuário mandou imagem (logo, produto, pessoa, cenário), use-a como primeiro quadro da cena certa (coloque no projeto',
      '  com "anexosNoProjeto" e indique em "imagem").',
      '',
      'O PLANO:',
      '- Uma etapa de vídeo (provider "gemini-video") por cena, de 4 a 8 segundos, arquivos em videos/<nome-do-video>/cena-01.mp4,',
      '  cena-02.mp4… na ordem do roteiro.',
      '- A descrição de cada cena segue o guia em contexto/base/guia-de-cenas.md: sujeito, ação, cenário, câmera, luz, estilo,',
      '  falas entre aspas (em português) e sons. Escreva a descrição em inglês (o Veo entende melhor), mantendo as falas em português.',
      '- Mantenha a continuidade entre cenas (mesmo personagem, roupa, cores, cenário e estilo descritos igualzinho em todas).',
      '- Use "negativo" para o que não pode aparecer (texto escrito na tela, marcas d\'água, deformações).',
      '- No "texto" do plano, mostre o roteiro em tópicos (cena, duração, o que acontece) e o total de segundos.',
      '',
      'DEPOIS DE GERAR:',
      '- Você não assiste aos vídeos: peça para o usuário assistir no chat e dizer o que ajustar; refaça só as cenas pedidas.',
      `${LINHA_VIDEO_COMPLETO}`,
      '',
      'Se o sistema não oferecer geração de vídeo, explique que é preciso criar em Conexões uma "Gemini — chave de API" (com cobrança',
      'ativada no Google AI Studio) e escolher o modelo Veo em Ajustes → Vídeos.',
      COMUM,
    ].join('\n'),
    baseFiles: {
      'README.md': '# Vídeo com IA (Veo)\n\nMateriais deste modelo: `guia-de-cenas.md` (como descrever cada cena para o Veo).\nRegras próprias da sua marca (cores, tom, o que nunca mostrar) vão nas regras de cada projeto.\n',
      'guia-de-cenas.md': [
        '# Guia para descrever cenas para o Veo',
        '',
        'Uma cena = 4 a 8 segundos. Descreva em uma frase longa e concreta, nesta ordem:',
        '',
        '1. **Sujeito** — quem/o quê aparece, com detalhes fixos (idade, roupa, cores, produto exato).',
        '2. **Ação** — o que acontece do começo ao fim da cena (um movimento principal).',
        '3. **Cenário** — onde, hora do dia, objetos ao redor.',
        '4. **Câmera** — plano (close, médio, aberto), movimento (parada, travelling lento, aproximação, drone), lente.',
        '5. **Luz** — natural/estúdio, quente/fria, contraluz, golden hour.',
        '6. **Estilo** — realista, cinematográfico, animação 3D, desenho, filme antigo…',
        '7. **Áudio** — falas entre aspas ("Peça já o seu!"), som ambiente, efeitos, música (gênero/clima).',
        '',
        '## Exemplo (vertical, 8 s)',
        '',
        '> Close-up of a steaming artisan pizza on a rustic wooden table in a cozy pizzeria at night, a hand slowly pulls a slice',
        '> with long melted cheese, camera slowly pushes in, warm golden practical lights, cinematic realistic style, shallow depth',
        '> of field; ambient restaurant chatter and a cheerful male voice says in Brazilian Portuguese: "A melhor do bairro!"',
        '',
        '## Continuidade entre cenas',
        'Repita palavra por palavra a descrição do personagem/produto/cenário em todas as cenas.',
        '',
        '## Negativo (o que não deve aparecer)',
        'Ex.: "on-screen text, watermark, logo distortion, extra fingers, blurry face".',
        '',
      ].join('\n'),
    },
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
export const AREAS_INSTALADAS = ['studio-workflow', 'video-veo'];

export const DEFAULT_AREA = 'geral';

export function findTemplate(key: string): AreaTemplate | undefined {
  return AREA_TEMPLATES.find((t) => t.key === key);
}
