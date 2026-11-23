import { diagnosticoRenderDeterministico, falhaLocalCorrigivel } from '../../src/worker/deterministic-media-errors';
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

describe('Reparo de script no MESMO trabalho, sem encerrar na primeira falha', () => {
  it('código JavaScript com sintaxe inválida deve voltar para a IA', () => {
    expect(falhaLocalCorrigivel('Comando local falhou: SyntaxError: Unexpected token in script.cjs')).toBe(true);
    expect(falhaLocalCorrigivel('Error: Cannot find module ./src/main.js')).toBe(true);
    expect(falhaLocalCorrigivel('src/main.ts:42:19: error TS2304')).toBe(true);
  });
  it('erro determinístico de script de vídeo pode ser corrigido pela IA', () => {
    expect(falhaLocalCorrigivel("[Parsed_select_0] Error while parsing expression 'eq(n,0)+eq(n,1)'")).toBe(true);
    expect(falhaLocalCorrigivel('cp: cannot stat contexto/resultados/x.mp3: No such file')).toBe(true);
  });
  it('não delega à IA problemas de infraestrutura física ou credenciais', () => {
    expect(falhaLocalCorrigivel('bash: video-tool: command not found')).toBe(false);
    expect(falhaLocalCorrigivel('permission denied ao executar script.cjs')).toBe(false);
    expect(falhaLocalCorrigivel('credencial ausente para API')).toBe(false);
    expect(falhaLocalCorrigivel('rede temporariamente indisponível')).toBe(false);
  });
});
