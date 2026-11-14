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
import { Chat } from './pages/Chat';

function Avancado() {
  return (
    <div className="layout">
      <nav className="nav">
        <div className="brand">
          Nivoo <span>Modo avançado</span>
        </div>
        <NavLink to="/">← Voltar ao chat</NavLink>
        <NavLink to="/painel">Painel Mercado</NavLink>
        <NavLink to="/projetos">Projetos e pesquisas</NavLink>
        <NavLink to="/execucao">Execução</NavLink>
        <NavLink to="/conectores">Contas de IA e configurações</NavLink>
        <p className="nav-note">Operações financeiras reais são proibidas.</p>
      </nav>
      <main className="main">
        <Routes>
          <Route path="/avancado" element={<Painel />} />
          <Route path="/painel" element={<Painel />} />
          <Route path="/projetos" element={<Projetos />} />
          <Route path="/projetos/:pid" element={<Projeto />} />
          <Route path="/execucao" element={<Execucao />} />
          <Route path="/execucao/:pid/:jid" element={<JobDetalhe />} />
          <Route path="/conectores" element={<Conectores />} />
        </Routes>
      </main>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Chat />} />
        <Route path="/p/:pid" element={<Chat />} />
        <Route path="/modelos" element={<Chat tela="modelos" />} />
        <Route path="*" element={<Avancado />} />
      </Routes>
    </BrowserRouter>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
