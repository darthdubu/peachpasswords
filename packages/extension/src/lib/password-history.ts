const PASSWORD_HISTORY_KEY = 'lotus-password-history'
const MAX_HISTORY_ITEMS = 50

export interface PasswordHistoryItem {
  id: string
  password: string
  createdAt: number
  options: {
    length: number
    useNumbers: boolean
    useSymbols: boolean
    useUppercase: boolean
  }
}

export async function addToPasswordHistory(
  password: string,
  options: { length: number; useNumbers: boolean; useSymbols: boolean; useUppercase: boolean }
): Promise<void> {
  const history = await getPasswordHistory()
  
  const newItem: PasswordHistoryItem = {
    id: crypto.randomUUID(),
    password,
    createdAt: Date.now(),
    options
  }
  
  const updatedHistory = [newItem, ...history].slice(0, MAX_HISTORY_ITEMS)
  
  await chrome.storage.local.set({ [PASSWORD_HISTORY_KEY]: updatedHistory })
}

export async function getPasswordHistory(): Promise<PasswordHistoryItem[]> {
  const result = await chrome.storage.local.get(PASSWORD_HISTORY_KEY)
  return result[PASSWORD_HISTORY_KEY] || []
}

export async function deleteFromPasswordHistory(id: string): Promise<void> {
  const history = await getPasswordHistory()
  const updatedHistory = history.filter(item => item.id !== id)
  await chrome.storage.local.set({ [PASSWORD_HISTORY_KEY]: updatedHistory })
}

export async function clearPasswordHistory(): Promise<void> {
  await chrome.storage.local.remove(PASSWORD_HISTORY_KEY)
}
