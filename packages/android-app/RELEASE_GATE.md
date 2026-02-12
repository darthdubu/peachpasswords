# Lotus Android Release Gate

## Security
- [ ] Key lifecycle reviewed for master key, subkeys, decrypted entry data, and wipe points.
- [ ] Storage boundaries reviewed (encrypted at rest only, no plaintext exports by default).
- [ ] Transport auth reviewed for Lotus server and S3 compatibility paths.

## Reliability
- [ ] Unlock reliability matrix completed (master password, PIN, biometric).
- [ ] Sync replay/offline/conflict matrix completed against server + S3.
- [ ] Autofill success matrix completed for top login domains/apps.

## Product Quality
- [ ] TOTP and passkey UX validated on representative devices.
- [ ] Performance checks completed for cold start, vault list, detail open, and autofill latency.
- [ ] Accessibility pass completed (TalkBack, contrast, dynamic type).

## Launch Blockers
- [ ] No critical crashes in beta telemetry window.
- [ ] No data loss regressions in migration/rollback scenarios.
- [ ] UX parity checklist signed off against extension baseline.
