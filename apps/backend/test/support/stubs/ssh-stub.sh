#!/usr/bin/env bash
# TEST-ONLY: finge ser o ssh. Grava os argumentos e roda localmente o comando que vem depois de "--".
echo "$@" > "${TMPDIR:-/tmp}/ssh-stub-args.txt"
while [ "$#" -gt 0 ] && [ "$1" != "--" ]; do shift; done
shift
bash -c "$*"
