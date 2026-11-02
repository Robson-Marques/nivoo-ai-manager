import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, artifactUrl, eventsUrl } from '../api';
import { Card, Empty, ErrorBox, Json, short, Status, When } from '../components';
import { useAction, useApi } from '../hooks';
import { ApprovalRow } from './Painel';

const ATTEMPT_LABEL: Record<string, string> = {
  EXECUTANDO: 'executando',
  SUCESSO: 'sucesso',
  FALHA: 'falha',
  INTERROMPIDA: 'interrompida',
  RECURSO_INDISPONIVEL: 'recurso indisponível',
  SESSAO_ENCERRADA: 'sessão encerrada',
};

interface LogRow { id: string; level: string; source: string; message: string; createdAt: string; stepId?: string }

export function JobDetalhe() {
  const { pid, jid } = useParams();
  const { data: job, error, reload } = useApi<any>(`/projects/${pid}/jobs/${jid}`);
  const { data: report, reload: reloadReport } = useApi<any>(`/projects/${pid}/jobs/${jid}/report`);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [live, setLive] = useState<'conectando' | 'ao vivo' | 'desconectado'>('conectando');
  const [follow, setFollow] = useState(true);
  const act = useAction();
  const logBox = useRef<HTMLDivElement>(null);

  // Tempo real via SSE; ao mudar o estado, recarrega o detalhe.
  useEffect(() => {
    const es = new EventSource(eventsUrl(pid!, jid!));
    es.onopen = () => setLive('ao vivo');
    es.onerror = () => setLive('desconectado');
    es.addEventListener('logs', (ev) => {
      const rows = JSON.parse((ev as MessageEvent).data) as LogRow[];
      // Nunca duplica: após uma reconexão, só entram logs com id maior que o último exibido.
      setLogs((prev) => {
        const last = prev.length ? BigInt(prev[prev.length - 1].id) : -1n;
        return [...prev, ...rows.filter((r) => BigInt(r.id) > last)].slice(-3000);
      });
    });
    es.addEventListener('state', () => {
      reload();
      reloadReport();
    });
    return () => es.close();
  }, [pid, jid, reload, reloadReport]);

  useEffect(() => {
    if (follow && logBox.current) logBox.current.scrollTop = logBox.current.scrollHeight;
  }, [logs, follow]);

  if (error) return <ErrorBox error={error} />;
  if (!job) return <p className="muted">Carregando…</p>;

  const post = (path: string, body?: any) =>
    act.run(async () => {
      await api(`/projects/${pid}/jobs/${jid}/${path}`, 'POST', body ?? {});
      reload();
      reloadReport();
    });
  const newObjective = () => {
    const text = window.prompt('Novo texto do objetivo (a versão anterior é preservada):', job.objectives[job.objectives.length - 1].text);
    if (!text) return;
    const reason = window.prompt('Motivo da alteração:');
    if (!reason) return;
    post('objective', { text, reason });
  };
  const current = job.objectives[job.objectives.length - 1];
  const stepKey = (id?: string) => job.steps.find((s: any) => s.id === id)?.key ?? '';

  return (
    <>
      <p className="crumbs"><Link to="/execucao">Execução</Link> / <Link to={`/projetos/${pid}`}>{job.project.name}</Link> / {job.title}</p>
      <div className="title-row">
        <h1>{job.title}</h1>
        <Status value={job.status} />
        <span className={`live ${live === 'ao vivo' ? 'on' : ''}`}>● {live}</span>
      </div>
      {job.blockedReason && <div className="warn"><b>{job.blockedReason}</b>{job.statusDetail ? ` — ${job.statusDetail}` : ''}</div>}
      <ErrorBox error={act.error} />
      <div className="row">
        {job.status === 'PENDENTE' && <button onClick={() => post('start')} disabled={act.busy}>Iniciar</button>}
        {['EXECUTANDO', 'AGUARDANDO_RECURSO', 'AGUARDANDO_APROVACAO', 'PENDENTE'].includes(job.status) && (
          <button className="danger" onClick={() => post('interrupt', { by: 'interface' })} disabled={act.busy}>Interromper</button>
        )}
        {['BLOQUEADO', 'FALHOU', 'AGUARDANDO_RECURSO'].includes(job.status) && (
          <button onClick={() => post('resume', { by: 'interface' })} disabled={act.busy}>Retomar</button>
        )}
        {['BLOQUEADO', 'AGUARDANDO_APROVACAO'].includes(job.status) && job.steps.every((s: any) => s.status === 'CONCLUIDO') && (
          <button className="secondary" onClick={() => post('evaluate')} disabled={act.busy}>Reverificar critérios</button>
        )}
        {job.status !== 'CONCLUIDO' && <button className="secondary" onClick={newObjective} disabled={act.busy}>Nova versão do objetivo</button>}
      </div>

      {report && !report.concluido && (
        <Card title="Estado real: o que falta">
          {report.semCriterios && <div className="warn">Job sem critérios de aceitação — não pode ser concluído.</div>}
          <div className="grid3">
            <div><h4>Etapas pendentes</h4>{report.etapasPendentes.length ? <ul>{report.etapasPendentes.map((s: any) => <li key={s.key}>{s.key} — <Status value={s.status} /> <span className="small muted">{s.detalhe}</span></li>)}</ul> : <Empty>nenhuma</Empty>}</div>
            <div><h4>Critérios pendentes</h4>{report.criteriosPendentes.length ? <ul>{report.criteriosPendentes.map((c: any) => <li key={c.key}>{c.key} ({c.status.toLowerCase()}) — {c.descricao}</li>)}</ul> : <Empty>nenhum</Empty>}</div>
            <div><h4>Aprovações pendentes</h4>{report.aprovacoesPendentes.length ? <ul>{report.aprovacoesPendentes.map((a: any) => <li key={a.id}>{a.descricao}</li>)}</ul> : <Empty>nenhuma</Empty>}</div>
          </div>
        </Card>
      )}

      <div className="grid2">
        <Card title={`Objetivo v${current.version}`}>
          <div className="pre">{current.text}</div>
          <p className="small muted">sha256 {short(current.sha256, 16)} · {current.author} · <When date={current.createdAt} /></p>
          {job.objectives.length > 1 && (
            <details>
              <summary className="small">Versões anteriores ({job.objectives.length - 1})</summary>
              {job.objectives.slice(0, -1).map((o: any) => (
                <div key={o.id} className="mem"><b>v{o.version}</b> <span className="small muted">{o.reason}</span><div className="pre small">{o.text}</div></div>
              ))}
            </details>
          )}
        </Card>
        <Card title="Orçamento e limites">
          <dl className="dl">
            <dt>Conector padrão</dt><dd>{job.defaultProvider}</dd>
            <dt>Custo</dt><dd>US$ {Number(job.costSpentUsd).toFixed(4)} / {Number(job.maxCostUsd).toFixed(2)}</dd>
            <dt>Tempo ativo</dt><dd>{job.activeSeconds}s / {job.maxDurationSec}s</dd>
            <dt>Tentativas por etapa</dt><dd>máx. {job.maxAttemptsPerStep} · repetição após {job.repetitionWindow} iguais</dd>
            <dt>Branch</dt><dd><code>{job.gitBranch}</code></dd>
          </dl>
        </Card>
      </div>

      <Card title="Etapas">
        <table>
          <thead><tr><th>Etapa</th><th>Depende de</th><th>Conector</th><th>Estado</th><th>Tentativas</th><th>Detalhe</th></tr></thead>
          <tbody>
            {job.steps.map((s: any) => (
              <tr key={s.id}>
                <td><b>{s.key}</b>{s.requiresApproval && <span className="tag">requer aprovação</span>}<div className="small muted">{s.title}</div></td>
                <td className="small">{s.dependsOn.join(', ') || '—'}</td>
                <td className="small">{s.provider ?? job.defaultProvider}</td>
                <td><Status value={s.status} /></td>
                <td>{s.attemptCount}</td>
                <td className="small trunc">{s.statusDetail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card title="Critérios de aceitação">
        {job.criteria.length === 0 ? <div className="warn">Nenhum critério — conclusão bloqueada.</div> : (
          <table>
            <tbody>
              {job.criteria.map((c: any) => (
                <tr key={c.id}>
                  <td><b>{c.key}</b> <span className="tag">{c.kind}</span><div className="small">{c.description}</div></td>
                  <td><span className={`tag c-${c.status}`}>{c.status.replace('_', ' ').toLowerCase()}</span></td>
                  <td>{c.checks[0] ? <details><summary className="small">evidência <When date={c.checks[0].createdAt} /></summary><Json value={c.checks[0].evidence} /></details> : <span className="muted small">não verificado</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {job.approvals.some((a: any) => a.status === 'PENDENTE') && (
        <Card title="Aprovações pendentes">
          <table><tbody>{job.approvals.filter((a: any) => a.status === 'PENDENTE').map((a: any) => <ApprovalRow key={a.id} a={a} onDone={() => { reload(); reloadReport(); }} />)}</tbody></table>
        </Card>
      )}

      <Card title="Logs em tempo real" actions={<label className="check small"><input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> seguir</label>}>
        <div className="logs" ref={logBox}>
          {logs.length === 0 && <span className="muted">sem logs</span>}
          {logs.map((l) => (
            <div key={l.id} className={`log l-${l.level}`}>
              <span className="t">{new Date(l.createdAt).toLocaleTimeString('pt-BR')}</span>
              <span className="src">{l.source}{l.stepId ? `/${stepKey(l.stepId)}` : ''}</span>
              <span className="msg">{l.message}</span>
            </div>
          ))}
        </div>
      </Card>

      <Card title="Sessões e tentativas">
        <p className="small muted">Cada linha de IA é uma sessão real do provedor. "Sessão encerrada" = o agente parou sem a verificação da etapa passar; o sistema abre outra sessão sozinho.</p>
        {job.attempts.length === 0 ? <Empty>nenhuma</Empty> : (
          <div className="scroll">
            <table>
              <thead><tr><th>Etapa</th><th>#</th><th>Conector / worker</th><th>Sessão</th><th>Término</th><th>Contexto</th><th>Custo</th><th>Resultado</th></tr></thead>
              <tbody>
                {job.attempts.map((a: any) => {
                  const ctx = a.contextStats;
                  const prompt = a.promptArtifactId ? job.artifacts.find((x: any) => x.id === a.promptArtifactId) : null;
                  return (
                    <tr key={a.id}>
                      <td>{stepKey(a.stepId)}</td>
                      <td>{a.number}</td>
                      <td className="small">{a.provider}<div className="muted">{a.workerId}</div></td>
                      <td className="small"><code title={a.sessionId ?? ''}>{short(a.sessionId, 8)}</code>{prompt && <div><a href={artifactUrl(pid!, prompt.id)} target="_blank" rel="noreferrer">prompt</a></div>}</td>
                      <td className="small">{a.stopReason ?? '—'}{a.numTurns ? <div className="muted">{a.numTurns} turnos</div> : null}</td>
                      <td className="small">
                        {ctx ? <>{Math.round(ctx.totalChars / 1000)}k/{Math.round(ctx.budgetChars / 1000)}k{ctx.memoryOmitted ? <div className="muted">{ctx.memoryOmitted} memórias omitidas</div> : null}</> : '—'}
                      </td>
                      <td className="small">{Number(a.costUsd) ? `US$ ${Number(a.costUsd).toFixed(3)}` : '—'}</td>
                      <td>
                        <span className={`tag a-${a.status}`}>{ATTEMPT_LABEL[a.status] ?? a.status}</span>
                        {a.notesIngested ? <div className="small muted">{a.notesIngested} nota(s) do agente</div> : null}
                        {a.error && <div className="small muted trunc" title={a.error}>{a.error}</div>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid2">
        <Card title="Checkpoints">
          {job.checkpoints.length === 0 ? <Empty>nenhum</Empty> : (
            <table>
              <tbody>
                {job.checkpoints.map((c: any) => (
                  <tr key={c.id}><td>#{c.seq}</td><td>{c.label}</td><td><code>{short(c.gitCommit, 10)}</code></td><td><When date={c.createdAt} /></td></tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      <Card title="Artefatos e evidências">
        {job.artifacts.length === 0 ? <Empty>nenhum</Empty> : (
          <table>
            <thead><tr><th>Nome</th><th>Tipo</th><th>Tamanho</th><th>sha256</th><th>Criado</th></tr></thead>
            <tbody>
              {job.artifacts.map((a: any) => (
                <tr key={a.id}>
                  <td><a href={artifactUrl(pid!, a.id)} target="_blank" rel="noreferrer">{a.name}</a></td>
                  <td><span className="tag">{a.kind}</span></td>
                  <td className="small">{a.sizeBytes} B</td>
                  <td><code>{short(a.sha256, 12)}</code></td>
                  <td><When date={a.createdAt} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {job.experiment && (
        <Card title={`Experimento: ${job.experiment.name}`}>
          <dl className="dl">
            <dt>Estado</dt><dd><Status value={job.experiment.status} /></dd>
            <dt>Commit</dt><dd><code>{job.experiment.codeRef ?? '—'}</code></dd>
          </dl>
          <div className="grid2"><div><h4>Parâmetros</h4><Json value={job.experiment.parameters} /></div><div><h4>Métricas</h4><Json value={job.experiment.metrics} /></div></div>
        </Card>
      )}
    </>
  );
}
