# Instalação no servidor Debian (como root)

Para Debian 12 ou 13, logado como **root** (sem `sudo`). Tudo abaixo é para copiar e colar.

> Testado em máquinas Debian 12.15 e 13.7 limpas, com systemd (2026-11-02 e 2026-11-14): instalação,
> atualização, serviços, job de ponta a ponta, reinício e reinstalação. Ver `docs/ESTADO.md`.

O que fica instalado:

| O quê | Onde |
|---|---|
| Código | `/opt/nivoo/app` |
| Claude Code, Codex e Gemini CLI | instalados globalmente pelo npm do Node oficial |
| `poppler-utils` (`pdftotext`) | para transformar PDF em texto |
| `ffmpeg` | para juntar as cenas de vídeo no vídeo completo |
| `tesseract-ocr`, `tesseract-ocr-por` | OCR: ler PDF escaneado (só imagem) |
| Node.js 22 (oficial, sha256 conferido) | `/opt/nivoo/node` |
| Configuração e segredos (permissão 640) | `/etc/nivoo/nivoo.env` |
| Dados (modelos, projetos, artefatos, `segredos.json`, logins dos CLIs) | `/var/lib/nivoo` |
| Banco | PostgreSQL local, banco `nivoo` (só localhost) |
| Serviços | `nivoo-api` e `nivoo-worker` (systemd, usuário `nivoo`, **não** root) |
| Comando de administração | `nivoo` |
| Backups | `/var/backups/nivoo` |

A interface escuta **só em 127.0.0.1:3000**. Você acessa pelo túnel SSH; nenhuma porta nova
fica aberta na internet.

---

## 1. Baixar o código no servidor (chave de deploy SSH, somente leitura)

O repositório é privado. Crie uma chave só para este servidor:

```bash
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
```

Copie a linha mostrada (`ssh-ed25519 ...`) e cadastre no GitHub:
**repositório nivoo-ai-manager → Settings → Deploy keys → Add deploy key** (deixe *Allow write access*
desmarcado).

Depois, no servidor:

```bash
ssh -o StrictHostKeyChecking=accept-new -T github-nivoo   # deve responder "successfully authenticated"
git clone github-nivoo:robson-marques/nivoo-ai-manager.git /opt/nivoo/app
```

> Sem chave? Alternativa: baixe o ZIP da branch no GitHub pelo seu computador, envie com
> `scp nivoo-ai-manager.zip root@SEU_SERVIDOR:/root/`, e no servidor:
> `apt-get install -y unzip && unzip /root/nivoo-ai-manager.zip -d /opt/nivoo && mv /opt/nivoo/nivoo-ai-manager-* /opt/nivoo/app`.
> (Nesse caso, o `nivoo update` não consegue baixar versões novas sozinho.)

## 2. Instalar

```bash
bash /opt/nivoo/app/deploy/install-debian.sh
```

Leva poucos minutos e termina com **"Instalação concluída."** Pode ser rodado de novo sem perder
dados nem configuração.

## 3. Abrir a interface

No **seu computador** (não no servidor):

```bash
ssh -N -L 3000:127.0.0.1:3000 root@IP_DO_SERVIDOR
```

Deixe esse terminal aberto e acesse **http://localhost:3000** no navegador.

### 3b. Publicar num domínio seu (Cloudflare) — recomendado para o dia a dia

Com o domínio já na sua conta da Cloudflare, no servidor (como root, sem sudo):

```bash
nivoo dominio nivoo.suaempresa.com.br
```

O comando instala o `cloudflared` (programa oficial da Cloudflare), mostra um link para você autorizar o
servidor na sua conta (abra no navegador e escolha o domínio), cria o túnel e o endereço, deixa o túnel como
serviço (volta sozinho se o servidor reiniciar) e liga o **token do Nivoo** (o navegador pede uma vez).
O Nivoo continua ouvindo só em 127.0.0.1: **nenhuma porta é aberta** e o HTTPS é da Cloudflare.

**Depois, ligue o login da Cloudflare na frente** (grátis até 50 pessoas): dash.cloudflare.com → Zero Trust
→ Access → Applications → Add an application → Self-hosted → domínio do Nivoo → Policy *Allow* com os
e-mails que podem entrar. Ao abrir o endereço, a Cloudflare pede o e-mail e envia um código.

**Para entrar sem token (só com o login da Cloudflare)**, depois de criar a aplicação no Access:

```bash
nivoo dominio acesso <equipe> <aud>
```

`<equipe>`: Zero Trust → Settings → *Team domain* (ex.: `minhaequipe.cloudflareaccess.com`).
`<aud>`: Access → Applications → aplicação do Nivoo → *Application Audience (AUD) Tag*.
O Nivoo passa a aceitar quem passou pelo login da Cloudflare (confere a assinatura de cada acesso); o token
continua valendo para o acesso pelo túnel SSH.

`nivoo dominio status` testa o endereço; `nivoo dominio remover` desliga o túnel.

## 4. Conectar as IAs (pela tela)

Na interface, abra **Conexões** → **+ Nova** e conecte pelo menos uma IA, com o login oficial de cada uma:

| IA | O que acontece |
|---|---|
| Claude | "Conectar" → abra o link, entre com a sua conta do Claude, copie o código e cole na tela |
| ChatGPT | "Conectar" → abra o link, entre com a sua conta do ChatGPT e digite o código mostrado na tela |
| Gemini | só por **chave de API** (aistudio.google.com): "+ Nova" → "Gemini — chave de API". O Google encerrou o uso do Gemini CLI com conta pessoal |

