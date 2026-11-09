#!/usr/bin/env bash
# Held-out identity provider check. AUTHORED, NOT RUN on this laptop.
# The Keycloak image is not pulled by owner decision. See docs/engagement/evidence/keycloak-profile-authored.txt.
#
# What it does:
#   1. Starts the keycloak profile in docker-compose.yml.
#   2. Waits for the realm discovery document.
#   3. Runs api/test/oidc-heldout.test.ts with KEYCLOAK_ISSUER set.
#   4. Stops the profile.
#
# Usage: KC_ADMIN_PASSWORD=local-test-only ./scripts/keycloak-heldout.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

: "${KC_ADMIN_PASSWORD:?set KC_ADMIN_PASSWORD}"
export KC_ADMIN_PASSWORD

ISSUER="${KEYCLOAK_ISSUER:-http://127.0.0.1:25280/realms/cic}"
DISCOVERY="${ISSUER}/.well-known/openid-configuration"

COMPOSE=(docker compose -f docker-compose.yml --profile keycloak)
if ! docker compose version >/dev/null 2>&1; then
  COMPOSE=(podman compose -f docker-compose.yml --profile keycloak)
fi

cleanup() {
  "${COMPOSE[@]}" stop keycloak >/dev/null 2>&1 || true
  "${COMPOSE[@]}" rm -f keycloak >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "starting keycloak profile"
"${COMPOSE[@]}" up -d keycloak

echo "waiting for ${DISCOVERY}"
for i in $(seq 1 60); do
  if curl -fsS "$DISCOVERY" >/dev/null 2>&1; then
    echo "discovery is up after ${i} tries"
    break
  fi
  if [ "$i" -eq 60 ]; then
    echo "discovery did not come up in time" >&2
    "${COMPOSE[@]}" logs keycloak >&2 || true
    exit 1
  fi
  sleep 2
done

echo "running held-out suite"
KEYCLOAK_ISSUER="$ISSUER" npx vitest run api/test/oidc-heldout.test.ts

echo "done"
