const PAIRING_SERVER = 'https://pair.peach.dev';
const PAIRING_TIMEOUT = 5 * 60 * 1000;

export interface PairingSession {
  token: string;
  expiresAt: number;
  status: 'waiting' | 'completed' | 'expired';
  data?: {
    serverUrl: string;
    syncSecret: string;
  };
}

export async function createPairingSession(): Promise<PairingSession> {
  const token = Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  const session: PairingSession = {
    token,
    expiresAt: Date.now() + PAIRING_TIMEOUT,
    status: 'waiting'
  };

  await chrome.storage.session.set({
    [`pairing_${token}`]: session
  });

  return session;
}

export async function pollForPairingCompletion(token: string, serverUrl?: string): Promise<PairingSession['data'] | null> {
  const result = await chrome.storage.session.get(`pairing_${token}`);
  const session: PairingSession | undefined = result[`pairing_${token}`];

  if (!session) return null;

  if (Date.now() > session.expiresAt) {
    session.status = 'expired';
    await chrome.storage.session.set({ [`pairing_${token}`]: session });
    return null;
  }

  if (serverUrl) {
    try {
      let httpUrl = serverUrl;
      if (httpUrl.startsWith('ws')) httpUrl = httpUrl.replace('ws', 'http');
      if (!httpUrl.endsWith('/api')) httpUrl = `${httpUrl}/api`;

      const response = await fetch(`${httpUrl}/pair/${token}`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      });

      if (response.ok) {
        const data = await response.json();
        if (data.serverUrl && data.syncSecret) {
          session.status = 'completed';
          session.data = data;
          await chrome.storage.session.set({ [`pairing_${token}`]: session });
          return data;
        }
      }
    } catch (e) {
      console.error('Polling error:', e);
    }
  }

  return null;
}

export function generatePairingQRValue(token: string, serverUrl?: string): string {
  const baseUrl = serverUrl || PAIRING_SERVER;
  return `peach://pair?token=${token}&server=${encodeURIComponent(baseUrl)}`;
}

export async function completePairing(token: string, data: PairingSession['data'], serverUrl?: string): Promise<void> {
  const result = await chrome.storage.session.get(`pairing_${token}`);
  const session: PairingSession | undefined = result[`pairing_${token}`];

  if (!session) return;

  if (serverUrl) {
    try {
      let httpUrl = serverUrl;
      if (httpUrl.startsWith('ws')) httpUrl = httpUrl.replace('ws', 'http');
      if (!httpUrl.endsWith('/api')) httpUrl = `${httpUrl}/api`;

      await fetch(`${httpUrl}/pair/${token}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
      });
    } catch (e) {
      console.error('Complete pairing error:', e);
    }
  }

  session.status = 'completed';
  session.data = data;
  await chrome.storage.session.set({ [`pairing_${token}`]: session });
}
