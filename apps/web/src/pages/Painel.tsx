import { Link } from 'react-router-dom';
import { api } from '../api';
import { Card, Empty, ErrorBox, Status, STATUS_LABEL, When } from '../components';
import { useAction, useApi } from '../hooks';

export function ApprovalRow({ a, onDone }: { a: any; onDone: () => void }) {
  const act = useAction();
  const decide = (decision: string) =>
    act.run(async () => {
      const decidedBy = window.prompt('Seu nome (registrado na aprovação):');
      if (!decidedBy) return;
      const reason = window.prompt('Motivo (opcional):') ?? undefined;
      await api(`/approvals/${a.id}/decide`, 'POST', { decision, decidedBy, reason });
      onDone();
    });
  return (
    <tr>
      <td><span className="tag">{a.kind.replace(/_/g, ' ')}</span></td>
      <td>{a.description}{act.error && <div className="error">{act.error}</div>}</td>
      <td><When date={a.requestedAt} /></td>
      <td className="nowrap">
        <button disabled={act.busy} onClick={() => decide('APROVADO')}>Aprovar</button>{' '}
        <button className="danger" disabled={act.busy} onClick={() => decide('REJEITADO')}>Rejeitar</button>
      </td>
    </tr>
  );
}

export function Painel() {
  const { data, error, reload } = useApi<any>('/dashboard', 5000);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <p className="muted">Carregando…</p>;
  const running = (data.jobsByStatus.EXECUTANDO ?? 0) + (data.jobsByStatus.AGUARDANDO_RECURSO ?? 0);
  return (
    <>
      <h1>Painel Mercado</h1>
      <div className="kpis">
        <div className="kpi"><b>{data.projects}</b><span>projetos</span></div>
        <div className="kpi"><b>{running}</b><span>jobs ativos</span></div>
        <div className="kpi"><b>{data.pendingApprovals.length}</b><span>aprovações pendentes</span></div>
        <div className="kpi"><b>{data.validatedResults}</b><span>resultados validados</span></div>
        <div className="kpi"><b>{data.rejectedHypotheses}</b><span>hipóteses rejeitadas</span></div>
        <div className={`kpi ${data.workersOnline ? '' : 'kpi-warn'}`}><b>{data.workersOnline}</b><span>workers online</span></div>
      </div>
      {!data.workersOnline && (
        <div className="warn">Nenhum worker online: jobs ficam na fila até um worker iniciar (<code>npm run dev:worker</code>).</div>
      )}

      <div className="grid2">
        {data.assets.map((a: any) => (
          <Card key={a.code} title={<>{a.code} <span className="muted">· {a.name}</span></>}>
            <dl className="dl">
              <dt>Unidade</dt><dd>{a.priceUnit}</dd>
              <dt>Tick</dt><dd>{Number(a.tickSize)}</dd>
              <dt>Valor do ponto</dt><dd>R$ {Number(a.pointValue).toFixed(2)}</dd>
              <dt>Pregão</dt><dd>{a.sessionOpen}–{a.sessionClose} ({a.sessionTz})</dd>
              <dt>Faixa válida</dt><dd>{a.validation.minPrice} – {a.validation.maxPrice}</dd>
              <dt>Datasets / pesquisas</dt><dd>{a._count.datasets} / {a._count.researches}</dd>
            </dl>
          </Card>
        ))}
      </div>

      <Card title="Jobs por estado">
        <div className="chips">
          {Object.keys(STATUS_LABEL).map((s) => (
            <Link key={s} to={`/execucao?status=${s}`} className="chip"><Status value={s} /> <b>{data.jobsByStatus[s] ?? 0}</b></Link>
          ))}
        </div>
      </Card>

      <Card title="Aprovações pendentes">
        {data.pendingApprovals.length === 0 ? <Empty>Nenhuma aprovação pendente.</Empty> : (
          <table><tbody>{data.pendingApprovals.map((a: any) => <ApprovalRow key={a.id} a={a} onDone={reload} />)}</tbody></table>
        )}
      </Card>

      <div className="grid2">
        <Card title="Jobs recentes">
          {data.recentJobs.length === 0 ? <Empty>Nenhum job ainda.</Empty> : (
            <table>
              <tbody>
                {data.recentJobs.map((j: any) => (
                  <tr key={j.id}>
                    <td><Link to={`/execucao/${j.projectId}/${j.id}`}>{j.title}</Link><div className="muted small">{j.project.name}</div></td>
                    <td><Status value={j.status} /></td>
                    <td><When date={j.updatedAt} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card title="Pesquisas recentes">
          {data.researches.length === 0 ? <Empty>Nenhuma pesquisa ainda.</Empty> : (
            <table>
              <tbody>
                {data.researches.map((r: any) => (
                  <tr key={r.id}>
                    <td><Link to={`/projetos/${r.projectId}?pesquisa=${r.id}`}>{r.title}</Link><div className="muted small">{r.project.name}</div></td>
                    <td>{r.assets.map((x: any) => <span key={x.asset.code} className="tag">{x.asset.code}</span>)}</td>
                    <td className="small">{r._count.hypotheses} hip. · {r._count.experiments} exp.</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </>
  );
}
