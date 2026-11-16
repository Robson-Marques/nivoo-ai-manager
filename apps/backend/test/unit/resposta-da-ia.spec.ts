import { extractJson, salvarTextoDaResposta } from '../../src/worker/planner.service';

const cerca = '```';

describe('leitura da resposta da IA (JSON final)', () => {
  it('bloco de código DENTRO do texto (ex.: comandos do servidor) não corta o JSON', () => {
    const texto = 'Pronto.\n\nComandos:\n' + cerca + 'bash\npm2 restart all\n' + cerca + '\nFim.';
    const r = extractJson(`Entrega:\n${cerca}json\n${JSON.stringify({ tipo: 'resposta', texto, memoria: [] })}\n${cerca}`);
    expect(r).toMatchObject({ tipo: 'resposta', texto });
  });
  it('quebra de linha solta dentro do texto e vírgula sobrando são consertadas', () => {
    const r = extractJson(`${cerca}json\n{"tipo":"resposta","texto":"linha 1\nlinha 2\tcom tab","memoria":[],}\n${cerca}`);
    expect(r).toMatchObject({ tipo: 'resposta', texto: 'linha 1\nlinha 2\tcom tab' });
  });
  it('exemplo de JSON no meio do texto: vale o ÚLTIMO bloco (o final)', () => {
    const r = extractJson(`Criei:\n${cerca}json\n{"tipo":"servidor","pasta":"apps/web"}\n${cerca}\nResumo.\n${cerca}json\n{"tipo":"resposta","texto":"ok","memoria":[]}\n${cerca}`);
    expect(r.texto).toBe('ok');
  });
  it('JSON final sem a cerca e JSON puro', () => {
    expect(extractJson('blá {"tipo":"resposta","texto":"a { b } c","memoria":[]} fim')).toMatchObject({ texto: 'a { b } c' });
    expect(extractJson('{"tipo":"plano","texto":"x","job":{"title":"t"}}')).toMatchObject({ tipo: 'plano', job: { title: 't' } });
  });
  it('sem conserto: recupera ao menos o texto da resposta', () => {
    const quebrado = `${cerca}json\n{"tipo":"resposta","texto":"Entreguei a v0.17.39.\nTestes passaram.","memoria":[{"tipo":"FATO",}\n`;
    expect(extractJson(quebrado)).toBeNull();
    expect(salvarTextoDaResposta(quebrado)).toBe('Entreguei a v0.17.39.\nTestes passaram.');
  });
});
