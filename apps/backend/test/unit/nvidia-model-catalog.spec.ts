import {
  catalogarNvidiaModelos,
  modeloNvidiaServeComoAgente,
  modelosNvidiaParaWorkflow,
  NVIDIA_AREAS,
} from '../../src/providers/nvidia-model-catalog';

describe('Catálogo NVIDIA: 94 modelos por finalidade real', () => {
  const catalogo = catalogarNvidiaModelos();
  const porNome = (nome: string) => {
    const m = catalogo.find(m => m.nome === nome);
    if (!m) throw new Error('Modelo de referência não encontrado: ' + nome);
    return m;
  };

  it('classifica os 94 modelos da página pública de 22/11/2026', () => {
    expect(catalogo).toHaveLength(94);
    expect(new Set(catalogo.map(m => m.nome))).toHaveProperty('size', 94);
    expect(catalogo.filter(m => ['ambos', 'free-endpoint'].includes(m.oferta))).toHaveLength(39);
    expect(catalogo.filter(m => ['ambos', 'download'].includes(m.oferta))).toHaveLength(72);
    expect(NVIDIA_AREAS.map(a => a.id)).toEqual(expect.arrayContaining([
      'agentes', 'conversa', 'visao', 'imagens', 'video', 'audio', 'documentos', 'busca', 'dados', 'ciencia', 'seguranca',
    ]));
  });

  it('o seletor de programação não oferece imagens, vídeo, embedding, OCR ou rerank', () => {
    const ids = modelosNvidiaParaWorkflow().map(x => x.id);
    expect(ids).toContain('nvidia/nemotron-3.5-bolt-e4b');
    expect(ids).toContain('moonshotai/kimi-k3.1-pro');
    for (const nome of [
      'FLUX 3 Image Klein', 'Wan 2.2 Animate', 'Video Super Resolution NIM',
      'Nemotron 3.5 Embed 1B', 'Nemotron 3.5 Rerank 8B',
      'Nemotron 3.5 Parse', 'Parakeet TDT 0.6B', 'Kumo Tabular',
    ]) expect(porNome(nome).utilizavelNoWorkflow).toBe(false);
  });

  it('um modelo capaz de interpretar vídeo não vira gerador de vídeo', () => {
    const m = porNome('Nemotron 3.5 Super VL');
    expect(m.areas).toContain('visao');
    expect(m.areas).toContain('agentes');
    expect(m.endpoint).toBe('chat-completions');
    expect(m.areas).not.toContain('video');
    expect(porNome('Cosmos3 Nano').endpoint).toBe('video');
    expect(porNome('Cosmos3 Nano').utilizavelNoWorkflow).toBe(false);
  });

  it('download isolado não vira Free Endpoint', () => {
    expect(porNome('Wan 2.2 Animate').oferta).toBe('download');
    expect(porNome('Video Super Resolution NIM').oferta).toBe('download');
    expect(porNome('FLUX 3 Image Klein').oferta).toBe('download');
    expect(porNome('3D Body Pose').oferta).toBe('ambos');
  });

  it('IDs live são associados às referências, sem duplicar ou inventar suporte ao Studio', () => {
    const modelos = catalogarNvidiaModelos([
      'nvidia/nemotron-3.5-bolt-e4b',
      'nvidia/nemotron-3.5-embed-8b',
      'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning',
    ]);
    expect(modelos.filter(m => m.listadoNaChave)).toHaveLength(3);
    expect(modelos).toHaveLength(94);
    expect(modelos.find(m => m.nome === 'Nemotron 3 Nano Omni 30B')?.listadoNaChave).toBe(true);
    expect(modelos.find(m => m.nome === 'Nemotron 3.5 Embed 8B')?.utilizavelNoWorkflow).toBe(false);
  });

  it('modelos desconhecidos não viram programadores, mesmo se o servidor os listar', () => {
    const modelos = catalogarNvidiaModelos([
      'nvidia/experimental-chat-300b',
      'nvidia/novo-embed-12b',
      'nvidia/novo-rerank-6b',
      'nvidia/novo-image-edit',
      'nvidia/novo-video-upscale',
    ]);
    expect(modelos).toHaveLength(99);
    expect(modelos.filter(m => m.fonte === 'api-models')).toHaveLength(5);
    expect(modelos.filter(m => m.fonte === 'api-models' && m.utilizavelNoWorkflow)).toHaveLength(0);
    expect(modelos.find(m => m.id === 'nvidia/novo-embed-12b')?.areas).toContain('busca');
    expect(modelos.find(m => m.id === 'nvidia/novo-video-upscale')?.areas).toContain('video');
  });

  it('não transfere capacidade ou disponibilidade para variantes de nome ou outro fornecedor',()=>{
    const variants=['other/nemotron-3.5-bolt-e4b','nvidia/nemotron-3.5-bolt-e4b-unknown','nemotron-3.5-bolt-e4b'];
    for(const id of variants)expect(modeloNvidiaServeComoAgente(id)).toBe(false);
    const live=catalogarNvidiaModelos(variants);
    expect(live.find(m=>m.id==='nvidia/nemotron-3.5-bolt-e4b')?.listadoNaChave).toBe(false);
    expect(live.filter(m=>m.listadoNaChave&&m.utilizavelNoWorkflow)).toHaveLength(0);
  });

  it('só habilita chat com tool calling comprovado como agente', () => {
    expect(modeloNvidiaServeComoAgente('nvidia/nemotron-3.5-bolt-e4b')).toBe(true);
    expect(modeloNvidiaServeComoAgente('nvidia/nemotron-3.5-super-vl-120b-a12b')).toBe(true);
    expect(modeloNvidiaServeComoAgente('moonshotai/kimi-k3.1-pro')).toBe(true);
    expect(modeloNvidiaServeComoAgente('nvidia/nemotron-3.5-rerank-8b')).toBe(false);
    expect(modeloNvidiaServeComoAgente('nvidia/experimental-chat-300b')).toBe(false);
    expect(modeloNvidiaServeComoAgente('nvidia/wan2.2-animate-2-14b')).toBe(false);
  });
});
