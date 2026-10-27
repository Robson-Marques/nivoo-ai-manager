import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../api';
import { Card, Empty, ErrorBox, Status, When } from '../../components';
import { useAction, useApi } from '../../hooks';

interface StepRow { key: string; title: string; instructions: string; provider: string; dependsOn: string; verifyCommand: string }
interface CritRow { key: string; description: string; kind: string; config: string }

const KIND_HELP: Record<string, string> = {
  COMMAND: '{"command": "pytest -q"}',
  FILE_EXISTS: '{"path": "src/estudo.py"}',
  ARTIFACT_PRESENT: '{"name": "relatorio.md"}',
  METRIC_THRESHOLD: '{"artifact": "metrics.json", "path": "sharpe", "op": ">=", "value": 1}',
  MANUAL_APPROVAL: '{}',
};

const emptyStep = (n: number): StepRow => ({ key: `etapa${n}`, title: '', instructions: '', provider: '', dependsOn: n > 1 ? `etapa${n - 1}` : '', verifyCommand: '' });

export function Jobs({ project }: { project: any }) {
  const { data: jobs, reload } = useApi<any[]>(`/projects/${project.id}/jobs`, 5000);
  const { data: providers } = useApi<any[]>('/providers');
  const act = useAction();
  const nav = useNavigate();
  const [title, setTitle] = useState('');
  const [objective, setObjective] = useState('');
  const [provider, setProvider] = useState('local-shell');
  const [researchId, setResearchId] = useState('');
  const [steps, setSteps] = useState<StepRow[]>([emptyStep(1)]);
  const [criteria, setCriteria] = useState<CritRow[]>([{ key: 'evidencia', description: '', kind: 'ARTIFACT_PRESENT', config: KIND_HELP.ARTIFACT_PRESENT }]);
  const [limits, setLimits] = useState({ maxAttemptsPerStep: 3, maxDurationSec: 3600, maxCostUsd: 5, stepTimeoutSec: 900 });
  const [exp, setExp] = useState({ enabled: false, name: '', hypothesisId: '', datasetId: '', parameters: '{}' });
  const { data: research } = useApi<any>(researchId ? `/projects/${project.id}/researches/${researchId}` : null);

  const submit = (e: FormEvent, start: boolean) => {
    e.preventDefault();
    act.run(async () => {
      const body: any = {
        title,
        objective,
        defaultProvider: provider,
        researchId: researchId || undefined,
        limits,
        steps: steps.map((s) => ({
          key: s.key,
          title: s.title || s.key,
          instructions: s.instructions,
          provider: s.provider || undefined,
          dependsOn: s.dependsOn.split(',').map((x) => x.trim()).filter(Boolean),
          verifyCommand: s.verifyCommand || undefined,
        })),
        criteria: criteria.map((c) => ({ key: c.key, description: c.description || c.key, kind: c.kind, config: JSON.parse(c.config || '{}') })),
      };
      if (exp.enabled) {
        body.experiment = {
          name: exp.name || title,
          hypothesisId: exp.hypothesisId || undefined,
          datasetId: exp.datasetId || undefined,
          parameters: JSON.parse(exp.parameters || '{}'),
        };
      }
      const job = await api(`/projects/${project.id}/jobs`, 'POST', body);
      if (start) await api(`/projects/${project.id}/jobs/${job.id}/start`, 'POST');
      nav(`/execucao/${project.id}/${job.id}`);
    });
  };

  const upStep = (i: number, patch: Partial<StepRow>) => setSteps(steps.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const upCrit = (i: number, patch: Partial<CritRow>) => setCriteria(criteria.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  return (
    <>
      <Card title="Jobs do projeto">
        {jobs && jobs.length === 0 && <Empty>Nenhum job.</Empty>}
        {jobs && jobs.length > 0 && (
          <table>
            <thead><tr><th>Job</th><th>Estado</th><th>Etapas</th><th>Pesquisa</th><th>Atualizado</th></tr></thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id}>
                  <td><Link to={`/execucao/${project.id}/${j.id}`}>{j.title}</Link></td>
                  <td><Status value={j.status} /></td>
                  <td className="small">{j.steps.filter((s: any) => s.status === 'CONCLUIDO').length}/{j.steps.length}</td>
                  <td className="small">{j.research?.title ?? '—'}</td>
                  <td><When date={j.updatedAt} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <button className="link" onClick={reload}>atualizar</button>
      </Card>

      <Card title="Novo job (execução durável)">
        <form className="form" onSubmit={(e) => submit(e, true)}>
          <div className="grid2">
            <label>Título<input value={title} onChange={(e) => setTitle(e.target.value)} required /></label>
            <label>Conector padrão
              <select value={provider} onChange={(e) => setProvider(e.target.value)}>
                {(providers ?? []).map((p) => (
                  <option key={p.id} value={p.id}>{p.label}{p.available ? '' : ' (indisponível na API)'}</option>
                ))}
              </select>
            </label>
          </div>
          <label>Objetivo (imutável; alterações geram nova versão)
            <textarea rows={3} value={objective} onChange={(e) => setObjective(e.target.value)} required />
          </label>
          <label>Pesquisa (opcional)
            <select value={researchId} onChange={(e) => setResearchId(e.target.value)}>
              <option value="">— nenhuma —</option>
              {project.researches.map((r: any) => <option key={r.id} value={r.id}>{r.title}</option>)}
            </select>
          </label>

          <h3>Etapas</h3>
          {steps.map((s, i) => (
            <fieldset key={i} className="fs">
              <div className="grid3">
                <label>Chave<input value={s.key} onChange={(e) => upStep(i, { key: e.target.value })} required /></label>
                <label>Depende de (chaves, vírgula)<input value={s.dependsOn} onChange={(e) => upStep(i, { dependsOn: e.target.value })} /></label>
                <label>Conector (vazio = padrão)
                  <select value={s.provider} onChange={(e) => upStep(i, { provider: e.target.value })}>
                    <option value="">padrão</option>
                    {(providers ?? []).map((p) => <option key={p.id} value={p.id}>{p.id}</option>)}
                  </select>
                </label>
              </div>
              <label>Instruções (prompt para IA ou comando para local-shell)
                <textarea rows={3} value={s.instructions} onChange={(e) => upStep(i, { instructions: e.target.value })} required />
              </label>
              <label>Verificação da etapa (comando opcional; exit 0 = ok)<input value={s.verifyCommand} onChange={(e) => upStep(i, { verifyCommand: e.target.value })} /></label>
              {steps.length > 1 && <button type="button" className="link danger" onClick={() => setSteps(steps.filter((_, j) => j !== i))}>remover etapa</button>}
            </fieldset>
          ))}
          <button type="button" className="secondary" onClick={() => setSteps([...steps, emptyStep(steps.length + 1)])}>+ etapa</button>

          <h3>Critérios de aceitação (verificados pelo backend)</h3>
          {criteria.map((c, i) => (
            <fieldset key={i} className="fs">
              <div className="grid3">
                <label>Chave<input value={c.key} onChange={(e) => upCrit(i, { key: e.target.value })} required /></label>
                <label>Tipo
                  <select value={c.kind} onChange={(e) => upCrit(i, { kind: e.target.value, config: KIND_HELP[e.target.value] })}>
                    {Object.keys(KIND_HELP).map((k) => <option key={k}>{k}</option>)}
                  </select>
                </label>
                <label>Descrição<input value={c.description} onChange={(e) => upCrit(i, { description: e.target.value })} /></label>
              </div>
              <label>Configuração (JSON)<input value={c.config} onChange={(e) => upCrit(i, { config: e.target.value })} /></label>
              <button type="button" className="link danger" onClick={() => setCriteria(criteria.filter((_, j) => j !== i))}>remover critério</button>
            </fieldset>
          ))}
          {criteria.length === 0 && <div className="warn">Sem critérios o job nunca será concluído.</div>}
          <button type="button" className="secondary" onClick={() => setCriteria([...criteria, { key: `c${criteria.length + 1}`, description: '', kind: 'COMMAND', config: KIND_HELP.COMMAND }])}>+ critério</button>

          <h3>Limites</h3>
          <div className="grid4">
            <label>Tentativas por etapa<input type="number" value={limits.maxAttemptsPerStep} onChange={(e) => setLimits({ ...limits, maxAttemptsPerStep: +e.target.value })} /></label>
            <label>Tempo total (s)<input type="number" value={limits.maxDurationSec} onChange={(e) => setLimits({ ...limits, maxDurationSec: +e.target.value })} /></label>
            <label>Timeout por tentativa (s)<input type="number" value={limits.stepTimeoutSec} onChange={(e) => setLimits({ ...limits, stepTimeoutSec: +e.target.value })} /></label>
            <label>Orçamento (US$)<input type="number" step="0.1" value={limits.maxCostUsd} onChange={(e) => setLimits({ ...limits, maxCostUsd: +e.target.value })} /></label>
          </div>

          {researchId && (
            <>
              <label className="check"><input type="checkbox" checked={exp.enabled} onChange={(e) => setExp({ ...exp, enabled: e.target.checked })} /> Registrar como experimento da pesquisa</label>
              {exp.enabled && (
                <div className="grid4">
                  <label>Nome<input value={exp.name} onChange={(e) => setExp({ ...exp, name: e.target.value })} /></label>
                  <label>Hipótese
                    <select value={exp.hypothesisId} onChange={(e) => setExp({ ...exp, hypothesisId: e.target.value })}>
                      <option value="">—</option>
                      {(research?.hypotheses ?? []).map((h: any) => <option key={h.id} value={h.id}>{h.statement.slice(0, 60)}</option>)}
                    </select>
                  </label>
                  <label>Dataset
                    <select value={exp.datasetId} onChange={(e) => setExp({ ...exp, datasetId: e.target.value })}>
                      <option value="">—</option>
                      {project.datasets.map((d: any) => <option key={d.id} value={d.id}>{d.asset.code} · {d.name} ({d.role}{d.role === 'RESERVADO' && !d.released ? ', bloqueado' : ''})</option>)}
                    </select>
                  </label>
                  <label>Parâmetros (JSON)<input value={exp.parameters} onChange={(e) => setExp({ ...exp, parameters: e.target.value })} /></label>
                </div>
              )}
            </>
          )}
          <ErrorBox error={act.error} />
          <div className="row">
            <button disabled={act.busy}>Criar e iniciar</button>
            <button type="button" className="secondary" disabled={act.busy} onClick={(e) => submit(e as any, false)}>Criar sem iniciar</button>
          </div>
        </form>
      </Card>
    </>
  );
}
