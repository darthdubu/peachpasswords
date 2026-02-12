export interface VaultRecord {
  id: string;
  data: Buffer;
  data_hash: string;
  version: number;
  last_modified: number;
}
