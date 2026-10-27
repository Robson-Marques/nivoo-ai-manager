import { FormEvent, useState } from 'react';
import { api } from '../../api';
import { Card, Empty, ErrorBox, Json, short } from '../../components';
import { useAction } from '../../hooks';

export function Datasets({ project, reloadProject }: { project: any; reloadProject: () => void }) {
  const act = useAction();
  const [form, setForm] = useState({ name: '', assetCode: 'WIN', uri: '', timeframe: '1min', role: 'TREINO', periodStart: '', periodEnd: '' });
  const [report, setReport] = useState<any>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    act.run(async () => {
      await api(`/projects/${project.id}/datasets`, 'POST', { ...form, periodStart: form.periodStart || undefined, periodEnd: form.periodEnd || undefined });
      setForm({ ...form, name: '', uri: '' });
      reloadProject();
    });
  };
  const validate = (d: any) => act.run(async () => setReport(await api(`/projects/${project.id}/datasets/${d.id}/validate`, 'POST')));
  const release = (d: any) =>
    act.run(async () => {
      const reason = window.prompt('Motivo para liberar o conjunto reservado:');
      if (!reason) return;
      await api(`/projects/${project.id}/datasets/${d.id}/request-release`, 'POST', { reason });
      window.alert('Solicitação criada. Aprove no Painel Mercado.');
    });

  return (
    <>
      <Card title="Conjuntos de dados">
        <p className="small muted">Arquivos ficam em <code>{project.workspacePath}/data</code>. Conjuntos RESERVADOS só podem ser usados após liberação aprovada.</p>
        <ErrorBox error={act.error} />
        {project.datasets.length === 0 ? <Empty>Nenhum dataset.</Empty> : (
          <table>
            <thead><tr><th>Nome</th><th>Ativo</th><th>Arquivo</th><th>Papel</th><th>sha256</th><th></th></tr></thead>
            <tbody>
              {project.datasets.map((d: any) => (
                <tr key={d.id}>
                  <td>{d.name}<div className="small muted">{d.timeframe}</div></td>
                  <td><span className="tag">{d.asset.code}</span></td>
                  <td><code>{d.uri}</code></td>
                  <td>{d.role}{d.role === 'RESERVADO' && <span className={`tag ${d.released ? 'ok' : ''}`}>{d.released ? 'liberado' : 'bloqueado'}</span>}</td>
                  <td><code>{short(d.sha256, 12)}</code></td>
                  <td className="nowrap">
                    <button className="secondary" onClick={() => validate(d)} disabled={act.busy}>Validar ({d.asset.code})</button>{' '}
                    {d.role === 'RESERVADO' && !d.released && <button className="secondary" onClick={() => release(d)}>Solicitar liberação</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {report && (
        <Card title={`Validação ${report.asset}: ${report.valid ? 'válido' : `${report.errorCount} problema(s)`}`} actions={<button className="link" onClick={() => setReport(null)}>fechar</button>}>
          <Json value={report} />
        </Card>
      )}
      <Card title="Registrar dataset">
        <form className="form" onSubmit={submit}>
          <div className="grid3">
            <label>Nome<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></label>
            <label>Ativo<select value={form.assetCode} onChange={(e) => setForm({ ...form, assetCode: e.target.value })}><option>WIN</option><option>WDO</option></select></label>
            <label>Arquivo (relativo a data/)<input value={form.uri} onChange={(e) => setForm({ ...form, uri: e.target.value })} required placeholder="win_1min_2025.csv" /></label>
            <label>Timeframe<input value={form.timeframe} onChange={(e) => setForm({ ...form, timeframe: e.target.value })} /></label>
            <label>Papel<select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}><option>TREINO</option><option>VALIDACAO</option><option>RESERVADO</option></select></label>
            <div className="grid2">
              <label>Início<input type="date" value={form.periodStart} onChange={(e) => setForm({ ...form, periodStart: e.target.value })} /></label>
              <label>Fim<input type="date" value={form.periodEnd} onChange={(e) => setForm({ ...form, periodEnd: e.target.value })} /></label>
            </div>
          </div>
          <button disabled={act.busy}>Registrar</button>
        </form>
      </Card>
    </>
  );
}