Também dá para usar uma chave de API ("ou usar uma chave de API"). As credenciais ficam em
`/var/lib/nivoo/data/segredos.json` (permissão 600) ou nos arquivos do próprio CLI no HOME do serviço
(`/var/lib/nivoo/.codex`, `/var/lib/nivoo/.nivoo-ia/<conexão>`); nunca no git nem no banco.

> ChatGPT e Gemini (API) ainda não foram testados com conta real neste desenvolvimento (ver `docs/ESTADO.md`).

**Alternativa pelo terminal** (no servidor):

```bash
nivoo login-claude       # login interativo do Claude Code; ao terminar digite /exit
nivoo set-claude-token   # cole um token gerado com 'claude setup-token' (grava em /etc/nivoo/nivoo.env)
nivoo login-codex        # mostra um link e um código de dispositivo
nivoo check              # status dos conectores
```

Os três comandos reiniciam a API e o worker no fim. Um token gravado por `nivoo set-claude-token` fica
em `/etc/nivoo/nivoo.env` e tem prioridade sobre o da tela (que mostra "configurado pelo administrador").

## 5. Dia a dia

```bash
nivoo status           # serviços
nivoo logs             # logs ao vivo (Ctrl+C sai)
nivoo check            # API, workers e conectores
nivoo verificar        # job de teste de ponta a ponta (sem IA): deve imprimir OK; exclui o projeto de teste no fim
nivoo backup           # banco + dados + configuração; mantém somente os 2 mais recentes
nivoo limpar-backups   # remove backups antigos/incompletos sem precisar do PostgreSQL ativo
nivoo update           # backup + git pull + reinstala + migra (sem perder dados; API e worker param durante as migrações e voltam sozinhos; trabalhos em andamento continuam de onde pararam)
nivoo restart
nivoo help
```

> Versões anteriores a 2026-11-14: se depois de um `nivoo update` a API não subir ("Cannot find module"),
> rode `bash /opt/nivoo/app/deploy/install-debian.sh` com o código novo: ele repara as permissões
> (o `nivoo update` herdava `umask 077`; o instalador agora força `umask 022`).

Os serviços sobem sozinhos quando o servidor reinicia. Se o worker cair, o systemd o reinicia, e os
trabalhos em andamento são retomados do último checkpoint.

## Opções de instalação

```bash
NIVOO_PORT=8080 bash /opt/nivoo/app/deploy/install-debian.sh        # outra porta
NIVOO_HOST=0.0.0.0 bash /opt/nivoo/app/deploy/install-debian.sh     # expor na rede (gera NIVOO_API_TOKEN)
NIVOO_INSTALL_CLIS=0 bash /opt/nivoo/app/deploy/install-debian.sh   # sem Claude Code/Codex/Gemini CLI
```

Com token exigido (`NIVOO_API_TOKEN`), a tela pede o token na primeira vez e guarda neste navegador.
O valor está em `/etc/nivoo/nivoo.env`. Mesmo assim, prefira o túnel SSH.

Expor na internet sem HTTPS não é recomendado: prefira o túnel SSH, ou coloque um proxy reverso com
TLS na frente.

## Segurança aplicada pelo instalador

* Serviços como usuário `nivoo`, sem privilégios, com isolamento do systemd: sistema de arquivos
  somente leitura, exceto `/var/lib/nivoo`; `/home` e `/root` inacessíveis; `/tmp` privado; sem
  capacidades. `systemd-analyze security nivoo-worker` → **3.1 OK**.
* Segredos só em `/etc/nivoo/nivoo.env` (root:nivoo, 640); backups com permissão 600.
* Banco acessível apenas em localhost, com senha aleatória.
* Credenciais conectadas pela tela: `/var/lib/nivoo/data/segredos.json`, permissão 600.
* As IAs rodam sem shell e sem permissões genéricas: não escrevem fora do diretório de trabalho.

## Problemas comuns

| Sintoma | Verifique |
|---|---|
| IA aparece "não conectada" | conecte em **Conexões** (ou `nivoo login-claude` / `nivoo login-codex`) |
| "Importar de PDF" falha | `apt-get install -y poppler-utils tesseract-ocr tesseract-ocr-por` (o instalador já instala) |
| Interface não abre | o túnel SSH está aberto? `nivoo status`; `nivoo logs api` |
| Jobs parados em "Aguardando recurso" | `nivoo check` (login/limite do provedor); `nivoo logs worker` |
| Erro durante a instalação | rode o instalador de novo; ele continua de onde estava |


## Bancos de teste dos projetos

O instalador cria o usuário PostgreSQL `nivoo_testes` (só cria bancos; não é superusuário e não entra no banco do Nivoo) e grava `NIVOO_TESTES_PG_URL` em `/etc/nivoo/nivoo.env`. Cada trabalho usa um banco `teste_<id>` vazio para os testes do projeto, apagado quando o trabalho termina. Para desligar, remova a linha `NIVOO_TESTES_PG_URL` e rode `nivoo restart`.


## Prévia dos projetos

O botão "Ver o projeto" mostra o site/sistema do projeto rodando ao lado da conversa. O Nivoo serve a prévia por um portão próprio (porta `NIVOO_PREVIA_PORT`, padrão 3100, só 127.0.0.1) num endereço próprio: com domínio da Cloudflare, `nivoo dominio` cria `previa-<endereço>` no mesmo túnel (para quem já tinha domínio, o `nivoo update` cria sozinho; manualmente: `nivoo dominio previa`). Pelo túnel SSH, encaminhe também a porta 3100 (`ssh -N -L 3000:127.0.0.1:3000 -L 3100:127.0.0.1:3100 root@servidor`).
