import { Preferences } from '@capacitor/preferences';

export interface StorageArea {
  get(keys: string | string[] | Record<string, unknown> | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
  clear(): Promise<void>;
}

class CapacitorStorage implements StorageArea {
  async get(keys: string | string[] | Record<string, unknown> | null): Promise<Record<string, unknown>> {
    if (keys === null) {
      const { keys: allKeys } = await Preferences.keys();
      const result: Record<string, unknown> = {};
      for (const key of allKeys) {
        const { value } = await Preferences.get({ key });
        if (value !== null) {
          try {
            result[key] = JSON.parse(value);
          } catch {
            result[key] = value;
          }
        }
      }
      return result;
    }

    if (typeof keys === 'string') {
      const { value } = await Preferences.get({ key: keys });
      if (value === null) return {};
      try {
        return { [keys]: JSON.parse(value) };
      } catch {
        return { [keys]: value };
      }
    }

    if (Array.isArray(keys)) {
      const result: Record<string, unknown> = {};
      for (const key of keys) {
        const { value } = await Preferences.get({ key });
        if (value !== null) {
          try {
            result[key] = JSON.parse(value);
          } catch {
            result[key] = value;
          }
        }
      }
      return result;
    }

    const result: Record<string, unknown> = {};
    for (const [key, defaultValue] of Object.entries(keys)) {
      const { value } = await Preferences.get({ key });
      if (value !== null) {
        try {
          result[key] = JSON.parse(value);
        } catch {
          result[key] = value;
        }
      } else {
        result[key] = defaultValue;
      }
    }
    return result;
  }

  async set(items: Record<string, unknown>): Promise<void> {
    for (const [key, value] of Object.entries(items)) {
      await Preferences.set({
        key,
        value: JSON.stringify(value)
      });
    }
  }

  async remove(keys: string | string[]): Promise<void> {
    const keyArray = Array.isArray(keys) ? keys : [keys];
    for (const key of keyArray) {
      await Preferences.remove({ key });
    }
  }

  async clear(): Promise<void> {
    await Preferences.clear();
  }
}

export const storage = {
  local: new CapacitorStorage(),
  session: {
    data: new Map<string, unknown>(),
    async get(keys: string | string[] | Record<string, unknown> | null): Promise<Record<string, unknown>> {
      if (keys === null) {
        return Object.fromEntries(this.data);
      }
      if (typeof keys === 'string') {
        return keys in this.data ? { [keys]: this.data.get(keys) } : {};
      }
      if (Array.isArray(keys)) {
        const result: Record<string, unknown> = {};
        for (const key of keys) {
          if (this.data.has(key)) {
            result[key] = this.data.get(key);
          }
        }
        return result;
      }
      const result: Record<string, unknown> = {};
      for (const [key, defaultValue] of Object.entries(keys)) {
        result[key] = this.data.has(key) ? this.data.get(key) : defaultValue;
      }
      return result;
    },
    async set(items: Record<string, unknown>): Promise<void> {
      for (const [key, value] of Object.entries(items)) {
        this.data.set(key, value);
      }
    },
    async remove(keys: string | string[]): Promise<void> {
      const keyArray = Array.isArray(keys) ? keys : [keys];
      for (const key of keyArray) {
        this.data.delete(key);
      }
    },
    async clear(): Promise<void> {
      this.data.clear();
    }
  }
};
