import { useState, useEffect, useRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useVaultActions, useVaultState } from '../contexts/VaultContext'
import { useTheme, Theme, ColorScheme } from '../contexts/ThemeContext'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Switch } from './ui/switch'
import { Icons } from './icons'
import { STORAGE_KEYS } from '../../lib/constants'
import { cn } from '@/lib/utils'
import QRCode from 'react-qr-code'
import { parseImportFile, parseZipImport, isPGPEncryptedFile, decryptAndParseImportFile } from '../../lib/importers'
import { appendExtensionError, clearExtensionErrors, readExtensionErrors, type ExtensionErrorRecord } from '../../lib/error-log'
import { EncryptedSettings, loadVaultHeader } from '../../lib/crypto-utils'
import type { Share } from '@lotus/shared'
import { hasBiometricCredential, clearBiometricCredential, registerBiometric, getBiometricSupportInfo, getLastBiometricError } from '../../lib/biometric'
import { hasPin, clearPin, setPin } from '../../lib/pin'
import type { SecurityScore } from '../../lib/sync-types'
import { clearUnresolvedConflicts } from '../../lib/sync-conflicts'

type SettingsCategory = 'appearance' | 'security' | 'sync' | 'backup' | 'import' | 'errors'
type SettingsIconKey = keyof typeof Icons
const LAST_AUTH_METHOD_KEY = 'peach_last_auth_method'
const SETTINGS_CATEGORY_STATE_KEY = 'peach_settings_category'
const COLOR_SCHEME_OPTIONS: Array<{ value: ColorScheme; label: string; swatch: string }> = [
  { value: 'peach', label: 'Peach', swatch: 'hsl(15 90% 65%)' },
  { value: 'green', label: 'Green', swatch: 'hsl(142 71% 45%)' },
  { value: 'blue', label: 'Blue', swatch: 'hsl(217 91% 60%)' },
  { value: 'apple', label: 'Apple', swatch: 'hsl(2 77% 56%)' },
  { value: 'banana', label: 'Banana', swatch: 'hsl(48 96% 56%)' },
  { value: 'cherry', label: 'Cherry', swatch: 'hsl(350 78% 54%)' },
  { value: 'grape', label: 'Grape', swatch: 'hsl(268 83% 65%)' },
  { value: 'lemon', label: 'Lemon', swatch: 'hsl(55 96% 62%)' },
  { value: 'lime', label: 'Lime', swatch: 'hsl(96 61% 50%)' },
  { value: 'mango', label: 'Mango', swatch: 'hsl(32 95% 56%)' },
  { value: 'plum', label: 'Plum', swatch: 'hsl(295 44% 52%)' },
  { value: 'berry', label: 'Berry', swatch: 'hsl(330 72% 58%)' },
  { value: 'coconut', label: 'Coconut', swatch: 'hsl(30 24% 58%)' }
]

interface SettingsCategoryMeta {
  id: SettingsCategory
  label: string
  description: string
  icon: SettingsIconKey
}

function SettingsRailItem({
  label,
  icon,
  active,
  onClick
}: {
  label: string
  icon: SettingsIconKey
  active: boolean
  onClick: () => void
}) {
  const IconComponent = Icons[icon] as React.ComponentType<{ className?: string }>
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all duration-200",
        active
          ? "bg-white/[0.08] text-white shadow-sm"
          : "text-white/50 hover:text-white/80 hover:bg-white/[0.04]"
      )}
    >
      {IconComponent ? <IconComponent className={cn("h-4 w-4", active ? "text-primary" : "text-white/40")} /> : null}
      <span className="text-left font-medium">{label}</span>
    </button>
  )
}

function SettingsSectionCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
      <div className="mb-4">
        <h4 className="text-sm font-medium text-white/90">{title}</h4>
        {subtitle ? <p className="mt-1 text-xs text-white/40">{subtitle}</p> : null}
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  )
}

function SettingsStatusRow({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: 'neutral' | 'good' | 'warn' | 'bad' }) {
  const toneClass =
    tone === 'good' ? 'text-emerald-400'
      : tone === 'warn' ? 'text-amber-400'
      : tone === 'bad' ? 'text-red-400'
      : 'text-white/50'
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-white/50">{label}</span>
      <span className={toneClass}>{value}</span>
    </div>
  )
}

