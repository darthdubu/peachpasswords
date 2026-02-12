#!/bin/bash

# Generate signing keystore for Lotus Android app
# Run this script to create a keystore for GitHub Actions

KEYSTORE_FILE="lotus-release.keystore"
KEYSTORE_PASSWORD="$(openssl rand -base64 32 | tr -d '=+/')"
KEY_ALIAS="lotus"
KEY_PASSWORD="$(openssl rand -base64 32 | tr -d '=+/')"

echo "Generating Lotus Android signing keystore..."
echo ""

# Generate keystore
keytool -genkey -v \
  -keystore "$KEYSTORE_FILE" \
  -alias "$KEY_ALIAS" \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000 \
  -storepass "$KEYSTORE_PASSWORD" \
  -keypass "$KEY_PASSWORD" \
  -dname "CN=Lotus, OU=Security, O=Lotus, L=Unknown, ST=Unknown, C=US"

# Base64 encode for GitHub secret
KEYSTORE_BASE64="$(base64 -i "$KEYSTORE_FILE")"

echo ""
echo "=========================================="
echo "GITHUB SECRETS - Add these to your repo:"
echo "=========================================="
echo ""
echo "SIGNING_KEY:"
echo "$KEYSTORE_BASE64"
echo ""
echo "ALIAS:"
echo "$KEY_ALIAS"
echo ""
echo "KEY_STORE_PASSWORD:"
echo "$KEYSTORE_PASSWORD"
echo ""
echo "KEY_PASSWORD:"
echo "$KEY_PASSWORD"
echo ""
echo "=========================================="
echo "Keystore file: $KEYSTORE_FILE"
echo "Keep this file secure and do not commit it!"
echo "=========================================="

# Save to file for reference
cat > keystore-info.txt << EOF
Lotus Android Signing Keystore Information
Generated: $(date)

GitHub Secrets:
- SIGNING_KEY: (Base64 encoded keystore - see above)
- ALIAS: $KEY_ALIAS
- KEY_STORE_PASSWORD: $KEYSTORE_PASSWORD
- KEY_PASSWORD: $KEY_PASSWORD

IMPORTANT:
1. Add these secrets to your GitHub repository
2. Delete this file after adding secrets
3. Keep the $KEYSTORE_FILE file secure
4. Do NOT commit keystore files to git
EOF

echo ""
echo "Information saved to keystore-info.txt"
