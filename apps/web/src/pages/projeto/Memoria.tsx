import { FormEvent, useState } from 'react';
import { api } from '../../api';
import { Card, Empty, ErrorBox, Json, When } from '../../components';
import { useAction, useApi } from '../../hooks';

const CATEGORIES: Array<[string, string]> = [
  ['ESPECIFICACAO', 'Especificação e objetivo original'],
  ['ARQUITETURA_RESTRICOES', 'Arquitetura e restrições'],
  ['DECISAO_APROVADA', 'Decisões aprovadas'],
  ['HIPOTESE_INVESTIGACAO', 'Hipóteses em investigação'],
  ['EVIDENCIA', 'Evidências produzidas'],
  ['HIPOTESE_REJEITADA', 'Hipóteses rejeitadas'],
  ['RESULTADO_VALIDADO', 'Resultados validados'],
  ['PENDENCIA', 'Pendências e próximos passos'],
];

export function Memoria({ project }: { project: any }) {
  const { data, reload } = useApi<any[]>(`/projects/${project.id}/memory`);
  const act = useAction();
  const [form, setForm] = useState({ category: 'DECISAO_APROVADA', title: '', content: '', author: '', references: '{}' });
  if (!data) return <p className="muted">Carregando memória…</p>;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    act.run(async () => {
      await api(`/projects/${project.id}/memory`, 'POST', { ...form, references: JSON.parse(form.references || '{}') });
      setForm({ ...form, title: '', content: '', references: '{}' });
      reload();
    });
  };

  return (
    <>
      {CATEGORIES.map(([cat, label]) => {
        const items = data.filter((m) => m.category === cat);
        return (
          <Card key={cat} title={<>{label} <span className="muted">({items.length})</span></>}>
            {items.length === 0 ? <Empty>—</Empty> : items.map((m) => (
              <div key={m.id} className="mem">
                {m.references?.origem === 'licao-automatica' && <span className="tag bad">lição automática</span>}
                {m.references?.origem === 'notas-do-agente' && <span className="tag">nota do agente</span>}
                <b>{m.title}</b> <span className="small muted">v{m.version} · {m.author} · <When date={m.createdAt} /></span>
                <div className="pre">{m.content}</div>
                {Object.keys(m.references ?? {}).length > 0 && <details><summary className="small">referências reproduzíveis</summary><Json value={m.references} /></details>}
              </div>
            ))}
          </Card>
        );
      })}
      <Card title="Registrar na memória">
        <form className="form" onSubmit={submit}>
          <div className="grid3">
            <label>Categoria<select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>{CATEGORIES.map(([c, l]) => <option key={c} value={c}>{l}</option>)}</select></label>
            <label>Título<input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required /></label>
            <label>Autor<input value={form.author} onChange={(e) => setForm({ ...form, author: e.target.value })} /></label>
          </div>
          <label>Conteúdo<textarea rows={3} value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} required /></label>
          <label>Referências (JSON: artifactIds, experimentIds, datasetIds, gitCommit, parameters) — obrigatórias para evidências e resultados validados
            <input value={form.references} onChange={(e) => setForm({ ...form, references: e.target.value })} />
          </label>
          <ErrorBox error={act.error} />
          <button disabled={act.busy}>Registrar</button>
        </form>
      </Card>
    </>
  );
}
