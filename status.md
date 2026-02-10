# Lotus - Project Status

## Overview
Lotus is a private, zero-knowledge password manager browser extension with LAN sync capabilities. It prioritizes user privacy by ensuring all encryption happens locally on the device before any data is synced. The project includes a local server for synchronization and supports redundant backups to S3-compatible storage.

## Features

### Core Security
- **Zero-Knowledge Encryption**: All data is encrypted client-side using AES-GCM derived from a master password (Argon2id).
- **Local-First**: Data is stored locally in the browser and only synced when configured.
- **Secure Storage**: Uses `chrome.storage.local` for encrypted vaults and `chrome.storage.session` for temporary key storage.

### Vault Management
- **Entry Types**:
  - **Logins**: Username, password, URLs.
  - **Credit Cards**: Cardholder, number, expiry, CVV.
  - **Secure Notes**: Encrypted text content.
- **Search**: Real-time filtering of vault entries.
- **Auto-Lock**: Automatically locks the vault after a period of inactivity (default 5 minutes).

### Synchronization & Backup
- **Local Server Sync**: Real-time bidirectional sync via WebSocket to a local Lotus server.
- **S3 Redundancy**:
  - Supports S3-compatible backends (e.g., Scaleway, AWS).
  - **Dual Sync**: Simultaneously syncs to both Local Server and S3.
  - **Polling**: Periodic polling (30s) for S3 changes to simulate real-time sync.
  - **Failover**: UI indicators show status of both sync targets independently.
- **Manual Export**: Export vault to JSON (decrypted) for manual backup.

### User Interface
- **Dark Mode**: Default dark theme with "Peach" accent color.
- **Theme Support**: Configurable themes (Light/Dark) and color schemes (Peach, Green, Blue).
- **Responsive Design**: Built with Tailwind CSS and Radix UI components.
- **Mobile Pairing**: QR code generation for pairing with mobile apps.

## Current Status
- **Version**: 1.0.1
- **Platform**: Chrome Extension (Manifest V3)
- **Build System**: Vite + TypeScript

### Recent Changes
1.  **Dual Sync Architecture**:
    - Refactored `VaultContext` to support multiple sync hooks.
    - Implemented `useS3Sync` for S3-compatible storage integration.
    - Added UI indicators for both Local and S3 sync statuses.
2.  **Expanded Entry Types**:
    - Implemented full support for **Credit Cards** and **Secure Notes**.
    - Updated `EntryForm` with tabbed interface for different types.
    - Updated `EntryDetail` with type-specific views and field reveal logic.
3.  **UI/UX Improvements**:
    - Reverted to Dark Mode default with Peach accents.
    - Added "Backups" section in Settings.
    - Fixed icon configuration in `manifest.json`.
4.  **Code Quality**:
    - Fixed linter errors in `autofill.ts`, `Settings.tsx`, and `VaultContext.tsx`.
    - Added missing types and exports.

## Design & Architecture
- **Frontend**: React, Tailwind CSS, Radix UI.
- **State Management**: React Context (`VaultContext`, `ThemeContext`).
- **Cryptography**: Web Crypto API for AES-GCM and PBKDF2/Argon2id (via WASM).
- **Sync Protocol**:
  - **Local**: WebSocket-based push/pull with version vector conflict resolution (simplified "highest version wins" for single-user).
  - **S3**: Polling-based check-and-set using object metadata/body versioning.

## Next Steps / Roadmap
- **Mobile App**: Finish implementation of the mobile app to utilize the pairing feature.
- **Conflict Resolution**: Improve sync conflict handling for simultaneous edits.
- **Passkey Support**: Expand existing passkey stub implementation.
- **Browser Autofill**: Enhance content script for better form detection and autofill reliability.
