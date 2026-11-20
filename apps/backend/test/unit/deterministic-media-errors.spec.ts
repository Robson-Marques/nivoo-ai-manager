import { diagnosticoRenderDeterministico } from '../../src/worker/deterministic-media-errors';
describe('Falhas determinísticas de montagem', () => {
  it('interrompe o filtro FFmpeg gigante na primeira falha', () => {
    expect(diagnosticoRenderDeterministico("[Parsed_select_0] Error while parsing expression 'eq(n,0)+eq(n,1)'\n[AVFilterGraph] Error initializing filters")).toContain('nivoo-extrair-quadros');
  });
  it('distingue ausência de subcomando e arquivo', () => {
    expect(diagnosticoRenderDeterministico('error: the following arguments are required: mode')).toContain('quadros');
    expect(diagnosticoRenderDeterministico("cp: não foi possível obter estado de 'contexto/resultados/x.py'")).toContain('caminho');
  });
  it('não interfere com falhas de outro tipo', () => {
    expect(diagnosticoRenderDeterministico('falha temporária de rede')).toBeNull();
  });
});
