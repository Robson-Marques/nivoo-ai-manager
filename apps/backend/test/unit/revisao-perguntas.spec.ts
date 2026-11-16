/**
 * Perguntas da revisão: o arquivo de perguntas da IA dizendo que não há pergunta não vira "Perguntas para você"
 * (caso real do ConnectChat: "# Perguntas em aberto / Nenhuma pergunta em aberto nesta etapa…").
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { lerRevisao, semPergunta } from '../../src/jobs/rule-review';

const pasta = (perguntasMd: string | null, revisao: Record<string, unknown>) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'revisao-'));
  fs.mkdirSync(path.join(d, 'out'));
  fs.writeFileSync(path.join(d, 'out', 'conferencia-regras.json'), JSON.stringify(revisao));
  if (perguntasMd !== null) fs.writeFileSync(path.join(d, 'out', 'perguntas-ao-usuario.md'), perguntasMd);
  return d;
};

describe('perguntas da revisão', () => {
  it('"Nenhuma pergunta em aberto" não é pergunta', () => {
    const md = [
      '# Perguntas em aberto',
      '',
      'Nenhuma pergunta em aberto nesta etapa. O encaminhamento operacional foi respondido: conferências automáticas do sistema.',
      '',
      'A repetição da conferência após os ajustes é uma pendência de validação automática, sem nova decisão do usuário.',
    ].join('\n');
    const r = lerRevisao(pasta(md, { conforme: false, violacoes: ['A16 — falta regressão'], perguntas: ['Sem perguntas para o usuário.'] }));
    expect(r?.perguntas).toEqual([]);
    expect(r?.violacoes).toEqual(['A16 — falta regressão']);
  });

  it('pergunta de verdade continua (sem o título do arquivo)', () => {
    const r = lerRevisao(pasta('# Perguntas\n\n1. Qual é a cor da marca? (opções: azul, verde)', { conforme: true, violacoes: [], perguntas: [{ pergunta: 'Publicar hoje?', opcoes: ['Sim', 'Não'] }] }));
    expect(r?.perguntas.map((p) => p.pergunta)).toEqual(['Publicar hoje?', '1. Qual é a cor da marca? (opções: azul, verde)']);
  });

  it('semPergunta', () => {
    expect(semPergunta('Nenhuma pergunta em aberto.')).toBe(true);
    expect(semPergunta('Não há dúvidas pendentes')).toBe(true);
    expect(semPergunta('Nenhuma pergunta? Confirme a cor.')).toBe(false);
    expect(semPergunta('Definir o prazo de entrega com o cliente')).toBe(false);
  });
});
