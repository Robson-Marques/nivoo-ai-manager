/**
 * Catálogo da NVIDIA Build: finalidade do modelo != protocolo != permissão de uso.
 * Fonte dos itens conhecidos: https://build.nvidia.com/models (22/11/2026).
 *
 * GET /v1/models identifica IDs disponíveis no gateway do usuário, mas NÃO é
 * o catálogo completo de NIMs (há endpoints especializados e modelos apenas
 * para download). Por isso nunca assumimos que um ID desconhecido é chat.
 */
export type NvidiaArea =
  | 'agentes' | 'conversa' | 'visao' | 'imagens' | 'video'
  | 'audio' | 'documentos' | 'busca' | 'dados' | 'ciencia' | 'seguranca' | 'a-verificar';
export type NvidiaEndpoint =
  | 'chat-completions' | 'embedding' | 'rerank' | 'imagem' | 'video'
  | 'audio' | 'documentos' | 'dados' | 'especializado' | 'desconhecido';
export type NvidiaOferta = 'free-endpoint' | 'download' | 'ambos' | 'nao-verificada';

export const NVIDIA_AREAS: Array<{ id: NvidiaArea; nome: string; descricao: string }> = [
  { id: 'agentes', nome: 'Programação e agentes', descricao: 'Modelos de código e ferramentas para Studio Workflow' },
  { id: 'conversa', nome: 'Conversa e raciocínio', descricao: 'Textos, planejamento, análise e perguntas' },
  { id: 'visao', nome: 'Visão e multimodal', descricao: 'Entendimento de imagens e vídeos (não significa geração)' },
  { id: 'imagens', nome: 'Imagens e design', descricao: 'Geração, edição e tratamento de imagens' },
  { id: 'video', nome: 'Vídeo e animação', descricao: 'Geração, animação, edição e tratamento de vídeo' },
  { id: 'audio', nome: 'Áudio e idiomas', descricao: 'Transcrição, voz e tradução' },
  { id: 'documentos', nome: 'Documentos e privacidade', descricao: 'OCR, parsing, dados pessoais e extração' },
  { id: 'busca', nome: 'Pesquisa e RAG', descricao: 'Embeddings, vetorização e reranking' },
  { id: 'dados', nome: 'Dados estruturados', descricao: 'Previsões tabulares e relacionais' },
  { id: 'ciencia', nome: 'Ciência e modelos especializados', descricao: 'Biologia, física e técnicas científicas' },
  { id: 'seguranca', nome: 'Segurança e moderação', descricao: 'Verificação de conteúdo, prevenção de abusos e privacidade' },
  { id: 'a-verificar', nome: 'Ainda não classificados', descricao: 'A função real depende da documentação do modelo' },
];

export interface NvidiaCatalogItem {
  /** ID literal para chamadas de API somente quando confirmado em referência oficial. */
  id: string | null;
  nome: string;
  areas: NvidiaArea[];
  uso: string;
  endpoint: NvidiaEndpoint;
  oferta: NvidiaOferta;
  /** Funções documentadas no endpoint de chat. Não inferir de "agentic" apenas. */
  ferramentas: boolean;
  /** O conector do Nivoo atualmente sabe chamar esse protocolo? */
  utilizavelNoWorkflow: boolean;
  /** ID devolvido por GET /v1/models para ESTA chave (não garante quota). */
  listadoNaChave: boolean;
  fonte: 'nvidia-build' | 'api-models';
}

type Linha = readonly [
  nome: string, id: string | null, areas: NvidiaArea[], uso: string,
  endpoint: NvidiaEndpoint, oferta: NvidiaOferta, ferramentas?: boolean
];

/**
 * Referência inicial curada por finalidade. Os IDs null aparecem no site,
 * mas não foram confirmados como model=... de uma API: NÃO inventá-los.
 */
