import type { Vault } from '@lotus/shared'
import type { SecurityScore } from './sync-types'

export function computeSecurityScore(vault: Vault | null): SecurityScore {
  if (!vault || vault.entries.length === 0) {
    return { score: 0, maxScore: 100, weakPasswords: 0, reusedPasswords: 0, missingTotp: 0 }
  }

  const loginEntries = vault.entries.filter((entry) => entry.type === 'login' && entry.login)
  const total = loginEntries.length || 1
  const passwordCounts = new Map<string, number>()
  let weakPasswords = 0
  let missingTotp = 0

  for (const entry of loginEntries) {
    const raw = entry.login?.password || ''
    if (raw.length > 0) {
      passwordCounts.set(raw, (passwordCounts.get(raw) || 0) + 1)
      if (raw.length < 12) weakPasswords += 1
    }
    if (!entry.login?.totp) missingTotp += 1
  }

  const reusedPasswords = Array.from(passwordCounts.values()).filter((count) => count > 1).length
  const weakPenalty = Math.round((weakPasswords / total) * 35)
  const reusePenalty = Math.round((reusedPasswords / total) * 35)
  const totpPenalty = Math.round((missingTotp / total) * 30)
  const score = Math.max(0, 100 - weakPenalty - reusePenalty - totpPenalty)

  return {
    score,
    maxScore: 100,
    weakPasswords,
    reusedPasswords,
    missingTotp
  }
}
