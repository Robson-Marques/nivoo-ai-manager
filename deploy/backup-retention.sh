#!/usr/bin/env bash
# Rotação dos backups do Nivoo. Este arquivo é separado para a regra poder ser testada sem executar o comando
# administrativo inteiro. BACKUP_DIR deve apontar para a pasta de backups antes de chamar as funções.

backup_completo() {
  local carimbo="$1"
  [ -f "$BACKUP_DIR/nivoo-db-$carimbo.dump" ] &&
    [ -f "$BACKUP_DIR/nivoo-data-$carimbo.tar.gz" ] &&
    [ -f "$BACKUP_DIR/nivoo-env-$carimbo" ]
}

remover_conjunto_backup() {
  local carimbo="$1"
  rm -f -- \
    "$BACKUP_DIR/nivoo-db-$carimbo.dump" \
    "$BACKUP_DIR/nivoo-data-$carimbo.tar.gz" \
    "$BACKUP_DIR/nivoo-env-$carimbo"
}

# Lista somente carimbos com o formato produzido pelo Nivoo. Arquivos estranhos na pasta nunca são apagados.
carimbos_de_backup() {
  local arquivo nome carimbo
  for arquivo in \
    "$BACKUP_DIR"/nivoo-db-*.dump \
    "$BACKUP_DIR"/nivoo-data-*.tar.gz \
    "$BACKUP_DIR"/nivoo-env-*; do
    [ -e "$arquivo" ] || continue
    nome="${arquivo##*/}"
    case "$nome" in
      nivoo-db-*.dump) carimbo="${nome#nivoo-db-}"; carimbo="${carimbo%.dump}" ;;
      nivoo-data-*.tar.gz) carimbo="${nome#nivoo-data-}"; carimbo="${carimbo%.tar.gz}" ;;
      nivoo-env-*) carimbo="${nome#nivoo-env-}" ;;
      *) continue ;;
    esac
    [[ "$carimbo" =~ ^[0-9]{8}-[0-9]{6}$ ]] && printf '%s\n' "$carimbo"
  done | sort -u
}

# O comando instalado em /usr/local/bin/nivoo pode estar uma versão atrás do
# repositório (ex.: update falhou antes do install). Ele carrega ESTE helper do
# checkout atualizado; logo o pré-check funciona inclusive no primeiro retry.
postgres_backup_pronto() {
  runuser -u postgres -- pg_isready -q 2>/dev/null &&
    runuser -u postgres -- psql -X -qAt -d nivoo -c 'SELECT 1' >/dev/null 2>&1
}

garantir_postgres_backup() {
  if postgres_backup_pronto; then return 0; fi
  echo "Backup Nivoo: PostgreSQL não acessível. Tentando iniciar serviço existente..." >&2
  # Apenas inicia serviço/cluster já existente: NUNCA cria ou reinicializa banco.
  if command -v systemctl >/dev/null 2>&1; then
    systemctl start postgresql >/dev/null 2>&1 || true
  fi
  if command -v service >/dev/null 2>&1; then
    service postgresql start >/dev/null 2>&1 || true
  fi
  # No Debian, postgresql.service pode estar ativo e um cluster específico parado.
  # Iniciar apenas o cluster que já estiver configurado para a porta 5432.
  if command -v pg_lsclusters >/dev/null 2>&1 && command -v pg_ctlcluster >/dev/null 2>&1; then
    while read -r versao cluster porta estado resto; do
      if [ "$porta" = 5432 ] && [ "$estado" != online ] && [ -n "$versao" ] && [ -n "$cluster" ]; then
        pg_ctlcluster "$versao" "$cluster" start >/dev/null 2>&1 || true
      fi
    done < <(pg_lsclusters -h 2>/dev/null)
  fi
  local tentativa
  for tentativa in 1 2 3 4 5 6 7 8 9 10; do
    if postgres_backup_pronto; then
      echo "Backup Nivoo: PostgreSQL e banco 'nivoo' disponíveis." >&2
      return 0
    fi
    sleep 1
  done
  echo "ERRO: PostgreSQL ou banco 'nivoo' indisponível. Nenhum backup completo foi removido." >&2
  echo "Verifique: pg_lsclusters ; systemctl status postgresql ; journalctl -u postgresql --no-pager -n 40" >&2
  return 1
}

# Só apague backups antigos DEPOIS de um novo backup completo ter sido criado.
# Compatibilidade: versões antigas do comando 'nivoo' chamam
# limpar_backups_antigos 1 ANTES de executar pg_dump. Nesse caso, fazer
# somente preflight do PostgreSQL, sem tocar nos backups existentes.
# A rotação real acontece via limpar_backups_antigos 2 depois da gravação.
limpar_backups_antigos() {
  local manter="$1" carimbo quantidade=0
  [[ "$manter" =~ ^[0-9]+$ ]] || { echo "quantidade de backups inválida: $manter" >&2; return 1; }
  if [ "$manter" = 1 ]; then
    garantir_postgres_backup || return 1
    return 0
  fi

  rm -f -- \
    "$BACKUP_DIR"/.nivoo-db-*.dump.tmp \
    "$BACKUP_DIR"/.nivoo-data-*.tar.gz.tmp \
    "$BACKUP_DIR"/.nivoo-env-*.tmp

  while IFS= read -r carimbo; do
    [ -n "$carimbo" ] || continue
    if ! backup_completo "$carimbo"; then
      remover_conjunto_backup "$carimbo"
      echo "removido backup incompleto: $carimbo"
    fi
  done < <(carimbos_de_backup)

  while IFS= read -r carimbo; do
    [ -n "$carimbo" ] || continue
    ((quantidade += 1))
    if (( quantidade > manter )); then
      remover_conjunto_backup "$carimbo"
      echo "removido backup antigo: $carimbo"
    fi
  done < <(carimbos_de_backup | sort -r)
}
