#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/../initialize-env.sh"
test_root=$(mktemp -d)
config_path="$test_root/.env.docker"
printf '# preserve comments\nDJANGO_SECRET_KEY=existing==\nCUSTOM_VALUE=keep me\nBACKEND_PORT=9876' > "$config_path"
cp "$config_path" "$test_root/original"
initialize_lindeploy_env "$config_path" BACKEND_PORT=8000 DJANGO_DEBUG=False
cmp -n "$(wc -c < "$test_root/original")" "$test_root/original" "$config_path"
grep -Eq '^LINDEPLOY_CREDENTIAL_KEY=[A-Za-z0-9_-]{43}=$' "$config_path"
cp "$config_path" "$test_root/once"
initialize_lindeploy_env "$config_path" BACKEND_PORT=8000 DJANGO_DEBUG=False
cmp "$test_root/once" "$config_path"
initialize_lindeploy_env "$test_root/fresh.env" DJANGO_DEBUG=False
grep -Eq '^DJANGO_SECRET_KEY=[A-Za-z0-9_-]{43}=$' "$test_root/fresh.env"
printf 'Bash environment preservation and initialization: PASS\n'
rm -- "$config_path" "$test_root/original" "$test_root/once" "$test_root/fresh.env"
rmdir -- "$test_root"
