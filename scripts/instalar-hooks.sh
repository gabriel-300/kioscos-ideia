#!/bin/sh
# Instala los hooks de git versionados en scripts/git-hooks/ (los hooks de
# .git/hooks no se suben a GitHub, así que hay que correr esto una vez por
# cada copia del repositorio -- ej. la notebook).
cd "$(git rev-parse --show-toplevel)" || exit 1
for h in scripts/git-hooks/*; do
  cp "$h" ".git/hooks/$(basename "$h")"
  chmod +x ".git/hooks/$(basename "$h")"
  echo "instalado: $(basename "$h")"
done
