#!/usr/bin/env bash
# The suites `checks` runs, in groups that run side by side on separate
# runners (.github/workflows/checks.yml → matrix). One group:
#
#   bash qa/ci.sh client|api|storage|driver|integrations
#
# Every suite here is API-level Node, no browser. A group stops at its first
# red suite and says which.
set -euo pipefail
cd "$(dirname "$0")/.."
export DASHB_ROOT="${DASHB_ROOT:-$PWD}"
TMP="${RUNNER_TEMP:-$(mktemp -d)}"
run() { echo "::group::$1"; node "qa/$1.mjs"; echo "::endgroup::"; }

case "${1:-}" in
  # The build, and the suites that need no server at all.
  client)
    npm run build
    run duesync-suite     # client and server agree on deadlines
    run anon-suite        # names are stripped before any note leaves
    run nextstep-suite    # the next step, and whose it is
    run coach-suite       # the Coach look — what to do first
    run brand-suite       # brand book
    run round74-suite     # translation gate
    ;;

  # Suites against one API on a scratch database (:4090). A fresh nightly-job
  # secret per run is handed to that server alone: suites that boot their own
  # server copy process.env, and the ones that call the tick bare would be
  # locked out of it.
  api)
    export DATA_DIR="$TMP/data"
    mkdir -p "$DATA_DIR"
    openssl rand -hex 16 > "$TMP/cron-secret"
    CRON_SECRET="$(cat "$TMP/cron-secret")" PORT=4090 node server/index.js > "$TMP/api.log" 2>&1 &
    api=$!
    trap 'kill $api 2>/dev/null || true' EXIT
    for _ in $(seq 1 60); do curl -sf http://localhost:4090/api/health >/dev/null && break; sleep 0.5; done
    curl -sf http://localhost:4090/api/health >/dev/null || { cat "$TMP/api.log"; exit 1; }
    trap 'code=$?; kill $api 2>/dev/null || true; [ $code -eq 0 ] || { echo "--- API log ---"; tail -100 "$TMP/api.log"; }' EXIT
    for s in deadlines ownership design crewday builder schedule calendar r8-rules calfeed designers \
             telegram-type ambassador2 ambassadors-calendar delivreport media adminday people-stats \
             statsviz latesync round58 projects-access people stamps stats paykind makerpay track; do
      run "$s-suite"
    done
    CRON_SECRET="$(cat "$TMP/cron-secret")" run mypay-suite
    ;;

  # Suites that boot their own servers on GitHub storage, each with its own mock.
  storage)
    run round54-suite     # sessions and tokens
    run round55-suite     # rate limits and refused tokens
    run round57-suite     # concurrent writes
    run memguard-suite    # turns uploads away, then restarts, before memory runs out
    ;;

  # The storage driver itself, against a mock GitHub that answers like the
  # real API — 500s and rate limits included. storage-suite brings its own
  # mock; the other two get a freshly started one each.
  driver)
    run storage-suite
    for s in gh-suite gh500-suite; do
      MOCK_PORT=9977 node qa/mock-gh.mjs > "$TMP/mock-$s.log" 2>&1 &
      mock=$!
      for _ in $(seq 1 20); do curl -s http://localhost:9977 >/dev/null 2>&1 && break; sleep 0.5; done
      ok=0
      run "$s" || ok=1
      kill $mock 2>/dev/null || true
      wait $mock 2>/dev/null || true
      if [ $ok -ne 0 ]; then echo "--- mock-gh log for $s ---"; cat "$TMP/mock-$s.log" || true; exit 1; fi
    done
    ;;

  # Google Drive, Telegram, text channels, reposts, notifications and pay —
  # each suite boots its own server against its own mock.
  integrations)
    for s in drive drive-drop drive-box text-channels reposts people-ai \
             round40 round41 round47 round64 pravka tgdiet pay scheme; do
      run "$s-suite"
    done
    ;;

  *) echo "usage: $0 client|api|storage|driver|integrations" >&2; exit 2 ;;
esac
