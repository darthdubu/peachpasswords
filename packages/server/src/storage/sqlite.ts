import sqlite3 from "sqlite3";
import path from "path";
import fs from "fs";
import crypto from "crypto";

const DB_PATH = process.env.VAULTKEY_DATA
  ? path.join(process.env.VAULTKEY_DATA, "vault.db")
  : path.join(process.cwd(), "data", "vault.db");

    const dataDir = path.dirname(DB_PATH);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    }

export class Database {
  private db: sqlite3.Database;

  constructor() {
    this.db = new sqlite3.Database(DB_PATH);
    this.init();
  }

  private async init() {
    try {
      await this.run("PRAGMA journal_mode = WAL");
      await this.run("PRAGMA synchronous = NORMAL");
      await this.run("PRAGMA foreign_keys = ON");
      await this.run("PRAGMA temp_store = MEMORY");
      await this.run("PRAGMA mmap_size = 30000000000");

      await this.run(`
        CREATE TABLE IF NOT EXISTS vaults (
          id TEXT PRIMARY KEY,
          data BLOB NOT NULL,
          data_hash TEXT NOT NULL,
          version INTEGER NOT NULL,
          last_modified INTEGER NOT NULL
        )
      `);

      await this.run(`
        CREATE INDEX IF NOT EXISTS idx_vaults_version ON vaults(version)
      `);

      await this.run(`
        CREATE TABLE IF NOT EXISTS clients (
          id TEXT PRIMARY KEY,
          auth_key_hash TEXT NOT NULL,
          created INTEGER NOT NULL
        )
      `);

      await this.run(`
        CREATE TABLE IF NOT EXISTS audit_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          action TEXT NOT NULL,
          client_id TEXT,
          vault_id TEXT,
          timestamp INTEGER NOT NULL,
          device_fingerprint TEXT,
          signature TEXT NOT NULL
        )
      `);

      await this.run(`
        CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp)
      `);

    } catch (err) {
      console.error("Failed to initialize database:", err);
      process.exit(1);
    }
  }

  public computeDataHash(data: Buffer): string {
    return crypto.createHash("sha256").update(data).digest("hex");
  }

  public async writeAuditLog(
    action: string,
    clientId: string | null,
    vaultId: string | null,
    deviceFingerprint: string,
    secret: string
  ): Promise<void> {
    const timestamp = Date.now();
    const data = `${action}:${clientId || ''}:${vaultId || ''}:${timestamp}:${deviceFingerprint}`;
    const signature = crypto.createHmac("sha256", secret).update(data).digest("hex");

    await this.run(
      `INSERT INTO audit_log (action, client_id, vault_id, timestamp, device_fingerprint, signature)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [action, clientId, vaultId, timestamp, deviceFingerprint, signature]
    );
  }

  public async verifyAuditLog(secret: string): Promise<boolean> {
    const logs = await this.all<{
      action: string;
      client_id: string | null;
      vault_id: string | null;
      timestamp: number;
      device_fingerprint: string;
      signature: string;
    }>("SELECT * FROM audit_log ORDER BY id");

    for (const log of logs) {
      const data = `${log.action}:${log.client_id || ''}:${log.vault_id || ''}:${log.timestamp}:${log.device_fingerprint}`;
      const expectedSig = crypto.createHmac("sha256", secret).update(data).digest("hex");
      if (expectedSig !== log.signature) {
        return false;
      }
    }
    return true;
  }

  public run(sql: string, params: any[] = []): Promise<{ lastID: number; changes: number }> {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function (err) {
        if (err) return reject(err);
        resolve({ lastID: this.lastID, changes: this.changes });
      });
    });
  }

  public get<T>(sql: string, params: any[] = []): Promise<T | undefined> {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, row) => {
        if (err) return reject(err);
        resolve(row as T);
      });
    });
  }

  public all<T>(sql: string, params: any[] = []): Promise<T[]> {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) return reject(err);
        resolve(rows as T[]);
      });
    });
  }
}

export const db = new Database();
