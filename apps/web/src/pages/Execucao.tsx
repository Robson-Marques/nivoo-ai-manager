import { Link, useSearchParams } from 'react-router-dom';
import { Card, Empty, ErrorBox, Status, STATUS_LABEL, When } from '../components';
import { useApi } from '../hooks';

export function Execucao() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? '';
  const { data, error } = useApi<any[]>(`/jobs${status ? `?status=${status}` : ''}`, 3000);
  return (
    <>
      <h1>Execução e acompanhamento</h1>
      <p className="muted">A execução acontece no worker e continua com o navegador fechado. Esta tela apenas acompanha.</p>
      <div className="chips">
        <button className={`chip ${status === '' ? 'on' : ''}`} onClick={() => setParams({})}>Todos</button>
        {Object.keys(STATUS_LABEL).map((s) => (
          <button key={s} className={`chip ${status === s ? 'on' : ''}`} onClick={() => setParams({ status: s })}><Status value={s} /></button>
        ))}
      </div>
      <Card>
        <ErrorBox error={error} />
        {data && data.length === 0 && <Empty>Nenhum job neste estado.</Empty>}
        {data && data.length > 0 && (
          <table>
            <thead><tr><th>Job</th><th>Projeto</th><th>Estado</th><th>Etapas</th><th>Detalhe</th><th>Atualizado</th></tr></thead>
            <tbody>
              {data.map((j) => (
                <tr key={j.id}>
                  <td><Link to={`/execucao/${j.projectId}/${j.id}`}>{j.title}</Link></td>
                  <td className="small">{j.project.name}</td>
                  <td><Status value={j.status} /></td>
                  <td className="small">{j.steps.filter((s: any) => s.status === 'CONCLUIDO').length}/{j.steps.length}</td>
                  <td className="small trunc">{j.blockedReason ? `${j.blockedReason}: ` : ''}{j.statusDetail ?? ''}</td>
                  <td><When date={j.updatedAt} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
