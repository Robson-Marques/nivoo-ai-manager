import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { Card, Empty, ErrorBox, When } from '../components';
import { useAction, useApi } from '../hooks';

export function Projetos() {
  const { data, error } = useApi<any[]>('/projects');
  const act = useAction();
  const nav = useNavigate();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    act.run(async () => {
      const p = await api('/projects', 'POST', { name, description });
      nav(`/projetos/${p.id}`);
    });
  };

  return (
    <>
      <h1>Projetos e pesquisas</h1>
      <Card title="Novo projeto">
        <form onSubmit={submit} className="form">
          <label>Nome<input value={name} onChange={(e) => setName(e.target.value)} required /></label>
          <label>Especificação / objetivo original (vira memória ESPECIFICAÇÃO)
            <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
          <ErrorBox error={act.error} />
          <button disabled={act.busy}>Criar projeto</button>
        </form>
      </Card>
      <Card title="Projetos">
        <ErrorBox error={error} />
        {data && data.length === 0 && <Empty>Nenhum projeto.</Empty>}
        {data && data.length > 0 && (
          <table>
            <thead><tr><th>Projeto</th><th>Pesquisas</th><th>Jobs</th><th>Datasets</th><th>Criado</th></tr></thead>
            <tbody>
              {data.map((p) => (
                <tr key={p.id}>
                  <td><Link to={`/projetos/${p.id}`}>{p.name}</Link><div className="muted small">{p.slug}</div></td>
                  <td>{p._count.researches}</td>
                  <td>{p._count.jobs}</td>
                  <td>{p._count.datasets}</td>
                  <td><When date={p.createdAt} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
