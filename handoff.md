# Lotus Project Handoff

## Overview
Lotus (formerly VaultKey) is a zero-knowledge, self-hosted password manager. The project has been restructured as a monorepo and initialized with Git.

## Current Progress

### General
- Project renamed to **Lotus**.
- Git repository initialized.
- Monorepo structure established using NPM workspaces (`packages/extension`, `packages/server`, `packages/shared`).

### Shared Package (`@lotus/shared`)
- **Status:** Complete & Built.
- **Features:**
    - TypeScript interfaces for Vault and VaultEntry.
    - Core Crypto Engine: Argon2id for KDF, AES-256-GCM for encryption, and HKDF for sub-key derivation.
    - Custom type definitions for `argon2-browser`.

### Server Package (`@lotus/server`)
- **Status:** Functional (Internal build error in progress).
- **Features:**
    - Fastify-based REST API and WebSocket sync.
    - SQLite storage layer (using `sqlite3` due to `better-sqlite3` compatibility issues with Node 25/C++20).
    - HMAC-based authentication middleware.
    - Vault CRUD and versioning routes.
    - mTLS certificate generation script (`scripts/generate-certs.sh`).
- **Blockers:** 
    - Minor TypeScript error in `src/routes/sync.ts` regarding `@fastify/websocket` connection typing.
    - `better-sqlite3` was replaced with `sqlite3` to bypass compilation errors on the current environment.

### Extension Package (`@lotus/extension`)
- **Status:** Not Started.
- **Next Steps:** Scaffold with Vite, React, Tailwind, and shadcn/ui as per the spec.

## Next Steps
1.  **Fix Server Sync Typing:** Resolve the `connection.socket` typing in `packages/server/src/routes/sync.ts`.
2.  **Scaffold Extension:** Initialize the extension package and implement the basic UI/Background scripts.
3.  **Google Drive Integration:** Implement the backup logic on both the server and extension.
4.  **End-to-End Testing:** Verify mTLS and HMAC authentication between a mock client and the server.

## Configuration
- **Server Port:** 8743 (default).
- **Database:** `packages/server/data/vault.db`.
- **Certs:** `packages/server/certs/`.
