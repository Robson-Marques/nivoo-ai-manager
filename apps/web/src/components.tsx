import { ReactNode } from 'react';

export const STATUS_LABEL: Record<string, string> = {
  PENDENTE: 'Pendente',
  EXECUTANDO: 'Executando',
  AGUARDANDO_RECURSO: 'Aguardando recurso',
  AGUARDANDO_APROVACAO: 'Aguardando aprovação',
  BLOQUEADO: 'Bloqueado',
  FALHOU: 'Falhou',
  CONCLUIDO: 'Concluído',
};

export function Status({ value }: { value: string }) {
  return <span className={`status s-${value}`}>{STATUS_LABEL[value] ?? value.replace(/_/g, ' ').toLowerCase()}</span>;
}

export function Card({ title, actions, children }: { title?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="card">
      {(title || actions) && (
        <header className="card-h">
          <h2>{title}</h2>
          <div className="actions">{actions}</div>
        </header>
      )}
      {children}
    </section>
  );
}

export function ErrorBox({ error }: { error: string | null | undefined }) {
  if (!error) return null;
  return <div className="error">{error}</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="muted">{children}</p>;
}

export function When({ date }: { date?: string | null }) {
  if (!date) return <span className="muted">—</span>;
  return <span title={date}>{new Date(date).toLocaleString('pt-BR')}</span>;
}

export function Json({ value }: { value: unknown }) {
  return <pre className="json">{JSON.stringify(value, null, 2)}</pre>;
}

export function short(id?: string | null, n = 8) {
  return id ? id.slice(0, n) : '—';
}
