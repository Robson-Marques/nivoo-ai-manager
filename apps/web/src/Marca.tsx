/** Marca do sistema: o arquivo original do logo (public/logo.png, sem alteração) e o nome. */
export const NOME_SISTEMA = 'Nivoo Dev AI';

export function Logo({ tamanho = 28 }: { tamanho?: number }) {
  return <img src="/logo.png" alt="" width={tamanho} height={tamanho} className="logo" />;
}

export function Marca({ tamanho = 28 }: { tamanho?: number }) {
  return (
    <span className="marca-sistema">
      <Logo tamanho={tamanho} />
      <span>{NOME_SISTEMA}</span>
    </span>
  );
}
