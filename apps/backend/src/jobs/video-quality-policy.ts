/**
 * Padrão transversal de direção de arte. A qualidade de execução é fixa;
 * estilo, orçamento e complexidade acompanham cada briefing.
 */
export const VIDEO_QUALITY_POLICY = [
  'PADRÃO DE ACABAMENTO AUDIOVISUAL: todo vídeo novo, promocional, informativo, institucional ou outro, deve ter composição intencional, hierarquia legível, bom enquadramento, ritmo, tipografia, cores e acabamento adequados ao briefing. Não imponha uma estética única.',
  'Se o usuário forneceu arte de referência, ela é o alvo de fidelidade visual (proporções, hierarquia, tipografia, profundidade, luz, escala e identidade), não apenas uma inspiração. Preserve ativos originais e suas transparências; não degrade fotografias e marcas.',
  'Se não existe referência, estabeleça direção visual adequada ao objetivo e público; simplicidade premium pode significar poucas formas, espaço negativo e transições discretas, nunca ornamentos obrigatórios.',
  'Crie um quadro-chave da composição antes de animar. Compare-o à referência disponível e inspecione títulos, marcas, valores, fotos, alinhamentos, margens, contraste, acentos, sombras e volume. Refaça a composição se a hierarquia/impacto estiver inferior ao necessário.',
  'O núcleo insere duas etapas antes de nivoo-renderizar-motion: captura local do quadro-chave e inspeção de direção de arte. A inspeção deve abrir a imagem, selecionar a referência correta entre os anexos e registrar diferenças específicas em parecer.json; não declarar conforme por simples existência de MP4.',
  'As camadas devem ser independentes quando a animação exigir movimentos próprios. Evite recortar pôster como atalho, blocos opacos de ocultação, imagens esticadas, letras fora do quadro e efeitos que prejudicam a leitura.',
  'PROFUNDIDADE VISUAL 2.5D: quando a referência tiver relevo/volume, preserve camadas em Z, sombras de contato coerentes, realces posicionais, iluminação com direção definida, oclusão e movimento parallax sutil. Não basta adicionar uma sombra uniforme em cada peça.',
  'Organize fundo, grafismos, título, produto e logo com ordem espacial e distâncias consistentes. Em motion HTML/CSS, perspectiva, translateZ e transform-style:preserve-3d podem ajudar, mas não devem deformar marcas e fotos.',
  'Na animação, elementos de planos diferentes podem mover-se discretamente em velocidades diferentes e manter sombras e direção de luz coerentes; evite cartões chapados, giros exagerados, glow uniforme ou extrusão artificial.',
  'Compare quadro-chave e um quadro em movimento com a referência para verificar separação de planos, relevo, luz/sombra, escala, oclusão e legibilidade. Se a referência for flat, não imponha aparência 3D.',
  '3D COMPLETO É UMA MODALIDADE DISTINTA: pode ser planejada futuramente com malhas, câmera, materiais e renderizador 3D, mas não finja gerar geometria 3D real com simples transformações 2.5D.',
  'Ajustar somente áudio, trilha, narração ou sincronização NÃO autoriza refazer a composição visual aprovada.',
  'Movimento: temporalidade deliberada, entradas/saídas suaves, pausas suficientes para leitura, ritmo variado conforme o assunto, sem excesso de movimento ou revelações incompletas.',
  'QUADROS TEMPORAIS REAIS: revisão visual deve abrir múltiplos quadros distribuídos na duração, não só a última tela. Um cartaz final bonito não valida movimento. Confira sequência, ritmo, entradas, elementos invertidos e sobreposições ao longo do vídeo.',
  'MEGAFONE E EMISSÃO LUMINOSA, quando existirem no briefing: a boca do megafone deve apontar para o lado correto do efeito; o rastro de néon deve nascer exatamente na boca e seguir linha contínua com brilho e movimento plausíveis, sem emendas ou saltos.',
  'MOLDURAS E ETIQUETAS, quando existirem no briefing: a moldura de textos como “A partir de” precisa permanecer fechada, com cantos unidos, bordas completas, sem cortes por máscara ou camadas, e legível em todas as fases da animação.',
  'Se um quadro revelar falha objetiva de orientação, efeito, encaixe ou moldura, marque movimentoConforme=false e registre pendências concretas. Repare os arquivos da cena e recapture todos os quadros alterados antes de renderizar o MP4.',
  'Confira o resultado em vários instantes, início, meio e fim. Critério técnico (arquivo, resolução, duração) é diferente de qualidade artística. Se não for possível inspecionar, declare essa limitação; nunca finja ter validado.',
  'Não desperdice sessões tentando resolver falha de ferramenta, caminho inválido ou critério de sistema imutável. Preserve os entregáveis que existem e informe o bloqueio concreto.',
] as const;
