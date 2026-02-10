#!/bin/bash
set -e

CERTS_DIR="${1:-./certs}"
DAYS=3650
# Default to first non-loopback IP, or localhost if none found
SERVER_IP="${2:-$(ifconfig | grep "inet " | grep -v 127.0.0.1 | head -n1 | awk '{print $2}')}"
SERVER_IP="${SERVER_IP:-127.0.0.1}"

mkdir -p "$CERTS_DIR"

echo "==> Generating Certificate Authority"
openssl ecparam -genkey -name prime256v1 -out "$CERTS_DIR/ca-key.pem"
openssl req -new -x509 -key "$CERTS_DIR/ca-key.pem" 
  -out "$CERTS_DIR/ca.pem" -days $DAYS 
  -subj "/CN=Lotus CA/O=Lotus"

echo "==> Generating Server Certificate"
openssl ecparam -genkey -name prime256v1 -out "$CERTS_DIR/server-key.pem"
openssl req -new -key "$CERTS_DIR/server-key.pem" 
  -out "$CERTS_DIR/server.csr" 
  -subj "/CN=Lotus Server/O=Lotus"

cat > "$CERTS_DIR/server-ext.cnf" << EOF
authorityKeyIdentifier=keyid,issuer
basicConstraints=CA:FALSE
keyUsage=digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=IP:$SERVER_IP,DNS:localhost,IP:127.0.0.1
EOF

openssl x509 -req -in "$CERTS_DIR/server.csr" 
  -CA "$CERTS_DIR/ca.pem" -CAkey "$CERTS_DIR/ca-key.pem" 
  -CAcreateserial -out "$CERTS_DIR/server.pem" -days $DAYS 
  -extfile "$CERTS_DIR/server-ext.cnf"

echo "==> Generating Client Certificate"
openssl ecparam -genkey -name prime256v1 -out "$CERTS_DIR/client-key.pem"
openssl req -new -key "$CERTS_DIR/client-key.pem" 
  -out "$CERTS_DIR/client.csr" 
  -subj "/CN=Lotus Client/O=Lotus"
openssl x509 -req -in "$CERTS_DIR/client.csr" 
  -CA "$CERTS_DIR/ca.pem" -CAkey "$CERTS_DIR/ca-key.pem" 
  -CAcreateserial -out "$CERTS_DIR/client.pem" -days $DAYS

# Cleanup CSRs
rm -f "$CERTS_DIR"/*.csr "$CERTS_DIR"/*.cnf "$CERTS_DIR"/*.srl

echo "==> Certificates generated in $CERTS_DIR"
echo "    Server IP: $SERVER_IP"
echo "    Valid for: $DAYS days"
