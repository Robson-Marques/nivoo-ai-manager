import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useProjetos } from '../Layout';

/** Abre o projeto mais recente; sem projetos, explica como começar. */
export function Inicio() {
  const { projetos, novoProjeto } = useProjetos();
  const nav = useNavigate();
  useEffect(() => {
    if (projetos?.length) nav(`/p/${projetos[0].id}`, { replace: true });
  }, [projetos, nav]);
  if (!projetos || projetos.length) return null;
  return (
    <div className="chat-vazio">
      <h1>Bem-vindo ao Nivoo</h1>
      <p>Crie um projeto e converse com a IA. Cada projeto tem as suas regras, o seu conhecimento e a sua memória — a IA fica presa a eles.</p>
      <button onClick={novoProjeto}>Criar meu primeiro projeto</button>
    </div>
  );
}