export function Settings({ onBack }: { onBack: () => void }) {
  const { syncStatus, s3SyncStatus, lastSyncTime, s3LastSyncTime, s3IsSyncing, vault, masterKey, syncTimeline, unresolvedConflicts } = useVaultState()
  const { lockVault, importEntries, decryptValue, encryptSettingsData, decryptSettingsData, refreshSyncTimeline, refreshUnresolvedConflicts } = useVaultActions()
  const { theme, setTheme, colorScheme, setColorScheme } = useTheme()
  const [activeCategory, setActiveCategory] = useState<SettingsCategory>('appearance')
  
  const [serverUrl, setServerUrl] = useState('')
  const [syncSecret, setSyncSecret] = useState('')
  const [showQR, setShowQR] = useState(false)
  const [importStatus, setImportStatus] = useState('')
  const [importMode, setImportMode] = useState<'append' | 'merge'>('merge')
  const [importPreview, setImportPreview] = useState<{
    fileName: string
    fileType: 'csv' | 'json' | 'zip' | 'pgp' | 'unknown'
    entryCount: number
    errorCount: number
    zipTotalFiles?: number
    zipSupportedFiles?: number
    isPGPEncrypted?: boolean
  } | null>(null)
  const [importPreviewErrors, setImportPreviewErrors] = useState<string[]>([])
  const [pgpPassphrase, setPgpPassphrase] = useState('')
  const [showPgpPrompt, setShowPgpPrompt] = useState(false)
  const [pendingImportFile, setPendingImportFile] = useState<File | null>(null)
  const [pendingImportContent, setPendingImportContent] = useState<string>('')
  const importPreviewEntriesRef = useRef<ReturnType<typeof parseImportFile>['entries']>([])
  const [s3Endpoint, setS3Endpoint] = useState('https://s3.fr-par.scw.cloud')
  const [s3Region, setS3Region] = useState('fr-par')
  const [s3AccessKey, setS3AccessKey] = useState('')
  const [s3SecretKey, setS3SecretKey] = useState('')
  const [s3Bucket, setS3Bucket] = useState('')
  const [idleTimeoutMinutes, setIdleTimeoutMinutes] = useState(5)
  const [trashRetentionDays, setTrashRetentionDays] = useState(30)
  const [hasBiometric, setHasBiometric] = useState(false)
  const [pinEnabled, setPinEnabled] = useState(false)
  const [pinInput, setPinInput] = useState('')
  const [isSettingPin, setIsSettingPin] = useState(false)
  // LOTUS-007: Password prompt for biometric/PIN setup (no longer storing masterKeyRaw in session)
  const [passwordPromptOpen, setPasswordPromptOpen] = useState(false)
  const [passwordPromptValue, setPasswordPromptValue] = useState('')
  const [passwordPromptFor, setPasswordPromptFor] = useState<'biometric' | 'pin' | null>(null)
  const [passwordPromptError, setPasswordPromptError] = useState<string | null>(null)
  const [isPasswordVerifying, setIsPasswordVerifying] = useState(false)
  const [pairingToken, setPairingToken] = useState<string | null>(null)
  const [pairingQR, setPairingQR] = useState<string | null>(null)
  const [isPairing, setIsPairing] = useState(false)
  const [saveSyncMessage, setSaveSyncMessage] = useState<string | null>(null)
  const [s3TestMessage, setS3TestMessage] = useState<string | null>(null)
  const [isTestingS3, setIsTestingS3] = useState(false)
  const [autoCopyTotpEnabled, setAutoCopyTotpEnabled] = useState(true)
  const [securityScore, setSecurityScore] = useState<SecurityScore>({
    score: 0,
    maxScore: 100,
    weakPasswords: 0,
    reusedPasswords: 0,
    missingTotp: 0
  })
  const [securityScoreLoading, setSecurityScoreLoading] = useState(false)
  const [extensionErrors, setExtensionErrors] = useState<ExtensionErrorRecord[]>([])

  useEffect(() => {
    const loadSettings = async () => {
      const result = await chrome.storage.local.get([STORAGE_KEYS.SETTINGS, STORAGE_KEYS.AUTO_COPY_TOTP])
      const settingsData = result[STORAGE_KEYS.SETTINGS]
      const storedAutoCopyTotp = result[STORAGE_KEYS.AUTO_COPY_TOTP]
      if (typeof storedAutoCopyTotp === 'boolean') {
        setAutoCopyTotpEnabled(storedAutoCopyTotp)
      } else {
        setAutoCopyTotpEnabled(true)
      }
      if (settingsData) {
        if (settingsData.encrypted) {
          const decrypted = await decryptSettingsData(settingsData.encrypted as EncryptedSettings)
          if (decrypted) {
            setServerUrl(decrypted.serverUrl || '')
            setSyncSecret(decrypted.syncSecret || '')
            setS3Endpoint(decrypted.s3Endpoint || 'https://s3.fr-par.scw.cloud')
            setS3Region(decrypted.s3Region || 'fr-par')
            setS3AccessKey(decrypted.s3AccessKey || '')
            setS3SecretKey(decrypted.s3SecretKey || '')
            setS3Bucket(decrypted.s3Bucket || '')
            setIdleTimeoutMinutes(Number(decrypted.idleTimeoutMinutes) || 5)
            setTrashRetentionDays(Number(decrypted.trashRetentionDays) || 30)
          }
        } else {
          setServerUrl(settingsData.serverUrl || '')
          setSyncSecret(settingsData.syncSecret || '')
          setS3Endpoint(settingsData.s3Endpoint || 'https://s3.fr-par.scw.cloud')
          setS3Region(settingsData.s3Region || 'fr-par')
          setS3AccessKey(settingsData.s3AccessKey || '')
          setS3SecretKey(settingsData.s3SecretKey || '')
          setS3Bucket(settingsData.s3Bucket || '')
          setIdleTimeoutMinutes(settingsData.idleTimeoutMinutes || 5)
          setTrashRetentionDays(Number(settingsData.trashRetentionDays) || 30)
        }
      }
      
      const biometricEnabled = await hasBiometricCredential()
      setHasBiometric(biometricEnabled)
      
      const pinEnabled = await hasPin()
      setPinEnabled(pinEnabled)
    }
    loadSettings()
  }, [decryptSettingsData])

  useEffect(() => {
    chrome.storage.session.get([SETTINGS_CATEGORY_STATE_KEY]).then((result) => {
      const saved = result[SETTINGS_CATEGORY_STATE_KEY] as SettingsCategory | undefined
      if (saved) setActiveCategory(saved)
    })
  }, [])

  useEffect(() => {
    if (!isPairing || !pairingToken) return

    const pollInterval = setInterval(async () => {
      const { pollForPairingCompletion } = await import('../../lib/pairing')
      const data = await pollForPairingCompletion(pairingToken, serverUrl || undefined)
      
      if (data) {
        setServerUrl(data.serverUrl)
        setSyncSecret(data.syncSecret)
        setIsPairing(false)
        setPairingToken(null)
        setPairingQR(null)
        await handleSave()
        alert('Configuration received from phone!')
      }
    }, 2000)

    const timeout = setTimeout(() => {
      setIsPairing(false)
      setPairingToken(null)
      setPairingQR(null)
      clearInterval(pollInterval)
    }, 5 * 60 * 1000)

    return () => {
      clearInterval(pollInterval)
      clearTimeout(timeout)
    }
  }, [isPairing, pairingToken])

  useEffect(() => {
    void refreshSyncTimeline()
  }, [refreshSyncTimeline, syncStatus, s3SyncStatus, lastSyncTime, s3LastSyncTime])

  useEffect(() => {
    if (activeCategory !== 'security') return

    let active = true
    const compute = async () => {
      setSecurityScoreLoading(true)
      try {
        if (!vault) {
          if (active) {
            setSecurityScore({
              score: 0,
              maxScore: 100,
              weakPasswords: 0,
              reusedPasswords: 0,
              missingTotp: 0
            })
          }
          return
        }

        const logins = vault.entries.filter((entry) => entry.type === 'login' && entry.login)
        const passwordCounts = new Map<string, number>()
        let weakPasswords = 0
        let missingTotp = 0

        for (const entry of logins) {
          const encryptedOrPlain = entry.login?.password || ''
          let plain = encryptedOrPlain
          if (encryptedOrPlain) {
            try {
              plain = await decryptValue(encryptedOrPlain, entry.id, entry.modified)
            } catch {
              // Keep fallback value if decryption isn't available for this record.
            }
          }

          if (plain) {
            passwordCounts.set(plain, (passwordCounts.get(plain) || 0) + 1)
            if (plain.length < 12) weakPasswords += 1
          }
          if (!entry.login?.totp) missingTotp += 1
        }

        const total = logins.length || 1
        const reusedPasswords = Array.from(passwordCounts.values()).filter((count) => count > 1).length
        const weakPenalty = Math.round((weakPasswords / total) * 35)
        const reusePenalty = Math.round((reusedPasswords / total) * 35)
        const totpPenalty = Math.round((missingTotp / total) * 30)
        const score = Math.max(0, 100 - weakPenalty - reusePenalty - totpPenalty)

        if (active) {
          setSecurityScore({
            score,
            maxScore: 100,
            weakPasswords,
            reusedPasswords,
            missingTotp
          })
        }
      } finally {
        if (active) setSecurityScoreLoading(false)
      }
    }

    void compute()
    return () => {
      active = false
    }
  }, [activeCategory, vault, decryptValue])

  const handleSave = async () => {
    try {
      setSaveSyncMessage(null)
      const settingsToEncrypt = {
        serverUrl: serverUrl.trim(),
        syncSecret: syncSecret.trim(),
        s3Endpoint: s3Endpoint.trim(),
        s3Region: s3Region.trim(),
        s3AccessKey: s3AccessKey.trim(),
        s3SecretKey: s3SecretKey.trim(),
        s3Bucket: s3Bucket.trim(),
        idleTimeoutMinutes: String(idleTimeoutMinutes),
        trashRetentionDays: String(trashRetentionDays)
      }

      const encrypted = await encryptSettingsData(settingsToEncrypt)
      if (encrypted) {
        await chrome.storage.local.set({
          [STORAGE_KEYS.SETTINGS]: {
            encrypted,
            hasCredentials: !!(settingsToEncrypt.s3AccessKey || settingsToEncrypt.s3SecretKey || settingsToEncrypt.syncSecret)
          }
        })
      } else {
        await chrome.storage.local.set({
          [STORAGE_KEYS.SETTINGS]: settingsToEncrypt
        })
      }

      const s3Config = {
        s3Endpoint: settingsToEncrypt.s3Endpoint,
        s3Region: settingsToEncrypt.s3Region,
        s3AccessKey: settingsToEncrypt.s3AccessKey,
        s3SecretKey: settingsToEncrypt.s3SecretKey,
        s3Bucket: settingsToEncrypt.s3Bucket
      }
      if (s3Config.s3Endpoint && s3Config.s3AccessKey && s3Config.s3SecretKey && s3Config.s3Bucket) {
        await chrome.storage.local.set({ [STORAGE_KEYS.AUTO_COPY_TOTP]: autoCopyTotpEnabled })
        await chrome.storage.session.set({ s3SyncConfig: s3Config })
        await chrome.runtime.sendMessage({ type: 'S3_SYNC_START' }).catch(() => {})
        const nowResponse = await chrome.runtime.sendMessage({ type: 'S3_SYNC_NOW' }).catch((err: unknown) => ({ success: false, error: err instanceof Error ? err.message : 'S3 sync failed' }))
        if (nowResponse?.success === false) {
          setSaveSyncMessage(`Saved, but initial S3 sync failed: ${String(nowResponse.error || 'unknown error')}`)
        } else {
          setSaveSyncMessage('Sync configuration saved.')
        }
      } else {
        await chrome.storage.local.set({ [STORAGE_KEYS.AUTO_COPY_TOTP]: autoCopyTotpEnabled })
        await chrome.storage.session.remove('s3SyncConfig')
        await chrome.runtime.sendMessage({ type: 'S3_SYNC_STOP' }).catch(() => {})
        setSaveSyncMessage('Saved. Add all S3 fields to enable S3 sync.')
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      setSaveSyncMessage(`Failed to save sync configuration: ${msg}`)
    }
  }

  const handleTestS3Connection = async () => {
    setIsTestingS3(true)
    setS3TestMessage(null)
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'S3_SYNC_TEST',
        config: {
          s3Endpoint: s3Endpoint.trim(),
          s3Region: s3Region.trim(),
          s3AccessKey: s3AccessKey.trim(),
          s3SecretKey: s3SecretKey.trim(),
          s3Bucket: s3Bucket.trim()
        }
      }).catch((err: unknown) => ({ success: false, error: err instanceof Error ? err.message : 'Connection test failed' }))

      if (response?.success) {
        setS3TestMessage('S3 connection successful.')
      } else {
        setS3TestMessage(`S3 connection failed: ${String(response?.error || 'unknown error')}`)
      }
    } finally {
      setIsTestingS3(false)
    }
  }

  const handleBiometricSetup = async () => {
    // LOTUS-007: Prompt for password instead of using stored masterKeyRaw
    setPasswordPromptFor('biometric')
    setPasswordPromptOpen(true)
    setPasswordPromptValue('')
    setPasswordPromptError(null)
  }

  const verifyPasswordAndEnableBiometric = async () => {
    if (!passwordPromptValue || !masterKey) return
    setIsPasswordVerifying(true)
    setPasswordPromptError(null)
    try {
      const support = getBiometricSupportInfo()
      if (!support.supported) {
        setPasswordPromptError(`Touch ID not supported in this context (${support.reason || 'unsupported'}).`)
        return
      }

      // Derive key from password to get raw bytes
      const result = await chrome.storage.local.get(['salt'])
      if (!result.salt) {
        setPasswordPromptError('Salt not found. Please try again.')
        return
      }
      const salt = new Uint8Array(result.salt)
      const vaultHeader = await loadVaultHeader()
      const { attemptVaultUnlockWithMigration } = await import('../../lib/crypto-utils')
      const unlockAttempt = await attemptVaultUnlockWithMigration(passwordPromptValue, salt, vaultHeader)
      if (!unlockAttempt.success || !unlockAttempt.result) {
        setPasswordPromptError('Incorrect password')
        return
      }
      const { rawBytes } = unlockAttempt.result

      const success = await registerBiometric(masterKey, rawBytes.slice().buffer)
      if (success) {
        setHasBiometric(true)
        await chrome.storage.local.set({ [LAST_AUTH_METHOD_KEY]: 'biometric' })
        setPasswordPromptOpen(false)
        setPasswordPromptValue('')
        alert('Touch ID enabled successfully!')
      } else {
        const biometricError = getLastBiometricError()
        const supportInfo = getBiometricSupportInfo()
        
        if (supportInfo.reason === 'ungoogled-chromium') {
          setPasswordPromptError(
            'Touch ID is not available in Ungoogled Chromium (WebAuthn platform authenticators are disabled). Please use PIN unlock instead, or use standard Chrome/Chromium.'
          )
        } else {
          setPasswordPromptError(
            biometricError
              ? `Failed to enable Touch ID: ${biometricError}`
              : 'Failed to enable Touch ID. If the popup says your device cannot be used, your current authenticator likely does not support PRF on this context. Keep using PIN/password and try Chrome + latest macOS with iCloud Keychain enabled.'
          )
        }
      }
    } catch (e) {
      console.error(e)
      setPasswordPromptError('Error enabling Touch ID')
    } finally {
      setIsPasswordVerifying(false)
    }
  }

  const verifyPasswordAndEnablePin = async () => {
    if (!passwordPromptValue) return
    setIsPasswordVerifying(true)
    setPasswordPromptError(null)
    try {
      // Derive key from password to get raw bytes
      const result = await chrome.storage.local.get(['salt'])
      if (!result.salt) {
        setPasswordPromptError('Salt not found. Please try again.')
        return
      }
      const salt = new Uint8Array(result.salt)
      const vaultHeader = await loadVaultHeader()
      const { attemptVaultUnlockWithMigration } = await import('../../lib/crypto-utils')
      const unlockAttempt = await attemptVaultUnlockWithMigration(passwordPromptValue, salt, vaultHeader)
      if (!unlockAttempt.success || !unlockAttempt.result) {
        setPasswordPromptError('Incorrect password')
        return
      }
      const { rawBytes } = unlockAttempt.result

      await setPin(pinInput, rawBytes)
      setPinEnabled(true)
      setIsSettingPin(false)
      setPinInput('')
      setPasswordPromptOpen(false)
      setPasswordPromptValue('')
      alert('PIN enabled successfully!')
    } catch (e) {
      console.error(e)
      setPasswordPromptError('Error enabling PIN')
    } finally {
      setIsPasswordVerifying(false)
    }
  }

  const handleBiometricDisable = async () => {
    await clearBiometricCredential()
    setHasBiometric(false)
  }

  const handleExport = async () => {
    if (!vault) return
    
    const exportData = await Promise.all(vault.entries.map(async (entry) => {
      const exported = { ...entry }
      if (exported.login?.password) {
        try {
          exported.login = { ...exported.login }
          exported.login.password = await decryptValue(entry.login!.password, entry.id, entry.modified)
        } catch (e) {
          console.error('Failed to decrypt password for export', e)
        }
      }
      return exported
    }))
    
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `peach-export-${new Date().toISOString().split('T')[0]}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const handleExportCsv = async () => {
    if (!vault) return
    
    const loginEntries = vault.entries.filter(e => e.type === 'login')
    const csvRows = await Promise.all(loginEntries.map(async (entry) => {
      let password = ''
      if (entry.login?.password) {
        try {
          password = await decryptValue(entry.login.password, entry.id, entry.modified)
        } catch {}
      }
      const fields = [
        entry.name,
        entry.login?.username || '',
        password,
        (entry.login?.urls || []).join(', '),
        entry.favorite ? 'yes' : 'no'
      ]
      return fields.map(field => `"${(field || '').replace(/"/g, '""')}"`).join(',')
    }))
    
    const csv = ['Name,Username,Password,URLs,Favorite', ...csvRows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `peach-export-${new Date().toISOString().split('T')[0]}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const handleExportEmergencyKit = () => {
    const kit = `
PEACH PASSWORD MANAGER - EMERGENCY KIT
======================================

Generated: ${new Date().toLocaleString()}

IMPORTANT INFORMATION:
- Your vault is encrypted with your master password
- Without your master password, your data cannot be recovered
- Keep this emergency kit in a safe place

RECOVERY OPTIONS:
1. Master Password: The password you use to unlock your vault
2. Recovery Key: If generated, found in Settings > Security > Recovery Key

SUPPORT:
- Extension Version: ${chrome.runtime.getManifest().version}
- For help, contact support

KEEP THIS DOCUMENT SECURE AND CONFIDENTIAL.
    `.trim()
    
    const blob = new Blob([kit], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'peach-emergency-kit.txt'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setImportStatus('Parsing...')
    try {
      const lowerName = file.name.toLowerCase()
      let entries: ReturnType<typeof parseImportFile>['entries'] = []
      let errors: string[] = []
      let zipTotalFiles: number | undefined
      let zipSupportedFiles: number | undefined
      let isPGPEncrypted = false

      if (lowerName.endsWith('.zip')) {
        const parsedZip = await parseZipImport(await file.arrayBuffer(), file.name)
        entries = parsedZip.entries
        errors = parsedZip.errors
        zipTotalFiles = parsedZip.totalFiles
        zipSupportedFiles = parsedZip.supportedFiles
      } else {
        const content = await file.text()
        
        if (isPGPEncryptedFile(content)) {
          isPGPEncrypted = true
          setPendingImportFile(file)
          setPendingImportContent(content)
          setShowPgpPrompt(true)
          setImportStatus('PGP-encrypted file detected. Please enter your passphrase.')
          setImportPreview({
            fileName: file.name,
            fileType: 'pgp',
            entryCount: 0,
            errorCount: 0,
            isPGPEncrypted: true
          })
          return
        }
        
        const parsed = parseImportFile(content, file.name)
        entries = parsed.entries
        errors = parsed.errors
      }

      importPreviewEntriesRef.current = entries
      setImportPreviewErrors(errors.slice(0, 8))
      setImportPreview({
        fileName: file.name,
        fileType: lowerName.endsWith('.zip')
          ? 'zip'
          : lowerName.endsWith('.json')
            ? 'json'
            : lowerName.endsWith('.csv')
              ? 'csv'
              : isPGPEncrypted ? 'pgp' : 'unknown',
        entryCount: entries.length,
        errorCount: errors.length,
        zipTotalFiles,
        zipSupportedFiles,
        isPGPEncrypted
      })
      setImportStatus(entries.length > 0 ? `Ready to import ${entries.length} entries.` : 'No valid entries found.')
    } catch (err) {
      console.error(err)
      setImportStatus('Failed to import file.')
      void appendExtensionError({
        source: 'import',
        category: 'import-failed',
        message: err instanceof Error ? err.message : 'Unknown import error',
        details: file.name
      })
    }
  }

  const handlePgpDecrypt = async () => {
    if (!pendingImportFile || !pendingImportContent || !pgpPassphrase) return
    
    setImportStatus('Decrypting PGP file...')
    try {
      const parsed = await decryptAndParseImportFile(pendingImportContent, pgpPassphrase, pendingImportFile.name)
      
      importPreviewEntriesRef.current = parsed.entries
      setImportPreviewErrors(parsed.errors.slice(0, 8))
      setImportPreview({
        fileName: pendingImportFile.name,
        fileType: 'json',
        entryCount: parsed.entries.length,
        errorCount: parsed.errors.length,
        isPGPEncrypted: false
      })
      setImportStatus(parsed.entries.length > 0 ? `Ready to import ${parsed.entries.length} entries.` : 'No valid entries found.')
      setShowPgpPrompt(false)
      setPgpPassphrase('')
      setPendingImportFile(null)
      setPendingImportContent('')
    } catch (err) {
      console.error(err)
      setImportStatus('Failed to decrypt PGP file. Check your passphrase.')
      void appendExtensionError({
        source: 'import',
        category: 'pgp-decrypt-failed',
        message: err instanceof Error ? err.message : 'PGP decryption failed',
        details: pendingImportFile.name
      })
    }
  }

  const applyImportPreview = async () => {
    const entries = importPreviewEntriesRef.current
    if (!importPreview || entries.length === 0) return
    setImportStatus(`Importing ${entries.length} entries...`)
    const result = await importEntries(entries, { mode: importMode })
    const mergedSuffix = importMode === 'merge'
      ? ` (created ${result.created}, merged ${result.merged}, skipped ${result.skipped})`
      : ''
    setImportStatus(`Success: Imported ${entries.length} entries.${mergedSuffix}`)
    if (importPreview.errorCount > 0) {
      void appendExtensionError({
        source: 'import',
        category: 'import-parse',
        message: `${importPreview.errorCount} rows/items skipped during import`,
        details: importPreviewErrors.join(' | ')
      })
    }
    importPreviewEntriesRef.current = []
    setImportPreview(null)
    setImportPreviewErrors([])
  }

  const cancelImportPreview = () => {
    importPreviewEntriesRef.current = []
    setImportPreview(null)
    setImportPreviewErrors([])
    setImportStatus('Import cancelled.')
  }

  const categories: SettingsCategoryMeta[] = [
    { id: 'appearance', label: 'Appearance', description: 'Theme and accent styling', icon: 'settings' },
    { id: 'security', label: 'Security', description: 'Unlock controls and score', icon: 'lock' },
    { id: 'sync', label: 'Sync', description: 'Server, S3, and timeline', icon: 'cloud' },
    { id: 'backup', label: 'Backup', description: 'Export encrypted data', icon: 'download' },
    { id: 'import', label: 'Import', description: 'Bring data from exports', icon: 'plus' },
    { id: 'errors', label: 'Errors', description: 'Diagnostics and runtime logs', icon: 'shield' }
  ]

  const activeCategoryMeta = categories.find((category) => category.id === activeCategory) || categories[0]
  const selectedAccentLabel = COLOR_SCHEME_OPTIONS.find((option) => option.value === colorScheme)?.label || 'Peach'

  const renderCategoryContent = () => {
    if (activeCategory === 'appearance') {
      return (
        <SettingsSectionCard title="Visual Style" subtitle="Tune the look and feel of Peach">
          <div className="grid grid-cols-1 gap-3">
            <div className="space-y-1.5">
              <Label>Theme</Label>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring text-foreground"
                value={theme}
                onChange={(e) => setTheme(e.target.value as Theme)}
              >
                <option value="dark" className="bg-background text-foreground">Dark</option>
                <option value="light" className="bg-background text-foreground">Light</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label>Accent Color</Label>
                <span className="text-[11px] text-muted-foreground">Selected: {selectedAccentLabel}</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {COLOR_SCHEME_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setColorScheme(option.value)}
                    className={`flex items-center justify-start gap-2 rounded-md border px-2.5 py-2 text-xs transition-colors ${
                      colorScheme === option.value
                        ? 'border-primary/60 bg-primary/10 text-foreground'
                        : 'border-border/70 bg-background/50 text-muted-foreground hover:text-foreground hover:bg-muted/60'
                    }`}
                    title={option.label}
                  >
                    <span
                      className="h-3 w-3 rounded-full border border-black/20"
                      style={{ backgroundColor: option.swatch }}
                    />
                    <span>{option.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </SettingsSectionCard>
      )
    }

    if (activeCategory === 'security') {
      return (
        <>
          <SettingsSectionCard title="Session Locking" subtitle="Control how long Peach stays unlocked">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Auto-lock grace period</Label>
                <span className="text-xs text-muted-foreground">{idleTimeoutMinutes} min</span>
              </div>
              <input
                type="range"
                min="1"
                max="60"
                value={idleTimeoutMinutes}
                onChange={(e) => setIdleTimeoutMinutes(Number(e.target.value))}
                className="w-full h-2 bg-secondary rounded-lg appearance-none cursor-pointer accent-primary"
              />
              <p className="text-xs text-muted-foreground">
                Time before vault auto-locks after popup close.
              </p>
            </div>
            <div className="space-y-2 border-t border-border/60 pt-3">
              <div className="flex items-center justify-between">
                <Label>Trash retention</Label>
                <span className="text-xs text-muted-foreground">{trashRetentionDays} day{trashRetentionDays === 1 ? '' : 's'}</span>
              </div>
              <input
                type="range"
                min="1"
                max="90"
                value={trashRetentionDays}
                onChange={(e) => setTrashRetentionDays(Number(e.target.value))}
                className="w-full h-2 bg-secondary rounded-lg appearance-none cursor-pointer accent-primary"
              />
              <p className="text-xs text-muted-foreground">
                Trashed entries are auto-cleared after this period.
              </p>
            </div>
          </SettingsSectionCard>

          <SettingsSectionCard title="Quick Unlock" subtitle="Biometric and PIN convenience">
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Touch ID</Label>
                {hasBiometric ? (
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs text-muted-foreground">Enabled for this vault</p>
                    <Button onClick={handleBiometricDisable} variant="outline" size="sm">Disable</Button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs text-muted-foreground">Use biometric unlock when available</p>
                    <Button
                      onClick={handleBiometricSetup}
                      variant="outline"
                      size="sm"
                      disabled={(isPasswordVerifying && passwordPromptFor === 'biometric') || !masterKey}
                    >
                      {(isPasswordVerifying && passwordPromptFor === 'biometric') ? <Icons.refresh className="mr-2 h-4 w-4 animate-spin" /> : <Icons.fingerprint className="mr-2 h-4 w-4" />}
                      Enable
                    </Button>
                  </div>
                )}
              </div>

              <div className="space-y-1.5 border-t border-border/60 pt-3">
                <Label>PIN unlock</Label>
                {pinEnabled ? (
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs text-muted-foreground">PIN unlock is enabled</p>
                    <Button
                      onClick={async () => {
                        await clearPin()
                        setPinEnabled(false)
                      }}
                      variant="outline"
                      size="sm"
                    >
                      Disable
                    </Button>
                  </div>
                ) : isSettingPin ? (
                  <div className="space-y-2">
                    <Input
                      type="password"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={6}
                      placeholder="Enter 6-digit PIN"
                      value={pinInput}
                      onChange={(e) => setPinInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      className="h-9 text-center text-lg tracking-widest"
                    />
                    <div className="flex gap-2">
                      <Button
                        onClick={() => {
                          setIsSettingPin(false)
                          setPinInput('')
                        }}
                        variant="outline"
                        size="sm"
                        className="flex-1"
                      >
                        Cancel
                      </Button>
                      <Button
                        onClick={async () => {
                          if (pinInput.length !== 6) {
                            alert('PIN must be 6 digits')
                            return
                          }
                          // LOTUS-007: Prompt for password instead of using stored masterKeyRaw
                          setPasswordPromptFor('pin')
                          setPasswordPromptOpen(true)
                          setPasswordPromptValue('')
                          setPasswordPromptError(null)
                        }}
                        size="sm"
                        className="flex-1"
                        disabled={pinInput.length !== 6}
                      >
                        Save PIN
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs text-muted-foreground">Set a 6-digit PIN for faster unlock</p>
                    <Button
                      onClick={() => setIsSettingPin(true)}
                      variant="outline"
                      size="sm"
                      disabled={!masterKey}
                    >
                      Enable
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </SettingsSectionCard>

          <SettingsSectionCard title="Autofill TOTP" subtitle="One-time code behavior after login field input/fill">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-medium text-foreground">Auto-copy TOTP to clipboard</p>
                <p className="text-[11px] text-muted-foreground">
                  Copies matching one-time code after username/password is entered or Peach fills login.
                </p>
              </div>
              <Switch
                checked={autoCopyTotpEnabled}
                onCheckedChange={(checked) => setAutoCopyTotpEnabled(checked)}
              />
            </div>
            <Button onClick={handleSave} variant="outline" size="sm" className="w-full">
              Save Autofill Preferences
            </Button>
          </SettingsSectionCard>

          <RecoveryKeySection />

          <SettingsSectionCard title="Security Score" subtitle="Snapshot of vault hygiene">
            {securityScoreLoading ? (
              <p className="text-sm text-muted-foreground">Calculating score...</p>
            ) : (
              <>
                <div className="flex items-center justify-between rounded-md bg-muted/50 px-2 py-1.5">
                  <span className="text-xs text-muted-foreground">Current score</span>
                  <span className="text-sm font-semibold">{securityScore.score}/{securityScore.maxScore}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Weak passwords: {securityScore.weakPasswords} · Reused passwords: {securityScore.reusedPasswords} · Missing 2FA: {securityScore.missingTotp}
                </p>
              </>
            )}
            <Button onClick={handleSave} variant="outline" size="sm" className="w-full">Save Security Settings</Button>
          </SettingsSectionCard>
        </>
      )
    }

    if (activeCategory === 'sync') {
      return (
        <>
          <SettingsSectionCard title="Local Server" subtitle="LAN sync endpoint and shared secret">
            <div className="space-y-2">
              <Label>Server URL</Label>
              <Input
                value={serverUrl}
                onChange={(e) => setServerUrl(e.target.value)}
                placeholder="ws://localhost:8743"
              />
              <p className="text-xs text-muted-foreground">URL of your local Peach server.</p>
            </div>
            <div className="space-y-2">
              <Label>Sync Secret</Label>
              <Input
                type="password"
                value={syncSecret}
                onChange={(e) => setSyncSecret(e.target.value)}
                placeholder="peach-local-secret"
              />
              <p className="text-xs text-muted-foreground">Secret key configured on your server.</p>
            </div>
          </SettingsSectionCard>

          <SettingsSectionCard title="S3 Continuous Sync" subtitle="Encrypted blob background sync">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Endpoint</Label>
                <Input value={s3Endpoint} onChange={(e) => setS3Endpoint(e.target.value)} className="h-8 text-xs" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Region</Label>
                <Input value={s3Region} onChange={(e) => setS3Region(e.target.value)} className="h-8 text-xs" />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Bucket Name</Label>
              <Input value={s3Bucket} onChange={(e) => setS3Bucket(e.target.value)} className="h-8 text-xs" placeholder="my-peach-sync" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Access Key ID</Label>
              <Input value={s3AccessKey} onChange={(e) => setS3AccessKey(e.target.value)} className="h-8 text-xs" type="password" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Secret Access Key</Label>
              <Input value={s3SecretKey} onChange={(e) => setS3SecretKey(e.target.value)} className="h-8 text-xs" type="password" />
            </div>
            <div className="grid grid-cols-2 gap-2 pt-1">
              <Button onClick={handleSave} className="w-full">Save</Button>
              <Button
                onClick={handleTestS3Connection}
                variant="outline"
                className="w-full"
                disabled={isTestingS3}
              >
                {isTestingS3 ? 'Testing...' : 'Test Connection'}
              </Button>
            </div>
            {saveSyncMessage ? (
              <p className={`text-xs ${/failed/i.test(saveSyncMessage) ? 'text-red-500' : /initial s3 sync failed/i.test(saveSyncMessage) ? 'text-amber-500' : 'text-muted-foreground'}`}>
                {saveSyncMessage}
              </p>
            ) : null}
            {s3TestMessage ? (
              <p className={`text-xs ${/failed/i.test(s3TestMessage) ? 'text-red-500' : 'text-muted-foreground'}`}>
                {s3TestMessage}
              </p>
            ) : null}
          </SettingsSectionCard>

          <SettingsSectionCard title="Sync Health" subtitle="Status and last run times">
            <SettingsStatusRow
              label="Local sync"
              value={syncStatus.charAt(0).toUpperCase() + syncStatus.slice(1)}
              tone={syncStatus === 'connected' ? 'good' : syncStatus === 'connecting' ? 'warn' : syncStatus === 'error' ? 'bad' : 'neutral'}
            />
            <SettingsStatusRow
              label="S3 sync"
              value={s3SyncStatus.charAt(0).toUpperCase() + s3SyncStatus.slice(1)}
              tone={s3SyncStatus === 'connected' ? 'good' : s3SyncStatus === 'connecting' ? 'warn' : s3SyncStatus === 'error' ? 'bad' : 'neutral'}
            />
            <SettingsStatusRow label="Last local sync" value={lastSyncTime ? new Date(lastSyncTime).toLocaleTimeString() : 'Never'} />
            <SettingsStatusRow label="Last S3 sync" value={s3LastSyncTime ? new Date(s3LastSyncTime).toLocaleTimeString() : 'Never'} />
            <SettingsStatusRow label="S3 activity" value={s3IsSyncing ? 'Syncing now...' : 'Idle'} />
          </SettingsSectionCard>

          <SettingsSectionCard title="Sync Timeline" subtitle="Recent sync events for confidence and troubleshooting">
            <div className="flex justify-end">
              <Button size="sm" variant="outline" onClick={() => void refreshSyncTimeline()}>Refresh</Button>
            </div>
            <div className="max-h-40 overflow-y-auto scrollbar-hide space-y-1 pr-1">
              {syncTimeline.length === 0 ? (
                <p className="text-xs text-muted-foreground">No sync events yet.</p>
              ) : (
                syncTimeline.slice(0, 20).map((evt) => (
                  <div key={evt.id} className="rounded border border-border/50 p-2 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className={evt.status === 'error' ? 'text-red-500' : evt.status === 'warning' ? 'text-amber-500' : 'text-foreground'}>
                        {evt.type}
                      </span>
                      <span className="text-muted-foreground">{new Date(evt.timestamp).toLocaleTimeString()}</span>
                    </div>
                    <div className="mt-0.5 text-muted-foreground">{evt.detail}</div>
                  </div>
                ))
              )}
            </div>
          </SettingsSectionCard>

          <SettingsSectionCard title="Conflict Resolution" subtitle="Manual review required for ambiguous sync merges">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                {unresolvedConflicts.length} unresolved conflict{unresolvedConflicts.length === 1 ? '' : 's'}
              </p>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => void refreshUnresolvedConflicts()}>
                  Refresh
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={unresolvedConflicts.length === 0}
                  onClick={async () => {
                    await clearUnresolvedConflicts()
                    await refreshUnresolvedConflicts()
                  }}
                >
                  Mark Reviewed
                </Button>
              </div>
            </div>
            <div className="max-h-40 overflow-y-auto scrollbar-hide space-y-1 pr-1">
              {unresolvedConflicts.length === 0 ? (
                <p className="text-xs text-muted-foreground">No unresolved conflicts.</p>
              ) : (
                unresolvedConflicts.slice(0, 30).map((conflict) => (
                  <div key={conflict.id} className="rounded border border-amber-500/30 bg-amber-500/5 p-2 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-amber-300">
                        {conflict.source.toUpperCase()} · {conflict.entryId}
                      </span>
                      <span className="text-muted-foreground">
                        {new Date(conflict.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    <div className="mt-1 text-muted-foreground">
                      Local: {conflict.localEntry?.name || 'Deleted'} · Remote: {conflict.remoteEntry?.name || 'Deleted'}
                    </div>
                  </div>
                ))
              )}
            </div>
          </SettingsSectionCard>

          <SettingsSectionCard title="Phone Pairing" subtitle="Share or receive sync configuration via QR">
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="outline"
                className="w-full"
                onClick={() => setShowQR(!showQR)}
                disabled={!serverUrl || !syncSecret}
              >
                {showQR ? 'Hide QR' : 'Show Config QR'}
              </Button>
              <Button
                variant="outline"
                className="w-full"
                onClick={async () => {
                  if (isPairing) {
                    if (pairingToken) {
                      await chrome.storage.session.remove(`pairing_${pairingToken}`)
                    }
                    setIsPairing(false)
                    setPairingToken(null)
                    setPairingQR(null)
                    return
                  }
                  const { createPairingSession, generatePairingQRValue } = await import('../../lib/pairing')
                  const session = await createPairingSession()
                  setPairingToken(session.token)
                  const existingServerUrl = serverUrl || undefined
                  setPairingQR(generatePairingQRValue(session.token, existingServerUrl))
                  setIsPairing(true)
                }}
              >
                {isPairing ? 'Cancel Pairing' : 'Receive from Phone'}
              </Button>
            </div>

            {showQR && serverUrl && syncSecret ? (
              <div className="flex flex-col items-center space-y-2 rounded-lg border border-border/60 bg-white p-4">
                <div className="bg-white p-2">
                  <QRCode
                    value={`peach://sync?url=${encodeURIComponent(serverUrl)}&secret=${encodeURIComponent(syncSecret)}`}
                    size={180}
                  />
                </div>
                <p className="text-xs text-center text-muted-foreground">Scan to configure phone</p>
              </div>
            ) : null}

            {isPairing && pairingQR ? (
              <div className="flex flex-col items-center space-y-2 rounded-lg border border-border/60 bg-white p-4">
                <div className="bg-white p-2">
                  <QRCode
                    value={pairingQR}
                    size={180}
                    bgColor="#ffffff"
                    fgColor="#000000"
                  />
                </div>
                <p className="text-xs text-center text-muted-foreground">Scan with phone to receive configuration</p>
                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/60">
                  <div className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-pulse" />
                  Waiting for phone...
                </div>
              </div>
            ) : null}
          </SettingsSectionCard>
        </>
      )
    }

    if (activeCategory === 'backup') {
      return (
        <>
          <SettingsSectionCard title="Vault Export" subtitle="Download your vault data">
            <div className="space-y-2">
              <Button variant="outline" className="w-full justify-start" onClick={handleExport}>
                <Icons.download className="mr-2 h-4 w-4" />
                Export as JSON (decrypted)
              </Button>
              <Button variant="outline" className="w-full justify-start" onClick={handleExportCsv}>
                <Icons.download className="mr-2 h-4 w-4" />
                Export as CSV
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-3">
              JSON includes all data. CSV includes only logins. Keep exports secure.
            </p>
          </SettingsSectionCard>

          <SettingsSectionCard title="Emergency Kit" subtitle="Printable recovery information">
            <Button variant="outline" className="w-full justify-start" onClick={handleExportEmergencyKit}>
              <Icons.download className="mr-2 h-4 w-4" />
                Download Emergency Kit
            </Button>
            <p className="text-xs text-muted-foreground mt-3">
              Contains your vault ID and recovery instructions. Store in a safe place.
            </p>
          </SettingsSectionCard>
        </>
      )
    }

    if (activeCategory === 'errors') {
      return (
        <SettingsSectionCard title="Extension Error Log" subtitle="Runtime failures and autofill diagnostics">
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                setExtensionErrors(await readExtensionErrors())
              }}
            >
              Refresh
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={extensionErrors.length === 0}
              onClick={async () => {
                await clearExtensionErrors()
                setExtensionErrors([])
              }}
            >
              Clear
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="w-full sm:w-auto"
              disabled={extensionErrors.length === 0}
              onClick={async () => {
                const session = await chrome.storage.session.get(['pendingSave', 'autofillData'])
                const local = await chrome.storage.local.get([
                  'lotus_autofill_last_used',
                  STORAGE_KEYS.SETTINGS
                ])

                const bundle = {
                  exportedAt: new Date().toISOString(),
                  app: 'Peach Extension',
                  version: chrome.runtime.getManifest().version,
                  pageUrl: (() => {
                    try {
                      return window.location.href
                    } catch {
                      return ''
                    }
                  })(),
                  context: {
                    errorCount: extensionErrors.length,
                    syncStatus,
                    s3SyncStatus,
                    pendingSave: Boolean(session.pendingSave),
                    autofillDataCount: Array.isArray(session.autofillData) ? session.autofillData.length : 0
                  },
                  settingsSummary: {
                    hasSettings: Boolean(local[STORAGE_KEYS.SETTINGS]),
                    hasLastUsedMap: Boolean(local.lotus_autofill_last_used)
                  },
                  errors: extensionErrors
                }

                const fileName = `peach-errors-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
                const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' })
                const url = URL.createObjectURL(blob)
                const link = document.createElement('a')
                link.href = url
                link.download = fileName
                document.body.appendChild(link)
                link.click()
                document.body.removeChild(link)
                URL.revokeObjectURL(url)
              }}
            >
              <Icons.download className="mr-1.5 h-3.5 w-3.5" />
              Export Errors Bundle
            </Button>
          </div>
          <div className="max-h-72 overflow-y-auto scrollbar-hide space-y-1 pr-1">
            {extensionErrors.length === 0 ? (
              <p className="text-xs text-muted-foreground">No logged extension errors.</p>
            ) : (
              extensionErrors.map((item) => (
                <div key={item.id} className="rounded border border-border/50 p-2 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-foreground">{item.source} · {item.category}</span>
                    <span className="text-muted-foreground">{new Date(item.timestamp).toLocaleTimeString()}</span>
                  </div>
                  <div className="mt-0.5 text-muted-foreground">{item.message}</div>
                  {item.details ? <div className="mt-0.5 text-[11px] text-muted-foreground/80 break-words">{item.details}</div> : null}
                </div>
              ))
            )}
          </div>
        </SettingsSectionCard>
      )
    }

    return (
      <SettingsSectionCard title="Import Data" subtitle="Bring credentials from Proton Pass / Bitwarden exports">
        <div className="space-y-2">
          <div className="space-y-1">
            <Label>Import mode</Label>
            <select
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-xs shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring text-foreground"
              value={importMode}
              onChange={(e) => setImportMode(e.target.value === 'append' ? 'append' : 'merge')}
            >
              <option value="merge" className="bg-background text-foreground">Merge by name/URL (recommended)</option>
              <option value="append" className="bg-background text-foreground">Append as new entries</option>
            </select>
            <p className="text-[11px] text-muted-foreground">
              Merge mode avoids duplicates and fills missing username, password, URLs, TOTP, notes, tags, and favorites on matched entries.
            </p>
          </div>
          <Label>Import from CSV, JSON, or ZIP</Label>
          <Input
            type="file"
            accept=".csv,.json,.zip,application/json,text/csv,application/zip"
            onChange={handleImport}
            className="text-xs"
          />
          <p className="text-xs text-muted-foreground">
            Supports Bitwarden and Proton Pass CSV/JSON exports, PGP-encrypted exports, plus Proton Pass ZIP bundles.
          </p>
          {showPgpPrompt ? (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 space-y-2">
              <p className="text-xs font-medium text-amber-400">PGP-Encrypted File Detected</p>
              <p className="text-xs text-muted-foreground">
                Enter your Proton Pass export passphrase to decrypt:
              </p>
              <Input
                type="password"
                placeholder="Enter passphrase"
                value={pgpPassphrase}
                onChange={(e) => setPgpPassphrase(e.target.value)}
                className="text-xs bg-white/[0.03]"
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() => void handlePgpDecrypt()}
                  disabled={!pgpPassphrase}
                  className="bg-amber-500/20 text-amber-400 hover:bg-amber-500/30"
                >
                  Decrypt & Import
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setShowPgpPrompt(false)
                    setPgpPassphrase('')
                    setPendingImportFile(null)
                    setPendingImportContent('')
                    setImportPreview(null)
                    setImportStatus('')
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : importPreview ? (
            <div className="rounded-md border border-border/60 bg-card/30 p-2.5 space-y-2">
              <p className="text-xs font-medium text-foreground">Import Summary</p>
              <p className="text-xs text-muted-foreground">
                File: {importPreview.fileName} ({importPreview.fileType.toUpperCase()})
              </p>
              <p className="text-xs text-muted-foreground">
                Parsed entries: {importPreview.entryCount} · Skipped: {importPreview.errorCount}
              </p>
              {importPreview.fileType === 'zip' ? (
                <p className="text-xs text-muted-foreground">
                  ZIP files: {importPreview.zipSupportedFiles || 0} supported / {importPreview.zipTotalFiles || 0} total
                </p>
              ) : null}
              {importPreviewErrors.length > 0 ? (
                <div className="max-h-24 overflow-auto rounded border border-border/40 p-2 text-[11px] text-muted-foreground">
                  {importPreviewErrors.map((error) => (
                    <p key={error} className="truncate">{error}</p>
                  ))}
                </div>
              ) : null}
              <div className="flex gap-2">
                <Button size="sm" onClick={() => void applyImportPreview()} disabled={importPreview.entryCount === 0}>
                  Apply Import
                </Button>
                <Button size="sm" variant="outline" onClick={cancelImportPreview}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}
          {importStatus ? <p className="text-xs font-medium text-primary">{importStatus}</p> : null}
        </div>
      </SettingsSectionCard>
    )
  }

  useEffect(() => {
    if (activeCategory !== 'errors') return
    readExtensionErrors().then(setExtensionErrors).catch(() => setExtensionErrors([]))
  }, [activeCategory])

  return (
    <div className="flex h-full bg-[#0a0a0f]">
      <aside className="w-44 h-full bg-[#0d0d12] border-r border-white/[0.04] flex flex-col">
        <div className="p-4">
          <div className="flex items-center gap-2.5 mb-6">
            <div className="flex flex-col items-center">
              <span className="text-lg font-light tracking-[0.2em] text-white/90">PEACH</span>
              <div className="w-8 h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent mt-1" />
            </div>
            <span className="font-semibold text-white/60 text-sm tracking-tight ml-2">Settings</span>
          </div>
          
          <div className="space-y-0.5">
            {categories.map((category) => (
              <SettingsRailItem
                key={category.id}
                label={category.label}
                icon={category.icon}
                active={activeCategory === category.id}
                onClick={() => {
                  setActiveCategory(category.id)
                  chrome.storage.session.set({ [SETTINGS_CATEGORY_STATE_KEY]: category.id }).catch(() => {})
                }}
              />
            ))}
          </div>
        </div>
        
        <div className="mt-auto p-4 border-t border-white/[0.04]">
          <button
            onClick={lockVault}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-white/50 hover:text-white hover:bg-white/[0.06] transition-all text-xs font-medium"
          >
            <Icons.lock className="h-3.5 w-3.5" />
            Lock Vault
          </button>
        </div>
      </aside>

      <div className="min-w-0 flex-1 flex flex-col">
        <div className="border-b border-white/[0.04] px-5 py-4 bg-[#0a0a0f] flex items-center gap-3">
          <button
            onClick={onBack}
            className="p-1.5 rounded-lg text-white/50 hover:text-white hover:bg-white/[0.06] transition-all"
          >
            <Icons.arrowLeft className="h-4 w-4" />
          </button>
          <div>
            <h3 className="text-sm font-medium text-white/90">{activeCategoryMeta.label}</h3>
            <p className="text-xs text-white/40 mt-0.5">{activeCategoryMeta.description}</p>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-hide p-5">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeCategory}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.16, ease: 'easeOut' }}
              className="space-y-4 max-w-lg"
            >
              {renderCategoryContent()}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      {/* LOTUS-007: Password prompt modal for biometric/PIN setup */}
      {passwordPromptOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-lg border border-border bg-card p-4 shadow-lg">
            <h4 className="mb-2 text-sm font-semibold">
              {passwordPromptFor === 'biometric' ? 'Enable Touch ID' : 'Enable PIN'}
            </h4>
            <p className="mb-3 text-xs text-muted-foreground">
              Enter your master password to continue.
            </p>
            <Input
              type="password"
              value={passwordPromptValue}
              onChange={(e) => setPasswordPromptValue(e.target.value)}
              placeholder="Master password"
              className="mb-3 h-9"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  if (passwordPromptFor === 'biometric') {
                    void verifyPasswordAndEnableBiometric()
                  } else {
                    void verifyPasswordAndEnablePin()
                  }
                }
              }}
            />
            {passwordPromptError && (
              <p className="mb-3 text-xs text-red-500">{passwordPromptError}</p>
            )}
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="flex-1"
                onClick={() => {
                  setPasswordPromptOpen(false)
                  setPasswordPromptValue('')
                  setPasswordPromptError(null)
                  if (passwordPromptFor === 'pin') {
                    setIsSettingPin(false)
                    setPinInput('')
                  }
                }}
                disabled={isPasswordVerifying}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                className="flex-1"
                onClick={() => {
                  if (passwordPromptFor === 'biometric') {
                    void verifyPasswordAndEnableBiometric()
                  } else {
                    void verifyPasswordAndEnablePin()
                  }
                }}
                disabled={!passwordPromptValue || isPasswordVerifying}
              >
                {isPasswordVerifying ? 'Verifying...' : 'Continue'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function RecoveryKeySection() {
  const { masterKey, vault } = useVaultState()
  const [showRecoveryModal, setShowRecoveryModal] = useState(false)
  const [recoveryShares, setRecoveryShares] = useState<Share[] | null>(null)
  const [passwordPromptOpen, setPasswordPromptOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  const handleGenerate = async () => {
    if (!masterKey || !vault) return
    setPasswordPromptOpen(true)
  }

  const verifyAndGenerate = async () => {
    try {
      setError('')
      const result = await chrome.storage.local.get(['salt'])
      if (!result.salt) {
        setError('Salt not found')
        return
      }

      const { attemptVaultUnlockWithMigration } = await import('../../lib/crypto-utils')
      const vaultHeader = await loadVaultHeader()
      const unlockAttempt = await attemptVaultUnlockWithMigration(password, new Uint8Array(result.salt), vaultHeader)

      if (!unlockAttempt.success || !unlockAttempt.result) {
        setError('Incorrect password')
        return
      }

      const { generateShares } = await import('@lotus/shared')
      
      const rawKey = await crypto.subtle.exportKey('raw', masterKey!)
      const keyBytes = new Uint8Array(rawKey)
      const shares = generateShares(keyBytes, 5, 3)
      keyBytes.fill(0)

      setRecoveryShares(shares)
      setShowRecoveryModal(true)
      setPasswordPromptOpen(false)
      setPassword('')
    } catch (err) {
      setError('An error occurred')
    }
  }

  const handleDownload = () => {
    if (!recoveryShares) return
    const kit = {
      shares: recoveryShares,
      threshold: 3,
      totalShares: 5,
      createdAt: Date.now(),
              vaultHint: 'My Vault'
    }
    const { downloadRecoveryKit } = require('../../lib/recovery')
    downloadRecoveryKit(kit)
  }

  return (
    <>
      <SettingsSectionCard title="Recovery Key" subtitle="Backup your vault access">
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Generate a recovery key to regain access if you forget your master password.
            Store the 5 recovery shares in separate secure locations.
          </p>
          <Button
            onClick={handleGenerate}
            variant="outline"
            size="sm"
            disabled={!masterKey}
            className="w-full"
          >
            <Icons.key className="mr-2 h-4 w-4" />
            Generate Recovery Key
          </Button>
        </div>
      </SettingsSectionCard>

      {passwordPromptOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-lg border border-border bg-card p-4 shadow-lg">
            <h4 className="mb-2 text-sm font-semibold">Generate Recovery Key</h4>
            <p className="mb-3 text-xs text-muted-foreground">
              Enter your master password to generate recovery shares.
            </p>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Master password"
              className="mb-3 h-9"
            />
            {error && <p className="mb-3 text-xs text-red-500">{error}</p>}
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="flex-1"
                onClick={() => {
                  setPasswordPromptOpen(false)
                  setPassword('')
                  setError('')
                }}
              >
                Cancel
              </Button>
              <Button size="sm" className="flex-1" onClick={verifyAndGenerate} disabled={!password}>
                Generate
              </Button>
            </div>
          </div>
        </div>
      )}

      {showRecoveryModal && recoveryShares && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-lg border border-border bg-card p-4 shadow-lg max-h-[90vh] overflow-y-auto">
            <h4 className="mb-2 text-sm font-semibold">Recovery Key Generated</h4>
            <p className="mb-3 text-xs text-muted-foreground">
              Store these 5 shares in separate secure locations. You need any 3 to recover your vault.
            </p>
            <div className="space-y-2 mb-4">
              {recoveryShares.map((share, i) => (
                <div key={share.index} className="p-2 rounded bg-white/[0.03] border border-white/[0.08]">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium">Share {i + 1}</span>
                    <span className="text-[10px] text-white/40">Index: {share.index}</span>
                  </div>
                  <code className="text-[10px] font-mono text-white/60 break-all">{share.value}</code>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="flex-1" onClick={() => setShowRecoveryModal(false)}>
                Close
              </Button>
              <Button size="sm" className="flex-1" onClick={handleDownload}>
                <Icons.download className="mr-2 h-4 w-4" />
                Download
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
