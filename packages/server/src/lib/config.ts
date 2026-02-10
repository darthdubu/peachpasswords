import crypto from "crypto";

// Generate a cryptographically random sync secret if not provided
function generateSyncSecret(): string {
  return crypto.randomBytes(32).toString("base64");
}

export const CONFIG = {
  PORT: parseInt(process.env.VAULTKEY_PORT || "8743"),
  CERTS_DIR: process.env.VAULTKEY_CERTS || "./certs",
  DATA_DIR: process.env.VAULTKEY_DATA || "./data",
  // SECURITY FIX (LOTUS-002): Generate random sync secret if not provided
  // In production, always set VAULTKEY_SYNC_SECRET explicitly
  SYNC_SECRET: process.env.VAULTKEY_SYNC_SECRET || generateSyncSecret(),
};
