/** Orçamento de contexto: obrigatórias sempre entram; memória por prioridade; omissões declaradas. */
import { assembleContext, fullMemoryDocument, MemoryItem, sortMemory } from '../../src/worker/context-builder';

const mem = (id: string, category: string, content: string, ageMin: number, refs: any = {}): MemoryItem => ({
  id, category, title: id, content, author: 'x', createdAt: new Date(Date.now() - ageMin * 60000), references: refs,
});

describe('Orçamento de contexto', () => {
  const items = [
    mem('pend-antiga', 'PENDENCIA', 'p'.repeat(300), 50),
    mem('pend-nova', 'PENDENCIA', 'p'.repeat(300), 1),
    mem('licao', 'PENDENCIA', 'não repita X', 5, { origem: 'licao-automatica' }),
    mem('decisao', 'DECISAO_APROVADA', 'janela 20', 100),
    mem('evid', 'EVIDENCIA', 'e'.repeat(300), 2),
  ];

  it('ordena: decisão > lição > evidência > pendência (recente antes)', () => {
    expect(sortMemory(items).map((m) => m.id)).toEqual(['decisao', 'licao', 'evid', 'pend-nova', 'pend-antiga']);
  });

  it('seções obrigatórias sempre entram, mesmo acima do orçamento; memória de menor prioridade é omitida e declarada', () => {
    const obrigatoria = { key: 'objetivo', text: 'OBJETIVO ' + 'o'.repeat(500), required: true };
    const r = assembleContext([obrigatoria], items, ['- out/a.csv'], 1200);
    expect(r.text).toContain(obrigatoria.text);
    expect(r.text).toContain('[DECISAO_APROVADA] decisao');
    expect(r.text).toContain('[LIÇÃO] licao');
    expect(r.stats.memoryOmitted).toBeGreaterThan(0);
    expect(r.stats.omittedMemoryIds).toContain('pend-antiga');
    expect(r.text).toMatch(/omitidas deste prompt.*\.nivoo\/memoria\.md/);
    const tiny = assembleContext([obrigatoria], items, [], 10);
    expect(tiny.text).toContain(obrigatoria.text);
    expect(tiny.stats.overBudget).toBe(true);
    expect(tiny.stats.memoryIncluded).toBe(0);
  });

  it('documento completo contém tudo, sem truncar', () => {
    const doc = fullMemoryDocument(items, ['- out/a.csv']);
    for (const m of items) expect(doc).toContain(m.content);
  });
});
