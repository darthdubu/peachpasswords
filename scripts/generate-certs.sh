#!/bin/bash
mkdir -p certs

# Generate CA
openssl genrsa -out certs/ca-key.pem 2048
openssl req -new -x509 -days 3650 -key certs/ca-key.pem -out certs/ca.pem -subj "/C=US/ST=State/L=City/O=Lotus/CN=Lotus CA"

# Generate Server Cert
openssl genrsa -out certs/server-key.pem 2048
openssl req -new -key certs/server-key.pem -out certs/server.csr -subj "/C=US/ST=State/L=City/O=Lotus/CN=localhost"

# Sign Server Cert with CA
openssl x509 -req -days 365 -in certs/server.csr -CA certs/ca.pem -CAkey certs/ca-key.pem -CAcreateserial -out certs/server.pem

# Generate Client Cert (for extension)
openssl genrsa -out certs/client-key.pem 2048
openssl req -new -key certs/client-key.pem -out certs/client.csr -subj "/C=US/ST=State/L=City/O=Lotus/CN=Lotus Client"
openssl x509 -req -days 365 -in certs/client.csr -CA certs/ca.pem -CAkey certs/ca-key.pem -CAcreateserial -out certs/client.pem

# Convert Client Cert to P12 for browser import
openssl pkcs12 -export -out certs/client.p12 -inkey certs/client-key.pem -in certs/client.pem -passout pass:lotus

echo "Certificates generated in certs/"
echo "Import certs/ca.pem to your browser's Trusted Root Certification Authorities."
echo "Import certs/client.p12 to your browser's Personal Certificates (password: lotus)."
