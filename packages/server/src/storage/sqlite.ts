import sqlite3 from "sqlite3";
import path from "path";
import fs from "fs";

const DB_PATH = process.env.VAULTKEY_DATA 
  ? path.join(process.env.VAULTKEY_DATA, "vault.db") 
  : path.join(process.cwd(), "data", "vault.db");

// Ensure data directory exists
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

export class Database {
  private db: sqlite3.Database;

  constructor() {
    this.db = new sqlite3.Database(DB_PATH);
    this.init();
  }

  private init() {
    this.run(`
      CREATE TABLE IF NOT EXISTS vaults (
        id TEXT PRIMARY KEY,
        data BLOB NOT NULL,
        version INTEGER NOT NULL,
        last_modified INTEGER NOT NULL
      )
    `).catch(err => {
      console.error("Failed to initialize database:", err);
      process.exit(1);
    });
    
    // Auth table for client keys
    this.run(`
      CREATE TABLE IF NOT EXISTS clients (
        id TEXT PRIMARY KEY,
        auth_key_hash TEXT NOT NULL,
        created INTEGER NOT NULL
      )
    `).catch(err => {
      console.error("Failed to initialize clients table:", err);
    });
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