const CONHECIDOS: Linha[] = [
  ['Kimi K3.1 Pro', 'moonshotai/kimi-k3.1-pro', ['agentes', 'conversa', 'visao'], 'Código, agentes, modelos 3D e raciocínio', 'chat-completions', 'ambos', true],
  ['Nemotron 3.5 Super VL', 'nvidia/nemotron-3.5-super-vl-120b-a12b', ['agentes', 'visao', 'conversa'], 'Código, ferramentas, imagens e vídeo de entrada', 'chat-completions', 'free-endpoint', true],
  ['Nemotron 3.5 Bolt E4B', 'nvidia/nemotron-3.5-bolt-e4b', ['agentes', 'conversa'], 'Agentes de texto, raciocínio rápido e ferramentas', 'chat-completions', 'free-endpoint', true],
  ['Mistral Large 4', 'mistralai/mistral-large-4-1t-a52b', ['conversa', 'visao', 'agentes'], 'Raciocínio, imagem de entrada e function calling', 'chat-completions', 'free-endpoint', true],
  ['Step 5 Preview', null, ['conversa', 'visao', 'agentes'], 'Texto, imagens, raciocínio e ferramentas', 'chat-completions', 'free-endpoint', true],
  ['GLM-5.3 Flash', null, ['conversa', 'agentes', 'visao'], 'Raciocínio multimodal e uso de ferramentas', 'chat-completions', 'free-endpoint', true],
  ['MiniMax M3.1 Flash', null, ['agentes', 'visao'], 'Código, agentes e interpretação multimodal', 'chat-completions', 'free-endpoint'],
  ['Nemotron 3.5 Lightning', null, ['agentes', 'conversa'], 'Agentes rápidos para tarefas especializadas', 'chat-completions', 'ambos'],
  ['Muse Glimmer 30B', null, ['visao', 'conversa', 'agentes'], 'Raciocínio sobre imagens e texto com ferramentas', 'chat-completions', 'ambos', true],
  ['Nemotron 3.5 Parse', null, ['documentos'], 'Extrair texto, tabelas e layout de documentos', 'documentos', 'free-endpoint'],
  ['GLiNER2 PII', null, ['documentos'], 'Detectar e localizar dados pessoais em textos', 'especializado', 'free-endpoint'],
  ['Nemotron 3.5 Rerank 8B', null, ['busca'], 'Ordenar resultados por relevância, inclusive documentos visuais', 'rerank', 'free-endpoint'],
  ['Nemotron 3.5 Embed 1B', null, ['busca'], 'Criar vetores para busca semântica e RAG', 'embedding', 'free-endpoint'],
  ['Nemotron 3.5 Embed 8B', null, ['busca'], 'Criar vetores de textos e documentos visuais', 'embedding', 'free-endpoint'],
  ['FLUX 3 Image Klein', null, ['imagens'], 'Gerar e editar imagens', 'imagem', 'download'],
  ['Wan 2.2 Animate', null, ['video'], 'Animação de personagens; requer implantação específica', 'video', 'download'],
  ['Video Super Resolution NIM', null, ['video'], 'Aumentar resolução de vídeos; requer implantação específica', 'video', 'download'],
  ['3D Body Pose', null, ['video', 'visao'], 'Estimar poses e esqueleto 3D de vídeo (não gera vídeo)', 'video', 'ambos'],
  ['Kumo Tabular', null, ['dados'], 'Classificar e prever valores de tabelas', 'dados', 'ambos'],
  ['Kumo Relational', null, ['dados'], 'Previsões em múltiplas tabelas relacionadas', 'dados', 'ambos'],
  ['Parakeet TDT 0.6B', null, ['audio'], 'Transcrever fala com pontuação e timestamps', 'audio', 'download'],
  ['Riva Translate 4B', null, ['audio'], 'Traduzir textos em vários idiomas', 'especializado', 'free-endpoint'],
  ['RFD4 Proteina', null, ['ciencia'], 'Design de proteínas, enzimas e anticorpos', 'especializado', 'free-endpoint'],
  ['Ising Calibration 1.5', null, ['ciencia', 'visao'], 'Análise de gráficos de calibração quântica', 'especializado', 'free-endpoint'],
  ['Cosmos3 Nano', null, ['video', 'imagens'], 'Gerar imagens, vídeos e previsões de ação; endpoint próprio', 'video', 'ambos'],
  ['Cosmos3 Nano Reasoner', null, ['visao', 'video'], 'Compreender imagens e vídeos (não gera vídeo)', 'chat-completions', 'ambos'],
  ["Nemotron 3 Embed 1B",null,["busca"],"Vetorização para pesquisa e RAG (descontinuação anunciada)","embedding","free-endpoint"],
  ["Laguna XS 2.1",null,["agentes"],"Programação agêntica de longo horizonte","chat-completions","free-endpoint"],
  ["Qwen Image Edit NVPCB",null,["imagens"],"Edição de imagem industrial e iluminação","imagem","download"],
  ["Nemotron OCR V2",null,["documentos"],"OCR multilíngue de documentos complexos","documentos","download"],
  ["Nemotron 3 Ultra 550B",null,["agentes","conversa"],"Programação, planejamento, raciocínio e uso de ferramentas","chat-completions","ambos"],
  ["Chatterbox Multilingual TTS",null,["audio"],"Síntese de voz expressiva multilíngue","audio","download"],
  ["Nemotron 3.5 Content Safety",null,["seguranca","visao"],"Moderação de conteúdo multimodal","especializado","ambos"],
  ["Qwen Image",null,["imagens"],"Geração de imagens com texto multilíngue","imagem","download"],
  ["Qwen Image Edit",null,["imagens"],"Edição de imagens e textos dentro da imagem","imagem","download"],
  ["Nemotron 3 Nano Omni 30B",null,["visao","audio","conversa"],"Entender texto, imagem, vídeo e fala; não gera vídeo","chat-completions","ambos"],
  ["Relighting",null,["video"],"Alterar iluminação de pessoas em vídeo","video","download"],
  ["Synthetic Video Detector",null,["video","seguranca"],"Detecção de vídeo sintético","video","ambos"],
  ["Active Speaker Detection",null,["video","audio"],"Detectar quem está falando em vídeo","video","ambos"],
  ["LipSync",null,["video","audio"],"Sincronizar movimento labial com áudio","video","download"],
  ["Ising Calibration 1 35B",null,["ciencia","visao"],"Analisar gráficos de calibração quântica","especializado","ambos"],
  ["Gemma 4 31B IT",null,["conversa","agentes"],"Raciocínio e programação; ferramentas ainda não confirmadas","chat-completions","ambos"],
  ["Nemotron ASR Streaming",null,["audio"],"Transcrição de fala em tempo real","audio","download"],
  ["FLUX 2 Klein 4B",null,["imagens"],"Gerar e editar imagens rapidamente","imagem","download"],
  ["Nemotron OCR V1",null,["documentos"],"OCR de imagens e documentos","documentos","download"],
  ["Nemotron Table Structure V1",null,["documentos"],"Detectar tabelas, gráficos e títulos","documentos","download"],
  ["Nemotron Page Elements V3",null,["documentos"],"Detectar elementos e layout de páginas","documentos","download"],
  ["Nemotron Graphic Elements V1",null,["documentos"],"Reconhecer componentes gráficos em documentos","documentos","download"],
  ["Evo2 40B Forward",null,["ciencia"],"Analisar sequências de DNA","especializado","download"],
  ["Evo2 7B Forward",null,["ciencia"],"Analisar sequências genômicas","especializado","download"],
  ["StreamPETR",null,["visao","dados"],"Detecção temporal de objetos 3D para direção autônoma","especializado","free-endpoint"],
  ["Llama 3.1 Nemotron Safety Guard 8B V3",null,["seguranca"],"Moderação e segurança de conteúdos multilíngues","especializado","free-endpoint"],
  ["OpenFold3",null,["ciencia"],"Estrutura 3D de complexos biomoleculares","especializado","download"],
  ["Parakeet CTC 0.6B ZH TW",null,["audio"],"Transcrever mandarim taiwanês e inglês","audio","download"],
  ["Parakeet CTC 0.6B ZH CN",null,["audio"],"Transcrever mandarim e inglês","audio","download"],
  ["Parakeet CTC 0.6B ES",null,["audio"],"Transcrever espanhol e inglês","audio","download"],
  ["Parakeet CTC 0.6B VI",null,["audio"],"Transcrever vietnamita e inglês","audio","download"],
  ["Trellis",null,["imagens"],"Gerar ativos e objetos 3D a partir de texto ou imagem","imagem","download"],
  ["Stable Diffusion 3.5 Large",null,["imagens"],"Geração de imagens","imagem","download"],
  ["FLUX.1 Kontext Dev",null,["imagens"],"Edição e geração contextual de imagens","imagem","download"],
  ["Parakeet TDT 0.6B V2",null,["audio"],"Transcrever inglês com timestamps","audio","download"],
  ["NeMoRetriever OCR",null,["documentos"],"OCR de imagens e estrutura de páginas","documentos","download"],
  ["Riva Translate 1.6B",null,["audio"],"Tradução multilíngue","especializado","download"],
  ["Background Noise Removal",null,["audio"],"Remoção de ruído em áudios","audio","ambos"],
  ["Boltz 2",null,["ciencia"],"Previsão de estruturas moleculares","especializado","download"],
  ["Magpie TTS Zeroshot",null,["audio"],"Gerar voz expressiva a partir de amostra","audio","free-endpoint"],
  ["FLUX.1 Schnell",null,["imagens"],"Geração rápida de imagens","imagem","download"],
  ["Parakeet 1.1B RNNT Multilingual ASR",null,["audio"],"Transcrição em diversos idiomas","audio","download"],
  ["FLUX.1 Dev",null,["imagens"],"Geração de imagens","imagem","download"],
  ["SparseDrive",null,["visao","dados"],"Percepção e planejamento de direção autônoma","especializado","free-endpoint"],
  ["BEVFormer",null,["visao","dados"],"Percepção 3D de ambientes para direção autônoma","especializado","free-endpoint"],
  ["Magpie TTS Multilingual",null,["audio"],"Síntese expressiva de voz multilíngue","audio","download"],
  ["MSA Search",null,["ciencia"],"Alinhamento de sequências de proteínas","especializado","download"],
  ["OpenFold2",null,["ciencia"],"Estrutura 3D de proteínas","especializado","download"],
  ["Evo2 40B",null,["ciencia"],"Modelos de genômica e sequências longas","especializado","download"],
  ["Whisper Large V3",null,["audio"],"Reconhecimento automático de fala","audio","download"],
  ["Canary 1B ASR",null,["audio"],"Transcrição e tradução de fala (descontinuação anunciada)","audio","download"],
  ["Nemoguard 8B Topic Control",null,["seguranca"],"Controle de temas permitidos em conversas","especializado","download"],
  ["Nemoguard Jailbreak Detect",null,["seguranca"],"Detecção de prompt injection e jailbreak","especializado","download"],
  ["GenMol",null,["ciencia"],"Geração molecular por difusão","especializado","download"],
  ["PaddleOCR",null,["documentos"],"Extração de textos, tabelas e caixas delimitadoras","documentos","download"],
  ["Conformer CTC ASR",null,["audio"],"Transcrição de fala em espanhol","audio","download"],
  ["FourCastNet",null,["ciencia","dados"],"Simulação de tempo e clima","especializado","download"],
  ["Studio Voice",null,["audio"],"Melhorar qualidade e clareza da fala","audio","ambos"],
  ["Megatron 1B NMT",null,["audio"],"Tradução neural","especializado","download"],
  ["Parakeet CTC 1.1B ASR",null,["audio"],"Transcrição de fala em inglês","audio","download"],
  ["Parakeet CTC 0.6B ASR",null,["audio"],"Transcrição de fala em inglês","audio","download"],
  ["ProteinMPNN",null,["ciencia"],"Projetar sequências de aminoácidos para proteínas","especializado","download"],
  ["EyeContact",null,["video"],"Corrigir direção do olhar em vídeo","video","download"],
  ["RFDiffusion",null,["ciencia"],"Geração de estruturas proteicas","especializado","download"],
  ["PaliGemma",null,["visao","conversa"],"Compreender conteúdo de imagens e texto","chat-completions","free-endpoint"],
  ["MolMIM",null,["ciencia"],"Geração molecular controlada","especializado","download"],
  ["DiffDock",null,["ciencia"],"Predizer interações molécula-proteína","especializado","download"],
  ["cuOpt",null,["dados"],"Otimização de rotas e logística","especializado","download"],
];

