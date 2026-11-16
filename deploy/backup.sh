#!/bin/sh
# Nightly: if recipes/recipes.json changed (edited in the app), commit and push it to GitHub.
# Run by the kitchen-backup.timer user unit. Only touches the recipe file.
cd "$(dirname "$(readlink -f "$0")")/.." || exit 1
if git diff --quiet -- recipes/recipes.json && git diff --cached --quiet -- recipes/recipes.json; then
  echo "recipes unchanged"; exit 0
fi
git add recipes/recipes.json
git commit -q -m "Nightly recipe backup $(date +%F)" -- recipes/recipes.json
git push -q && echo "recipes backed up"
