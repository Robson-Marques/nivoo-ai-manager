import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, NavLink, Route, Routes } from 'react-router-dom';
import './styles.css';
import { Painel } from './pages/Painel';
import { Projetos } from './pages/Projetos';
import { Projeto } from './pages/Projeto';
import { Execucao } from './pages/Execucao';
import { JobDetalhe } from './pages/JobDetalhe';
import { Conectores } from './pages/Conectores';

function App() {
  return (
    <BrowserRouter>
      <div className="layout">
        <nav className="nav">
          <div className="brand">
            Nivoo <span>AI Manager</span>
            <small>Mercado · V1</small>
          </div>
          <NavLink to="/" end>Painel Mercado</NavLink>
          <NavLink to="/projetos">Projetos e pesquisas</NavLink>
          <NavLink to="/execucao">Execução</NavLink>
          <NavLink to="/conectores">Conectores e configurações</NavLink>
          <p className="nav-note">Operações financeiras reais são proibidas nesta versão.</p>
        </nav>
        <main className="main">
          <Routes>
            <Route path="/" element={<Painel />} />
            <Route path="/projetos" element={<Projetos />} />
            <Route path="/projetos/:pid" element={<Projeto />} />
            <Route path="/execucao" element={<Execucao />} />
            <Route path="/execucao/:pid/:jid" element={<JobDetalhe />} />
            <Route path="/conectores" element={<Conectores />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