function chave(nome: string): string {
  return nome.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}
function igual(a: string, b: string): boolean {
  const x = chave(a.split('/').pop() ?? a);
  const y = chave(b.split('/').pop() ?? b);
  // A página mostra nomes curtos; os IDs reais às vezes incluem quantização
  // e versão (ex.: "nemotron-3-nano-omni-30b-a3b-reasoning").
  return x === y || (x.length >= 16 && y.startsWith(x)) || (y.length >= 16 && x.startsWith(y));
}
function modeloConhecido(id: string): Linha | undefined {
  return CONHECIDOS.find((l) => (l[1] && igual(l[1], id)) || igual(l[0], id));
}

function adivinharEspecialidadePeloId(id: string): Pick<NvidiaCatalogItem, 'areas' | 'endpoint' | 'uso'> {
  // Apenas classificar *conservadoramente* famílias inequívocas; nunca
  // declarar function calling de um LLM desconhecido.
  if (/rerank|ranking|ranker/i.test(id)) return { areas: ['busca'], endpoint: 'rerank', uso: 'Reranking (confirmar documentação)' };
  if (/embed|embedding|retriev/i.test(id)) return { areas: ['busca'], endpoint: 'embedding', uso: 'Embeddings ou recuperação (confirmar documentação)' };
  if (/flux|stable-diffusion|image-gen|image-edit/i.test(id)) return { areas: ['imagens'], endpoint: 'imagem', uso: 'Imagem (confirmar endpoint)' };
  if (/super.resolution|video.upscal|animate|video.diffusion/i.test(id)) return { areas: ['video'], endpoint: 'video', uso: 'Vídeo (confirmar endpoint)' };
  if (/tts|asr|speech|parakeet|whisper|translate/i.test(id)) return { areas: ['audio'], endpoint: 'audio', uso: 'Áudio ou tradução (confirmar endpoint)' };
  if (/pii|gliner|document.parse|nemotron.parse|ocr/i.test(id)) return { areas: ['documentos'], endpoint: 'documentos', uso: 'Documento ou privacidade (confirmar endpoint)' };
  if (/safety|guard|jailbreak/i.test(id)) return { areas: ['seguranca'], endpoint: 'especializado', uso: 'Modelo de moderação/segurança (confirmar endpoint)' };
  if (/(llama|qwen|deepseek|mistral|gemma|nemotron|minimax|glm)[-_./]/i.test(id)) {
    return { areas: ['conversa'], endpoint: 'desconhecido', uso: 'Família de modelo de linguagem; verificar suporte a chat e ferramentas antes de utilizar' };
  }
  return { areas: ['a-verificar'], endpoint: 'desconhecido', uso: 'Modelo retornado pela API, capacidade ainda não documentada no Nivoo' };
}

