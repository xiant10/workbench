#!/bin/sh
# Starts or stops the scripted agent alone, so a test can restart it mid-run.
set -eu

root=$(cd "$(dirname "$0")/.." && pwd)
stack="$root/.stack"

case "${1:-start}" in
stop)
	kill -9 "$(cat "$stack/agent.pid")" 2>/dev/null || true
	rm -f "$stack/agent.pid"
	;;
start)
	E2E_STORAGE="$stack/agent.sqlite" nohup node --disable-warning=ExperimentalWarning "$root/web/e2e/mock-agent.ts" >>"$stack/agent.log" 2>&1 &
	echo $! >"$stack/agent.pid"
	until curl -sf http://127.0.0.1:19800/healthz >/dev/null; do sleep 0.2; done
	;;
esac
