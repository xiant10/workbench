#!/bin/sh
# Starts a throwaway stack for the browser tests: its own Postgres, auth-server
# LiveKit, and t10-collab, and agent-pi with a scripted model. It shares nothing
# with the local Compose stacks.
#
#   scripts/e2e-stack.sh up | down
#
# E2E_PORT moves the workbench, so that the tests can run beside a Compose stack.
# E2E_AGENT_URL sends agent calls somewhere else, such as ai-gateway-agent.
set -eu

root=$(cd "$(dirname "$0")/.." && pwd)
t10=$(dirname "$root")
stack="$root/.stack"
db_port=55433
db="postgres://postgres:test@127.0.0.1:$db_port"
auth_url=http://localhost:18081
collab_secret=e2e-only-t10-collab-service-secret-value
agent_secret=e2e-only-agent-pi-service-secret-value
port=${E2E_PORT:-8083}
agent_url=${E2E_AGENT_URL:-http://127.0.0.1:19800}

stop() {
	for name in workbench collab auth agent; do
		if [ -f "$stack/$name.pid" ]; then
			kill "$(cat "$stack/$name.pid")" 2>/dev/null || true
			rm -f "$stack/$name.pid"
		fi
	done
}

if [ "${1:-up}" = down ]; then
	stop
	docker rm -f t10-workbench-testdb t10-workbench-testlivekit >/dev/null 2>&1 || true
	exit 0
fi

stop
# Otherwise whatever already holds the port answers the readiness check below.
if curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$port/"; then
	echo "port $port is in use. Set E2E_PORT to another one" >&2
	exit 1
fi
mkdir -p "$stack/bin"
rm -f "$stack"/*.log "$stack"/agent.sqlite*

if ! docker inspect t10-workbench-testdb >/dev/null 2>&1; then
	docker run -d --rm --name t10-workbench-testdb -e POSTGRES_PASSWORD=test -p "127.0.0.1:$db_port:5432" postgres:17-alpine >/dev/null
fi
if ! docker inspect t10-workbench-testlivekit >/dev/null 2>&1; then
	docker run -d --rm --name t10-workbench-testlivekit -p 127.0.0.1:18890:7880 -p 127.0.0.1:7881:7881 -e 'LIVEKIT_KEYS=devkey: e2e-only-livekit-secret-of-32-characters' \
		livekit/livekit-server --node-ip 127.0.0.1 >/dev/null
fi
until docker exec t10-workbench-testdb pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done
sleep 1
for name in auth collab workbench; do
	docker exec t10-workbench-testdb psql -U postgres -qc "DROP DATABASE IF EXISTS e2e_$name" -c "CREATE DATABASE e2e_$name" >/dev/null
done

(cd "$t10/auth-server" && go build -o "$stack/bin/" ./cmd/auth-server ./cmd/authctl)
(cd "$t10/t10-collab" && go build -o "$stack/bin/t10-collab" ./cmd/t10-collab)
(cd "$root/web" && npm run build >/dev/null)
(cd "$root" && go build -o "$stack/bin/workbench" ./cmd/workbench)

sed "s/127\.0\.0\.1:8083/127.0.0.1:$port/g" "$t10/auth-server/clients.yaml" >"$stack/clients.yaml"
# A permission catalog for one made-up module, so the Roles page has something
# to offer. No service reads its entitlements.
mkdir -p "$stack/permissions"
cat >"$stack/permissions/demo.yaml" <<'EOF'
module: demo
prefix: demo
version: 1
permissions:
  - {key: demo:read, description: See demo records, lifecycle: active}
  - {key: demo:write, description: Change demo records, lifecycle: active}
  - {key: demo:admin, description: Demo settings, lifecycle: active}
templates:
  - {id: editor, name: Demo editor, description: Reads and changes demo records, permissions: [demo:read, demo:write]}
EOF
export AUTH_PUBLIC_URL=$auth_url AUTH_LISTEN_ADDR=:18081 AUTH_DEV_MODE=true AUTH_CLIENTS_FILE="$stack/clients.yaml" AUTH_PERMISSIONS_DIR="$stack/permissions"
export DATABASE_URL="$db/e2e_auth?sslmode=disable"
export LIVEKIT_URL=ws://localhost:18890 LIVEKIT_API_KEY=devkey LIVEKIT_API_SECRET=e2e-only-livekit-secret-of-32-characters
AUTHCTL_PASSWORD=e2e-admin-password "$stack/bin/authctl" bootstrap --if-empty --username=admin@e2e.example --tenant-id=ten_e2e --tenant-name=E2E >/dev/null
AUTHCTL_SERVICE_SECRET=e2e-only-voice-agent-service-secret-value "$stack/bin/authctl" service-add --if-missing --name=t10-livekit-agent >/dev/null
AUTHCTL_SERVICE_SECRET=$agent_secret "$stack/bin/authctl" service-add --if-missing --name=agent-pi >/dev/null
AUTHCTL_SERVICE_SECRET=e2e-only-agent-sales-service-secret-value "$stack/bin/authctl" service-add --if-missing --name=agent-sales >/dev/null
AUTHCTL_SERVICE_SECRET=$collab_secret "$stack/bin/authctl" service-add --if-missing --name=t10-collab >/dev/null
"$stack/bin/authctl" samples-add >/dev/null
"$stack/bin/auth-server" >"$stack/auth.log" 2>&1 &
echo $! >"$stack/auth.pid"
until curl -sf "$auth_url/readyz" >/dev/null; do sleep 0.3; done

DATABASE_URL="$db/e2e_collab?sslmode=disable" AUTH_ISSUER=$auth_url AUTH_CLIENT_SECRET=$collab_secret COLLAB_LISTEN_ADDR=:18082 \
	"$stack/bin/t10-collab" >"$stack/collab.log" 2>&1 &
echo $! >"$stack/collab.pid"
until curl -sf http://127.0.0.1:18082/readyz >/dev/null; do sleep 0.3; done

"$root/scripts/e2e-agent.sh" start

DATABASE_URL="$db/e2e_workbench?sslmode=disable" AUTH_PUBLIC_URL=$auth_url AUTH_CLIENT_SECRET=dev-only-t10-workbench-client-secret-change-me \
	WORKBENCH_LISTEN_ADDR=:$port WORKBENCH_PUBLIC_URL=http://127.0.0.1:$port WORKBENCH_SESSION_KEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= \
	AGENT_URLS=assistant=$agent_url MODULE_URLS=collab=http://127.0.0.1:18082 LIVEKIT_URL=ws://localhost:18890 \
	"$stack/bin/workbench" >"$stack/workbench.log" 2>&1 &
echo $! >"$stack/workbench.pid"
until curl -sf "http://127.0.0.1:$port/readyz" >/dev/null; do sleep 0.3; done
echo "stack is up on http://127.0.0.1:$port"
