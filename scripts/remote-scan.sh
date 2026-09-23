#!/bin/sh
# Runs ON a remote host (shipped there over ssh by the cc-scan-remote-v1 handler
# that update-ui.sh writes into the main bundle). Read-only. Prints:
#   @@CC@@U<TAB>user
#   @@CC@@S<TAB>claude-projects-slug<TAB>newest-transcript-mtime   (one per slug)
#   @@CC@@P<TAB>path<TAB>git-head-mtime<TAB>todo-mtime             (one per project)
#   ...the project's TODO.md text (first 8000 bytes) until the next marker
# Times are epoch seconds. Kept as its own file, not inline in update-ui.sh,
# because that script's heredoc is unquoted and would eat every dollar sign here.
M='@@CC@@'
T=$(printf '\t')
printf '%sU%s%s\n' "$M" "$T" "$(id -un)"
for s in "$HOME"/.claude/projects/*/; do
  [ -d "$s" ] || continue
  f=$(ls -t "$s"*.jsonl 2>/dev/null | head -n 1)
  [ -n "$f" ] || continue
  printf '%sS%s%s%s%s\n' "$M" "$T" "$(basename "$s")" "$T" "$(stat -c %Y "$f" 2>/dev/null || echo 0)"
done
for d in "$HOME/AI Projects"/*/; do
  [ -d "$d" ] || continue
  d=${d%/}
  case "${d##*/}" in Archived*) continue ;; esac
  c=$(stat -c %Y "$d/.git/logs/HEAD" 2>/dev/null || echo 0)
  t=$(stat -c %Y "$d/TODO.md" 2>/dev/null || echo 0)
  printf '%sP%s%s%s%s%s%s\n' "$M" "$T" "$d" "$T" "$c" "$T" "$t"
  if [ -f "$d/TODO.md" ]; then head -c 8000 "$d/TODO.md"; printf '\n'; fi
done
