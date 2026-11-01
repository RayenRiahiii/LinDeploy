#!/usr/bin/env bash
# Source this helper. Never evaluate the contents of an existing environment file.
initialize_lindeploy_env() {
    local config_path="$1"
    shift
    local entry key value
    local previous_umask
    previous_umask=$(umask)
    umask 077
    touch "$config_path"
    for key in DJANGO_SECRET_KEY LINDEPLOY_CREDENTIAL_KEY; do
        if ! grep -Eq "^[[:space:]]*(export[[:space:]]+)?${key}[[:space:]]*=" "$config_path"; then
            value=$(head -c 32 /dev/urandom | base64 | tr '+/' '-_' | tr -d '\r\n')
            # Always separate an appended entry from a missing final newline.
            printf '\n%s=%s\n' "$key" "$value" >> "$config_path"
        fi
    done
    for entry in "$@"; do
        key=${entry%%=*}
        if ! grep -Eq "^[[:space:]]*(export[[:space:]]+)?${key}[[:space:]]*=" "$config_path"; then
            printf '\n%s\n' "$entry" >> "$config_path"
        fi
    done
    umask "$previous_umask"
}