/**
 * A categoria é multi-rótulo: um modelo pode servir a chat, visão e código.
 * O seletor do Studio, porém, SÓ inclui modelos com chat+tool calling documentados.
 */
export function catalogarNvidiaModelos(idsDaApi: string[] = []): NvidiaCatalogItem[] {
  const ids = [...new Set(idsDaApi.filter((id) => typeof id === 'string' && /^[A-Za-z0-9._:/-]{1,150}$/.test(id)))];
  const lista: NvidiaCatalogItem[] = CONHECIDOS.map(([nome, id, areas, uso, endpoint, oferta, ferramentas]) => {
    const idReal = ids.find((v) => (id && igual(id, v)) || igual(nome, v));
    return { id: idReal ?? id, nome, areas, uso, endpoint, oferta,
      ferramentas: ferramentas === true, utilizavelNoWorkflow: endpoint === 'chat-completions' && ferramentas === true,
      listadoNaChave: !!idReal, fonte: 'nvidia-build' };
  });
  for (const id of ids) {
    if (lista.some((m) => m.id && igual(m.id, id))) continue;
    const espec = modeloConhecido(id);
    if (espec) continue;
    const reconhecido = adivinharEspecialidadePeloId(id);
    lista.push({ id, nome: id, ...reconhecido, oferta: 'nao-verificada',
      ferramentas: false, utilizavelNoWorkflow: false,
      listadoNaChave: true, fonte: 'api-models' });
  }
  return lista;
}

export function modelosNvidiaParaWorkflow(idsDaApi: string[] = []): Array<{ id: string; nome: string; categoria: string; descricao: string }> {
  return catalogarNvidiaModelos(idsDaApi)
    .filter((m) => m.id && m.utilizavelNoWorkflow && (m.oferta === 'free-endpoint' || m.oferta === 'ambos'))
    .map((m) => ({ id: m.id!, nome: m.nome, categoria: m.areas[0] === 'conversa' ? 'Conversa e raciocínio' : 'Programação e agentes',
      descricao: m.uso }));
}

export function modeloNvidiaServeComoAgente(id: string): boolean {
  const conhecido = modeloConhecido(id);
  return !!conhecido && conhecido[4] === 'chat-completions' && conhecido[6] === true;
}
