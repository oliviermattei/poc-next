#!/bin/sh
# Keeps a copy of what Claude Code sends the statusline — `rate_limits.five_hour` and
# `seven_day` included — in ~/.claude/ks-usage.json, where `ks.mjs budget` reads it, then hands
# the same input to the real statusline command given as arguments.
#
# settings.json:  "statusLine": { "type": "command",
#   "command": "sh ~/www/boilerplate/.killer-saas/bin/statusline-tee.sh bunx -y ccstatusline@latest" }
#
# Without it, `ks.mjs budget` falls back on ccstatusline's own cache, refreshed less often.
input=$(cat)
out="$HOME/.claude/ks-usage.json"
case "$input" in
  *rate_limits*) printf '%s' "$input" > "$out.tmp" && mv "$out.tmp" "$out" ;;
esac
printf '%s' "$input" | "$@"
