import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import './styles.css';
import { Layout } from './Layout';
import { Contas } from './pages/Contas';
import { Inicio } from './pages/Inicio';
import { Modelos } from './pages/Modelos';
import { Projeto } from './pages/Projeto';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Inicio />} />
          <Route path="/p/:pid" element={<Projeto />} />
          <Route path="/modelos" element={<Modelos />} />
          <Route path="/contas" element={<Contas />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
