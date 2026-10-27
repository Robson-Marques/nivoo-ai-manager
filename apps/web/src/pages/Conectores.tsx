import { FormEvent, useState } from 'react';
import { api, getToken, setToken } from '../api';
import { Card, ErrorBox, Json, When } from '../components';
import { useAction, useApi } from '../hooks';

function Avail({ s }: { s: any }) {
  if (!s) return <span className="tag">sem dados</span>;
  return <span className={`tag ${s.available ? 'ok' : 'bad'}`}>{s.available ? 'disponível' : 'indisponível'}</span>;
}

export function Conectores() {
  const { data: providers, error, reload } = useApi<any[]>('/providers');
  const { data: workers } = useApi<any[]>('/system/workers', 5000);
  const { data: config } = useApi<any>('/system/config');
  const { data: assets, reload: reloadAssets } = useApi<any[]>('/market/assets');
  const act = useAction();
  const [token, setTok] = useState(getToken());

  const toggle = (p: any) => act.run(async () => { await api(`/providers/${p.id}`, 'PATCH', { enabled: !p.config.enabled }); reload(); });
  const check = (p: any) => act.run(async () => { await api(`/providers/${p.id}/check`, 'POST'); reload(); });

  return (
    <>
      <h1>Conectores e configurações</h1>
      <ErrorBox error={error ?? act.error} />
      <Card title="Conectores de execução" actions={<button className="link" onClick={reload}>atualizar</button>}>
        <p className="small muted">
          A execução usa o que o <b>worker</b> enxerga: logins de CLI (Claude Code, Codex) precisam existir no host do worker.
          Nenhuma credencial é extraída de navegadores; chaves de API ficam apenas no <code>.env</code> do host.
        </p>
        <table>
          <thead><tr><th>Conector</th><th>Visto pela API</th><th>Visto pelos workers</th><th>Limites conhecidos</th><th></th></tr></thead>
          <tbody>
            {(providers ?? []).map((p) => (
              <tr key={p.id}>
                <td>
                  <b>{p.label}</b> <span className="tag">{p.kind}</span>{!p.isAi && <span className="tag">não-IA</span>}
                  <div className="small muted">{p.id}{p.version ? ` · ${p.version}` : ''}</div>
                  <div className="small">autenticado: {String(p.authenticated)} · capacidades: {p.capabilities.join(', ')}</div>
                </td>
                <td><Avail s={p} />{p.errors.map((e: string, i: number) => <div key={i} className="small bad-text">{e}</div>)}</td>
                <td>
                  {p.workers.length === 0 && <span className="muted small">nenhum worker online</span>}
                  {p.workers.map((w: any) => (
                    <div key={w.workerId} className="small"><Avail s={w.status} /> {w.workerId}{w.status?.errors?.length ? <div className="bad-text">{w.status.errors.join('; ')}</div> : null}</div>
                  ))}
                </td>
                <td className="small">{Object.entries(p.limits).map(([k, v]) => <div key={k}><b>{k}</b>: {String(v)}</div>)}</td>
                <td className="nowrap">
                  <button className="secondary" onClick={() => check(p)} disabled={act.busy}>Verificar</button>{' '}
                  <button className={p.config.enabled ? 'danger' : ''} onClick={() => toggle(p)} disabled={act.busy}>{p.config.enabled ? 'Desabilitar' : 'Habilitar'}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card title="Workers">
        <table>
          <thead><tr><th>Worker</th><th>Host / PID</th><th>Estado</th><th>Último sinal</th></tr></thead>
          <tbody>
            {(workers ?? []).map((w) => (
              <tr key={w.id}><td>{w.id}</td><td className="small">{w.hostname} / {w.pid}</td><td><span className={`tag ${w.online ? 'ok' : 'bad'}`}>{w.online ? 'online' : 'offline'}</span></td><td><When date={w.lastSeenAt} /></td></tr>
            ))}
          </tbody>
        </table>
      </Card>

      <div className="grid2">
        {(assets ?? []).map((a) => <AssetEditor key={a.code} asset={a} onSaved={reloadAssets} />)}
      </div>

      <div className="grid2">
        <Card title="Sistema">{config && <Json value={config} />}</Card>
        <Card title="Token de acesso à API (opcional)">
          <p className="small muted">Necessário somente se <code>NIVOO_API_TOKEN</code> estiver definido no servidor. Guardado apenas neste navegador.</p>
          <form className="row" onSubmit={(e) => { e.preventDefault(); setToken(token); reload(); }}>
            <input type="password" value={token} onChange={(e) => setTok(e.target.value)} />
            <button>Salvar</button>
          </form>
        </Card>
      </div>
    </>
  );
}

function AssetEditor({ asset, onSaved }: { asset: any; onSaved: () => void }) {
  const act = useAction();
  const [form, setForm] = useState({
    tickSize: String(Number(asset.tickSize)),
    pointValue: String(Number(asset.pointValue)),
    sessionOpen: asset.sessionOpen,
    sessionClose: asset.sessionClose,
    validation: JSON.stringify(asset.validation, null, 2),
  });
  const save = (e: FormEvent) => {
    e.preventDefault();
    act.run(async () => {
      await api(`/market/assets/${asset.code}`, 'PATCH', {
        tickSize: Number(form.tickSize),
        pointValue: Number(form.pointValue),
        sessionOpen: form.sessionOpen,
        sessionClose: form.sessionClose,
        validation: JSON.parse(form.validation),
      });
      onSaved();
    });
  };
  return (
    <Card title={`Configuração ${asset.code} (independente)`}>
      <form className="form" onSubmit={save}>
        <div className="grid4">
          <label>Tick<input value={form.tickSize} onChange={(e) => setForm({ ...form, tickSize: e.target.value })} /></label>
          <label>Valor do ponto (R$)<input value={form.pointValue} onChange={(e) => setForm({ ...form, pointValue: e.target.value })} /></label>
          <label>Abertura<input value={form.sessionOpen} onChange={(e) => setForm({ ...form, sessionOpen: e.target.value })} /></label>
          <label>Fechamento<input value={form.sessionClose} onChange={(e) => setForm({ ...form, sessionClose: e.target.value })} /></label>
        </div>
        <label>Regras de validação (JSON)<textarea rows={8} className="mono" value={form.validation} onChange={(e) => setForm({ ...form, validation: e.target.value })} /></label>
        <p className="small muted">Unidade: {asset.priceUnit}. Regras: {Object.values(asset.rules).join(' · ')}</p>
        <ErrorBox error={act.error} />
        <button disabled={act.busy}>Salvar {asset.code}</button>
      </form>
    </Card>
  );
}
