import { FormEvent, useState } from 'react';
import { api } from '../../api';
import { Card, Empty, ErrorBox, Json, When } from '../../components';
import { useAction, useApi } from '../../hooks';

const KIND_HELP: Record<string, string> = {
  COMMAND: '{"command": "python3 -m pytest -q"}',
  FILE_EXISTS: '{"path": "src/estudo.py"}',
  ARTIFACT_PRESENT: '{"name": "relatorio.md"}',
  METRIC_THRESHOLD: '{"artifact": "metrics.json", "path": "n_dias_total", "op": ">=", "value": 200}',
};

/** Orçamento do projeto e critérios permanentes (aplicados a todo job novo). */
export function Configuracoes({ project, reloadProject }: { project: any; reloadProject: () => void }) {
  const { data: invariants, reload } = useApi<any[]>(`/projects/${project.id}/invariants`);
  const act = useAction();
  const [budget, setBudget] = useState(project.maxCostUsd !== null && project.maxCostUsd !== undefined ? String(Number(project.maxCostUsd)) : '');
  const [form, setForm] = useState({ key: '', description: '', kind: 'COMMAND', config: KIND_HELP.COMMAND });
  const gasto = Number(project.custoGastoUsd ?? 0);
  const limite = project.maxCostUsd !== null && project.maxCostUsd !== undefined ? Number(project.maxCostUsd) : null;

  const saveBudget = (e: FormEvent) => {
    e.preventDefault();
    act.run(async () => {
      await api(`/projects/${project.id}/budget`, 'PATCH', { maxCostUsd: budget === '' ? null : Number(budget) });
      reloadProject();
    });
  };
  const addInvariant = (e: FormEvent) => {
    e.preventDefault();
    act.run(async () => {
      await api(`/projects/${project.id}/invariants`, 'POST', { ...form, config: JSON.parse(form.config || '{}') });
      setForm({ key: '', description: '', kind: 'COMMAND', config: KIND_HELP.COMMAND });
      reload();
    });
  };
  const toggle = (inv: any) =>
    act.run(async () => {
      await api(`/projects/${project.id}/invariants/${inv.id}`, 'PATCH', { active: !inv.active });
      reload();
    });

  return (
    <>
      <ErrorBox error={act.error} />
      <Card title="Orçamento de custo do projeto">
        <p>
          Gasto até agora (soma de todos os jobs): <b>US$ {gasto.toFixed(4)}</b>
          {limite !== null ? <> de <b>US$ {limite.toFixed(2)}</b></> : <span className="muted"> — sem limite definido</span>}
        </p>
        {limite !== null && gasto >= limite && <div className="warn">Orçamento atingido: novas execuções deste projeto ficam bloqueadas (LIMITE_ORCAMENTO_PROJETO).</div>}
        <form className="row" onSubmit={saveBudget}>
          <label>Limite total (US$; vazio = sem limite)<input type="number" step="0.01" min="0" value={budget} onChange={(e) => setBudget(e.target.value)} /></label>
          <button disabled={act.busy}>Salvar orçamento</button>
        </form>
        <p className="small muted">Cada job também tem seu próprio limite de custo. O custo é contado quando o conector o informa (Claude Code informa por sessão).</p>
      </Card>

      <Card title="Critérios permanentes do projeto">
        <p className="small muted">Entram automaticamente em todo job novo deste projeto e não podem ser removidos dele. Desativar vale apenas para os próximos jobs.</p>
        {invariants && invariants.length === 0 && <Empty>Nenhum critério permanente.</Empty>}
        {invariants && invariants.length > 0 && (
          <table>
            <thead><tr><th>Critério</th><th>Tipo</th><th>Configuração</th><th>Situação</th><th></th></tr></thead>
            <tbody>
              {invariants.map((inv) => (
                <tr key={inv.id}>
                  <td><b>{inv.key}</b><div className="small">{inv.description}</div><div className="small muted">{inv.author} · <When date={inv.createdAt} /></div></td>
                  <td><span className="tag">{inv.kind}</span></td>
                  <td><Json value={inv.config} /></td>
                  <td><span className={`tag ${inv.active ? 'ok' : ''}`}>{inv.active ? 'ativo' : 'desativado'}</span></td>
                  <td><button className={inv.active ? 'danger' : ''} onClick={() => toggle(inv)} disabled={act.busy}>{inv.active ? 'Desativar' : 'Ativar'}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <form className="form" onSubmit={addInvariant}>
          <div className="grid3">
            <label>Chave<input value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} required placeholder="dados-intactos" /></label>
            <label>Tipo
              <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value, config: KIND_HELP[e.target.value] })}>
                {Object.keys(KIND_HELP).map((k) => <option key={k}>{k}</option>)}
              </select>
            </label>
            <label>Descrição<input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} required /></label>
          </div>
          <label>Configuração (JSON)<input value={form.config} onChange={(e) => setForm({ ...form, config: e.target.value })} /></label>
          <button disabled={act.busy}>Adicionar critério permanente</button>
        </form>
      </Card>
    </>
  );
}
