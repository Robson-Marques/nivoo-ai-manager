import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Card, ErrorBox } from '../components';
import { useApi } from '../hooks';
import { Datasets } from './projeto/Datasets';
import { Jobs } from './projeto/Jobs';
import { Memoria } from './projeto/Memoria';
import { Pesquisas } from './projeto/Pesquisas';

const TABS = ['Pesquisas', 'Jobs', 'Datasets', 'Memória'] as const;

export function Projeto() {
  const { pid } = useParams();
  const [params] = useSearchParams();
  const { data: project, error, reload } = useApi<any>(`/projects/${pid}`);
  const [tab, setTab] = useState<(typeof TABS)[number]>(params.get('tab') === 'jobs' ? 'Jobs' : 'Pesquisas');
  if (error) return <ErrorBox error={error} />;
  if (!project) return <p className="muted">Carregando…</p>;
  return (
    <>
      <p className="crumbs"><Link to="/projetos">Projetos</Link> / {project.name}</p>
      <h1>{project.name}</h1>
      {project.description && <p className="lead">{project.description}</p>}
      <p className="muted small">Workspace isolado: <code>{project.workspacePath}</code></p>
      <div className="tabs">
        {TABS.map((t) => (
          <button key={t} className={t === tab ? 'tab active' : 'tab'} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>
      {tab === 'Pesquisas' && <Pesquisas project={project} reloadProject={reload} initial={params.get('pesquisa')} />}
      {tab === 'Jobs' && <Jobs project={project} />}
      {tab === 'Datasets' && <Datasets project={project} reloadProject={reload} />}
      {tab === 'Memória' && <Memoria project={project} />}
    </>
  );
}

export { Card };
