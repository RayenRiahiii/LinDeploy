#!/usr/bin/env bash
set -e

SERVER_IP="${1:-127.0.0.1}"
DNS_NAME="${2:-lindeploy-mirror.local}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNTIME_DIR="$SCRIPT_DIR/runtime"
CERT_DIR="$RUNTIME_DIR/certs"
OPENSSL_CONF="$RUNTIME_DIR/openssl.cnf"

mkdir -p "$CERT_DIR"

# CA Configuration
cat <<EOF > "$OPENSSL_CONF"
[req]
distinguished_name = subject
x509_extensions = v3_ca
prompt = no

[subject]
CN = LinDeploy Local Mirror CA
O = LinDeploy

[v3_ca]
basicConstraints = critical,CA:TRUE
keyUsage = critical,keyCertSign,cRLSign
subjectKeyIdentifier = hash
EOF

CA_KEY="$CERT_DIR/ca.key"
CA_CRT="$CERT_DIR/ca.crt"

if [ ! -f "$CA_KEY" ] || [ ! -f "$CA_CRT" ]; then
    echo "[LinDeploy] Generating CA certificate..."
    openssl req -x509 -newkey rsa:3072 -sha256 -nodes -days 3650 \
        -config "$OPENSSL_CONF" \
        -keyout "$CA_KEY" \
        -out "$CA_CRT"
else
    echo "[LinDeploy] Reusing existing CA certificate."
fi

# Server Configuration
cat <<EOF > "$OPENSSL_CONF"
[req]
distinguished_name = subject
req_extensions = server_ext
prompt = no

[subject]
CN = $DNS_NAME
O = LinDeploy

[server_ext]
basicConstraints = critical,CA:FALSE
keyUsage = critical,digitalSignature,keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt_names

[alt_names]
DNS.1 = $DNS_NAME
IP.1 = $SERVER_IP
EOF

echo "[LinDeploy] Generating mirror certificate for $DNS_NAME and $SERVER_IP..."
openssl req -new -newkey rsa:3072 -nodes \
    -config "$OPENSSL_CONF" \
    -keyout "$CERT_DIR/mirror.key" \
    -out "$CERT_DIR/mirror.csr"

openssl x509 -req -sha256 -days 825 \
    -in "$CERT_DIR/mirror.csr" \
    -CA "$CA_CRT" \
    -CAkey "$CA_KEY" \
    -CAcreateserial \
    -extensions server_ext \
    -extfile "$OPENSSL_CONF" \
    -out "$CERT_DIR/mirror.crt"

chmod 600 "$CERT_DIR"/*.key 2>/dev/null || true

if [ ! -f "$SCRIPT_DIR/.env" ] && [ -f "$SCRIPT_DIR/.env.example" ]; then
    cp "$SCRIPT_DIR/.env.example" "$SCRIPT_DIR/.env"
fi

echo "[LinDeploy] Mirror certificates successfully created for IP $SERVER_IP"

