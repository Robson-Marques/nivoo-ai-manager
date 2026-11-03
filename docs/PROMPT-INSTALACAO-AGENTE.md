# Prompt para um agente de IA instalar o Nivoo num servidor Linux

Copie o bloco abaixo e entregue ao agente que tem acesso ao servidor (como root).

---

```text
Você vai instalar o Nivoo AI Manager neste servidor Linux. Trabalhe como root (não existe sudo).
Siga os passos na ordem, mostre a saída real de cada comando e NÃO invente resultados.
Se um passo falhar, pare, mostre o erro completo e me diga o que aconteceu — não improvise contornos.

REGRAS
- Não use sudo. Não desative segurança, não abra portas no firewall, não altere o código do Nivoo.
- Não exponha a porta 3000 na rede: a interface fica só em 127.0.0.1 e eu acesso por túnel SSH.
- Nunca mostre chaves privadas, senhas, tokens ou o conteúdo de /etc/nivoo/nivoo.env no seu relatório.
- Quando um passo depender de mim (cadastrar chave no GitHub, fazer login), PARE e me peça.

PASSO 0 — Conferir o ambiente
cat /etc/os-release; id -u; ps -p 1 -o comm=; df -h /; free -h
Requisitos: Debian 12 ou 13, usuário root (id -u = 0), systemd (ps -p 1 mostra "systemd"),
pelo menos 5 GB livres e 2 GB de RAM. Se não for Debian 12/13, me avise antes de continuar.
Se /opt/nivoo/app já existir, NÃO reinstale do zero: rode `nivoo update` e pule para o PASSO 4.

PASSO 1 — Chave de acesso ao GitHub (somente leitura)
apt-get update && apt-get install -y git openssh-client
install -d -m 700 /root/.ssh
ssh-keygen -t ed25519 -N "" -f /root/.ssh/nivoo_deploy -C "nivoo-$(hostname)"
cat >> /root/.ssh/config <<'EOF'
Host github-nivoo
    HostName github.com
    User git
    IdentityFile /root/.ssh/nivoo_deploy
    IdentitiesOnly yes
EOF
chmod 600 /root/.ssh/config
cat /root/.ssh/nivoo_deploy.pub
  → PARE AQUI. Me mostre a linha "ssh-ed25519 ..." (é a chave PÚBLICA) e peça para eu cadastrá-la em
    GitHub → repositório nivoo-ai-manager → Settings → Deploy keys → Add deploy key
    (sem marcar "Allow write access"). Espere eu confirmar.
Depois que eu confirmar:
ssh -o StrictHostKeyChecking=accept-new -T github-nivoo
(a resposta esperada contém "successfully authenticated"; o comando termina com código 1, isso é normal)

PASSO 2 — Baixar o código
git clone github-nivoo:robson-marques/nivoo-ai-manager.git /opt/nivoo/app
git -C /opt/nivoo/app log --oneline -1

PASSO 3 — Instalar
bash /opt/nivoo/app/deploy/install-debian.sh
Deve terminar com "Instalação concluída." (leva poucos minutos).
Se falhar, rode o mesmo comando mais UMA vez (o instalador continua de onde parou).
Se falhar de novo, pare e me mostre as últimas 60 linhas da saída e:
    journalctl -u nivoo-api -u nivoo-worker -n 80 --no-pager

PASSO 4 — Verificar (todos precisam passar)
nivoo check
    → serviços "active active active", API {"ok":true}, worker "online", local-shell "DISPONÍVEL".
      claude-code-cli e codex-cli aparecerem "indisponível ... sem login" é normal neste momento.
nivoo verificar
    → deve imprimir "OK: job de verificação CONCLUIDO pelo verificador".
ps -o user=,cmd= -C node
    → os processos do Nivoo rodam como usuário "nivoo" (não root).
ss -ltnp | grep ':3000'
    → deve escutar SOMENTE em 127.0.0.1:3000.
systemctl is-enabled nivoo-api nivoo-worker
    → "enabled" para os dois (sobem sozinhos ao reiniciar).

PASSO 5 — Login do Claude Code (depende de mim)
  → PARE e me pergunte qual opção eu prefiro:
(a) Eu gero um token no MEU computador com `claude setup-token` e te passo.
      Você roda:  nivoo set-claude-token 'TOKEN_QUE_EU_PASSAR'
      (não repita o token no relatório)
(b) Eu mesmo faço o login interativo no servidor com:  nivoo login-claude
Depois: nivoo check  → claude-code-cli deve aparecer "DISPONÍVEL".

PASSO 6 — Login do Codex (opcional; depende de mim)
Só se eu pedir. Rode:  nivoo login-codex
Ele mostra um link e um código: me passe os dois, eu autorizo no navegador, e você confirma com
nivoo check  → codex-cli "DISPONÍVEL".

PASSO 7 — Backup inicial
nivoo backup

RELATÓRIO FINAL (me entregue neste formato)
1. Sistema: versão do Debian, RAM, disco livre.
2. Commit instalado (saída do git log do PASSO 2).
3. Para cada passo 0–7: OK ou FALHOU, com a saída real resumida.
4. Saída completa de `nivoo check` e de `nivoo verificar`.
5. Comando para eu abrir a interface no MEU computador:
       ssh -N -L 3000:127.0.0.1:3000 root@<IP_DESTE_SERVIDOR>
     e depois acessar http://localhost:3000 no navegador.
6. O que ficou pendente e depende de mim.
```

---

## Observações

* O prompt foi escrito para o instalador testado em Debian 12.15 e 13.7 (máquinas limpas com systemd).
* `nivoo verificar` cria um pequeno projeto de teste ("Verificacao da instalacao …"); ele pode ser
  ignorado.
* Guia manual equivalente: [`INSTALACAO-DEBIAN.md`](INSTALACAO-DEBIAN.md).
