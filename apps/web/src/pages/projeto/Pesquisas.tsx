import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, getToken } from '../../api';
import { Card, Empty, ErrorBox, Json, Status, short, When } from '../../components';
import { useAction, useApi } from '../../hooks';

function authHeaders(): Record<string, string> {
  const t = getToken();
  return t ? { authorization: `Bearer ${t}` } : {};
}

export function Pesquisas({ project, reloadProject, initial }: { project: any; reloadProject: () => void; initial: string | null }) {
  const act = useAction();
  const [title, setTitle] = useState('');
  const [question, setQuestion] = useState('');
  const [assets, setAssets] = useState<string[]>(['WIN']);
  const [selected, setSelected] = useState<string | null>(initial ?? project.researches[0]?.id ?? null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    act.run(async () => {
      const r = await api(`/projects/${project.id}/researches`, 'POST', { title, question, assetCodes: assets });
      setTitle('');
      setQuestion('');
      reloadProject();
      setSelected(r.id);
    });
  };

  return (
    <div className="grid-side">
      <div>
        <Card title="Pesquisas">
          {project.researches.length === 0 && <Empty>Nenhuma pesquisa.</Empty>}
          <ul className="list">
            {project.researches.map((r: any) => (
              <li key={r.id} className={r.id === selected ? 'sel' : ''} onClick={() => setSelected(r.id)}>
                <b>{r.title}</b>
                <div className="small muted">
                  {r.assets.map((a: any) => a.asset.code).join(', ')} · {r.status.replace('_', ' ').toLowerCase()} · {r._count.hypotheses} hip. · {r._count.experiments} exp.
                </div>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Nova pesquisa">
          <form onSubmit={submit} className="form">
            <label>Título<input value={title} onChange={(e) => setTitle(e.target.value)} required /></label>
            <label>Pergunta de pesquisa<textarea rows={3} value={question} onChange={(e) => setQuestion(e.target.value)} required /></label>
            <div className="row">
              {['WIN', 'WDO'].map((c) => (
                <label key={c} className="check">
                  <input type="checkbox" checked={assets.includes(c)} onChange={(e) => setAssets(e.target.checked ? [...assets, c] : assets.filter((x) => x !== c))} />
                  {c}
                </label>
              ))}
            </div>
            <ErrorBox error={act.error} />
            <button disabled={act.busy || assets.length === 0}>Criar pesquisa</button>
          </form>
        </Card>
      </div>
      <div>{selected ? <PesquisaDetalhe pid={project.id} rid={selected} onChange={reloadProject} /> : <Empty>Selecione uma pesquisa.</Empty>}</div>
    </div>
  );
}

function PesquisaDetalhe({ pid, rid, onChange }: { pid: string; rid: string; onChange: () => void }) {
  const { data: r, error, reload } = useApi<any>(`/projects/${pid}/researches/${rid}`);
  const { data: cmp, reload: reloadCmp } = useApi<any>(`/projects/${pid}/researches/${rid}/experiments/compare`);
  const act = useAction();
  const [statement, setStatement] = useState('');
  const [rationale, setRationale] = useState('');
  const [rule, setRule] = useState({ metric: '', op: '>=', value: '', datasetRole: 'VALIDACAO' });
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [pendencias, setPendencias] = useState<string[] | null>(null);
  if (error) return <ErrorBox error={error} />;
  if (!r) return <p className="muted">Carregando…</p>;

  const addHyp = (e: FormEvent) => {
    e.preventDefault();
    act.run(async () => {
      const decisionRule = rule.metric
        ? { metric: rule.metric, op: rule.op, value: Number(rule.value), ...(rule.datasetRole ? { datasetRole: rule.datasetRole } : {}) }
        : undefined;
      await api(`/projects/${pid}/researches/${rid}/hypotheses`, 'POST', { statement, rationale, decisionRule });
      setStatement('');
      setRationale('');
      setRule({ metric: '', op: '>=', value: '', datasetRole: 'VALIDACAO' });
      reload();
      onChange();
    });
  };
  const setHyp = (h: any, status: string) =>
    act.run(async () => {
      const conclusion = window.prompt(status === 'VALIDADA' ? 'Conclusão (com base nos experimentos verificados):' : 'Motivo da rejeição:');
      if (!conclusion) return;
      const experimentIds = r.experiments.filter((e: any) => e.hypothesisId === h.id).map((e: any) => e.id);
      await api(`/projects/${pid}/hypotheses/${h.id}`, 'PATCH', { status, conclusion, experimentIds });
      reload();
      reloadCmp();
      onChange();
    });

  // Experimentos que podem decidir uma hipótese: concluídos, desta hipótese ou sem vínculo.
  const elegiveis = (h: any) => r.experiments.filter((e: any) => e.status === 'CONCLUIDO' && (!e.hypothesisId || e.hypothesisId === h.id));
  const decidir = (h: any) =>
    act.run(async () => {
      const exps = elegiveis(h);
      const experimentId = chosen[h.id] ?? exps[0]?.id;
      if (!experimentId) return;
      await api(`/projects/${pid}/hypotheses/${h.id}/decide`, 'POST', { experimentId });
      reload();
      reloadCmp();
      onChange();
    });
  const encerrar = () =>
    act.run(async () => {
      setPendencias(null);
      const res = await fetch(`/api/projects/${pid}/researches/${rid}/close`, { method: 'POST', headers: authHeaders() });
      const body = await res.json();
      if (!res.ok) {
        setPendencias(body.pendencias ?? [body.message]);
        return;
      }
      reload();
      onChange();
    });

  return (
    <>
      <Card
        title={<>{r.title} <span className={`tag r-${r.status}`}>{r.status.replace('_', ' ').toLowerCase()}</span></>}
        actions={
          <>
            <Link to={`/projetos/${pid}?tab=jobs`}>+ job/experimento</Link>{' '}
            {r.status !== 'ENCERRADA' && <button className="secondary" onClick={encerrar} disabled={act.busy}>Encerrar pesquisa</button>}
          </>
        }
      >
        <p>{r.question}</p>
        <p className="small">Ativos: {r.assets.map((a: any) => <span key={a.asset.code} className="tag">{a.asset.code}</span>)}</p>
        {pendencias && (
          <div className="warn">
            <b>A pesquisa não pode ser encerrada enquanto houver pendências:</b>
            <ul>{pendencias.map((p) => <li key={p}>{p}</li>)}</ul>
          </div>
        )}
      </Card>
      <Card title="Hipóteses">
        <ErrorBox error={act.error} />
        {r.hypotheses.length === 0 && <Empty>Nenhuma hipótese registrada.</Empty>}
        <table>
          <tbody>
            {r.hypotheses.map((h: any) => (
              <tr key={h.id}>
                <td>
                  <b>{h.statement}</b>
                  {h.rationale && <div className="small muted">{h.rationale}</div>}
                  {h.decisionRule && (
                    <div className="small">
                      Regra pré-registrada: <code>{h.decisionRule.metric} {h.decisionRule.op} {h.decisionRule.value}</code>
                      {h.decisionRule.datasetRole && <> em dados {h.decisionRule.datasetRole}</>}
                      <span className="muted"> · registrada em <When date={h.decisionRuleSetAt} /></span>
                    </div>
                  )}
                  {h.conclusion && <div className="small">Conclusão: {h.conclusion}</div>}
                </td>
                <td><span className={`tag h-${h.status}`}>{h.status.replace('_', ' ').toLowerCase()}</span></td>
                <td className="nowrap">
                  {h.status === 'EM_INVESTIGACAO' && h.decisionRule && (
                    elegiveis(h).length === 0 ? (
                      <span className="small muted">aguardando experimento concluído</span>
                    ) : (
                      <>
                        {elegiveis(h).length > 1 && (
                          <select value={chosen[h.id] ?? elegiveis(h)[0].id} onChange={(e) => setChosen({ ...chosen, [h.id]: e.target.value })}>
                            {elegiveis(h).map((e: any) => <option key={e.id} value={e.id}>{e.name}</option>)}
                          </select>
                        )}{' '}
                        <button onClick={() => decidir(h)} disabled={act.busy}>Decidir pela regra</button>
                      </>
                    )
                  )}
                  {h.status === 'EM_INVESTIGACAO' && !h.decisionRule && (
                    <>
                      <button onClick={() => setHyp(h, 'VALIDADA')} disabled={act.busy}>Validar</button>{' '}
                      <button className="danger" onClick={() => setHyp(h, 'REJEITADA')} disabled={act.busy}>Rejeitar</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <form onSubmit={addHyp} className="form">
          <label>Nova hipótese<input value={statement} onChange={(e) => setStatement(e.target.value)} required /></label>
          <label>Fundamentação<textarea rows={2} value={rationale} onChange={(e) => setRationale(e.target.value)} /></label>
          <fieldset className="fs">
            <legend className="small">Regra de decisão pré-registrada (recomendado; não pode mudar depois que um experimento começar)</legend>
            <div className="grid4">
              <label>Métrica (em metrics.json)<input value={rule.metric} onChange={(e) => setRule({ ...rule, metric: e.target.value })} placeholder="taxa_reversao" /></label>
              <label>Operador<select value={rule.op} onChange={(e) => setRule({ ...rule, op: e.target.value })}>{['>=', '>', '<=', '<', '==', '!='].map((o) => <option key={o}>{o}</option>)}</select></label>
              <label>Valor<input type="number" step="any" value={rule.value} onChange={(e) => setRule({ ...rule, value: e.target.value })} required={!!rule.metric} /></label>
              <label>Dados exigidos<select value={rule.datasetRole} onChange={(e) => setRule({ ...rule, datasetRole: e.target.value })}><option value="VALIDACAO">VALIDAÇÃO</option><option value="RESERVADO">RESERVADO</option><option value="TREINO">TREINO</option><option value="">qualquer</option></select></label>
            </div>
          </fieldset>
          <button disabled={act.busy}>Registrar hipótese</button>
        </form>
        <p className="small muted">Com regra pré-registrada, a hipótese é decidida pelo sistema aplicando a regra às métricas de um experimento concluído pelo verificador. Sem regra, a decisão manual exige experimentos verificados.</p>
      </Card>
      <Card title="Comparação de experimentos">
        {!cmp || cmp.rows.length === 0 ? <Empty>Nenhum experimento. Crie um job com experimento na aba Jobs.</Empty> : (
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Experimento</th><th>Estado</th><th>Dataset</th><th>Commit</th>
                  {cmp.paramKeys.map((k: string) => <th key={`p${k}`}>param: {k}</th>)}
                  {cmp.metricKeys.map((k: string) => <th key={`m${k}`}>{k}</th>)}
                </tr>
              </thead>
              <tbody>
                {cmp.rows.map((e: any) => (
                  <tr key={e.id}>
                    <td>{e.name}{e.verified ? <span className="tag ok">verificado</span> : <span className="tag">não verificado</span>}</td>
                    <td><Status value={e.status} /></td>
                    <td className="small">{e.dataset ? `${e.dataset.asset} · ${e.dataset.name} (${e.dataset.role})` : '—'}</td>
                    <td><code>{short(e.codeRef, 10)}</code></td>
                    {cmp.paramKeys.map((k: string) => <td key={k}>{String(e.parameters?.[k] ?? '—')}</td>)}
                    {cmp.metricKeys.map((k: string) => <td key={k}>{e.metrics?.[k] !== undefined ? String(e.metrics[k]) : '—'}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card title="Memória da pesquisa">
        {r.memory.length === 0 ? <Empty>Sem registros.</Empty> : r.memory.map((m: any) => (
          <div key={m.id} className="mem">
            <span className="tag">{m.category.replace(/_/g, ' ')}</span> <b>{m.title}</b>
            <div className="small">{m.content}</div>
            {Object.keys(m.references ?? {}).length > 0 && <details><summary className="small">referências</summary><Json value={m.references} /></details>}
          </div>
        ))}
      </Card>
    </>
  );
}
