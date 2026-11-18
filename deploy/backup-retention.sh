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

# Mantém os N conjuntos completos mais recentes. Antes disso, remove temporários e conjuntos incompletos deixados
# por uma interrupção. A limpeza acontece ANTES de criar o próximo backup, para ainda funcionar com pouco espaço.
limpar_backups_antigos() {
  local manter="$1" carimbo quantidade=0
  [[ "$manter" =~ ^[0-9]+$ ]] || { echo "quantidade de backups inválida: $manter" >&2; return 1; }

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
