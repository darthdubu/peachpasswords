import { useState, useEffect } from 'react'
import { useVault } from '../contexts/VaultContext'
import { useTheme, Theme, ColorScheme } from '../contexts/ThemeContext'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Icons } from './icons'
import { STORAGE_KEYS } from '../../lib/constants'
import QRCode from 'react-qr-code'
import { parseCSV } from '../../lib/importers'
import { EncryptedSettings } from '../../lib/crypto-utils'
import { hasBiometricCredential, clearBiometricCredential, registerBiometric } from '../../lib/biometric'

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3"

type SettingsCategory = 'appearance' | 'security' | 'sync' | 'backup' | 'import'

export function Settings() {
  const { lockVault, syncStatus, s3SyncStatus, importEntries, vault, decryptValue, encryptSettingsData, decryptSettingsData, masterKey } = useVault()
  const { theme, setTheme, colorScheme, setColorScheme } = useTheme()
  const [activeCategory, setActiveCategory] = useState<SettingsCategory>('appearance')
  
  const [serverUrl, setServerUrl] = useState('')
  const [syncSecret, setSyncSecret] = useState('')
  const [showQR, setShowQR] = useState(false)
  const [importStatus, setImportStatus] = useState('')
  const [s3Endpoint, setS3Endpoint] = useState('https://s3.fr-par.scw.cloud')
  const [s3Region, setS3Region] = useState('fr-par')
  const [s3AccessKey, setS3AccessKey] = useState('')
  const [s3SecretKey, setS3SecretKey] = useState('')
  const [s3Bucket, setS3Bucket] = useState('')
  const [isUploading, setIsUploading] = useState(false)
  const [idleTimeoutMinutes, setIdleTimeoutMinutes] = useState(5)
  const [hasBiometric, setHasBiometric] = useState(false)
  const [isRegisteringBiometric, setIsRegisteringBiometric] = useState(false)
  const [pairingToken, setPairingToken] = useState<string | null>(null)
  const [pairingQR, setPairingQR] = useState<string | null>(null)
  const [isPairing, setIsPairing] = useState(false)

  useEffect(() => {
    const loadSettings = async () => {
      const result = await chrome.storage.local.get([STORAGE_KEYS.SETTINGS])
      if (!result[STORAGE_KEYS.SETTINGS]) return

      const settingsData = result[STORAGE_KEYS.SETTINGS]

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
      }
      
      const biometricEnabled = await hasBiometricCredential()
      setHasBiometric(biometricEnabled)
    }
    loadSettings()
  }, [decryptSettingsData])

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

  const handleSave = async () => {
    const settingsToEncrypt = {
      serverUrl,
      syncSecret,
      s3Endpoint,
      s3Region,
      s3AccessKey,
      s3SecretKey,
      s3Bucket,
      idleTimeoutMinutes: String(idleTimeoutMinutes)
    }

    const encrypted = await encryptSettingsData(settingsToEncrypt)
    if (encrypted) {
      await chrome.storage.local.set({
        [STORAGE_KEYS.SETTINGS]: {
          encrypted,
          hasCredentials: !!(s3AccessKey || s3SecretKey || syncSecret)
        }
      })
    } else {
      await chrome.storage.local.set({
        [STORAGE_KEYS.SETTINGS]: settingsToEncrypt
      })
    }
  }

  const handleBiometricSetup = async () => {
    if (!masterKey) return
    setIsRegisteringBiometric(true)
    try {
      const sessionResult = await chrome.storage.session.get(['masterKeyRaw'])
      if (!sessionResult.masterKeyRaw) {
        alert('Please unlock with password first to enable biometric')
        return
      }
      const rawBytes = new Uint8Array(sessionResult.masterKeyRaw)
      const success = await registerBiometric(masterKey, rawBytes.buffer)
      if (success) {
        setHasBiometric(true)
        alert('Touch ID enabled successfully!')
      } else {
        alert('Failed to enable Touch ID')
      }
    } catch (e) {
      console.error(e)
      alert('Error enabling Touch ID')
    } finally {
      setIsRegisteringBiometric(false)
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
          exported.login.password = await decryptValue(entry.login!.password, entry.id)
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

  const handleS3Backup = async () => {
    if (!vault || !s3Bucket) return
    setIsUploading(true)
    try {
      const client = new S3Client({
        endpoint: s3Endpoint,
        region: s3Region,
        credentials: {
          accessKeyId: s3AccessKey,
          secretAccessKey: s3SecretKey
        }
      })
      
      const result = await chrome.storage.local.get(['vault', 'salt'])
      if (!result.vault || !result.salt) throw new Error("No vault data found in storage")
      
      const backupData = JSON.stringify({
        vault: Array.from(new Uint8Array(result.vault)),
        salt: Array.from(new Uint8Array(result.salt)),
        timestamp: Date.now()
      })
      
      const key = `peach-backup-${new Date().toISOString()}.json`
      
      await client.send(new PutObjectCommand({
        Bucket: s3Bucket,
        Key: key,
        Body: backupData,
        ContentType: 'application/json'
      }))
      
      alert(`Backup successful! Saved to ${key}`)
    } catch (e) {
      console.error(e)
      const msg = e instanceof Error ? e.message : String(e)
      alert(`Backup failed: ${msg}`)
    } finally {
      setIsUploading(false)
    }
  }

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setImportStatus('Parsing...')
    try {
      const text = await file.text()
      const { entries, errors } = parseCSV(text)
      
      if (entries.length > 0) {
        setImportStatus(`Importing ${entries.length} entries...`)
        await importEntries(entries)
        setImportStatus(`Success: Imported ${entries.length} entries.`)
      } else {
        setImportStatus('No valid entries found.')
      }

      if (errors.length > 0) {
        console.warn('Import errors:', errors)
        setImportStatus(prev => `${prev} (${errors.length} skipped)`)
      }
    } catch (err) {
      console.error(err)
      setImportStatus('Failed to import file.')
    }
  }

  const categories = [
    { id: 'appearance' as SettingsCategory, label: 'Appearance', icon: 'settings' },
    { id: 'security' as SettingsCategory, label: 'Security', icon: 'lock' },
    { id: 'sync' as SettingsCategory, label: 'Sync', icon: 'cloud' },
    { id: 'backup' as SettingsCategory, label: 'Backup', icon: 'download' },
    { id: 'import' as SettingsCategory, label: 'Import', icon: 'plus' },
  ]

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="flex border-b px-4 pt-4 gap-1 overflow-x-auto">
        {categories.map((cat) => {
          const IconComponent = Icons[cat.icon as keyof typeof Icons] as React.ComponentType<{ className?: string }>
          return (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
              className={`flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-t-lg transition-colors whitespace-nowrap ${
                activeCategory === cat.id
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
            >
              {IconComponent && <IconComponent className="h-4 w-4" />}
              {cat.label}
            </button>
          )
        })}
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {activeCategory === 'appearance' && (
          <div className="space-y-6">
            <div className="space-y-4">
              <h3 className="font-medium text-lg">Appearance</h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
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
                <div className="space-y-2">
                  <Label>Accent Color</Label>
                  <select 
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring text-foreground"
                    value={colorScheme}
                    onChange={(e) => setColorScheme(e.target.value as ColorScheme)}
                  >
                    <option value="peach" className="bg-background text-foreground">Peach</option>
                    <option value="green" className="bg-background text-foreground">Green</option>
                    <option value="blue" className="bg-background text-foreground">Blue</option>
                  </select>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeCategory === 'security' && (
          <div className="space-y-6">
            <div className="space-y-4">
              <h3 className="font-medium text-lg">Security</h3>
              
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <Label>Auto-Lock Grace Period</Label>
                  <span className="text-sm text-muted-foreground">{idleTimeoutMinutes} min</span>
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
                  Time before vault automatically locks after closing the extension
                </p>
              </div>
              
              <div className="pt-4 border-t space-y-4">
                <h4 className="font-medium">Quick Unlock</h4>
                {hasBiometric ? (
                  <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">Touch ID is enabled for this vault</p>
                    <Button onClick={handleBiometricDisable} variant="outline" size="sm">
                      Disable Touch ID
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">Unlock instantly with Touch ID</p>
                    <Button 
                      onClick={handleBiometricSetup} 
                      variant="outline" 
                      size="sm"
                      disabled={isRegisteringBiometric || !masterKey}
                    >
                      {isRegisteringBiometric ? (
                        <Icons.refresh className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Icons.fingerprint className="mr-2 h-4 w-4" />
                      )}
                      Enable Touch ID
                    </Button>
                  </div>
                )}
              </div>
              
              <Button onClick={handleSave} variant="outline" size="sm" className="w-full">
                Save Security Settings
              </Button>
            </div>
          </div>
        )}

        {activeCategory === 'sync' && (
          <div className="space-y-6">
            <div className="space-y-4">
              <h3 className="font-medium text-lg">Server Configuration</h3>
              
              <div className="space-y-2">
                <Label>Server URL</Label>
                <Input 
                  value={serverUrl} 
                  onChange={(e) => setServerUrl(e.target.value)} 
                  placeholder="ws://localhost:8743"
                />
                <p className="text-xs text-muted-foreground">
                  URL of your local Peach server
                </p>
              </div>

              <div className="space-y-2">
                <Label>Sync Secret</Label>
                <Input 
                  type="password"
                  value={syncSecret} 
                  onChange={(e) => setSyncSecret(e.target.value)} 
                  placeholder="peach-local-secret"
                />
                <p className="text-xs text-muted-foreground">
                  Secret key configured in your server
                </p>
              </div>
              
              <Button onClick={handleSave} className="w-full">Save Configuration</Button>

              <div className="flex flex-col gap-2 p-2 rounded bg-muted">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Local Sync</span>
                  <span className={`text-sm ${
                    syncStatus === 'connected' ? 'text-green-500' :
                    syncStatus === 'error' ? 'text-red-500' :
                    syncStatus === 'connecting' ? 'text-yellow-500' :
                    'text-muted-foreground'
                  }`}>
                    {syncStatus.charAt(0).toUpperCase() + syncStatus.slice(1)}
                  </span>
                </div>
                <div className="flex items-center justify-between border-t pt-2 border-border/50">
                  <span className="text-sm font-medium">S3 Sync</span>
                  <span className={`text-sm ${
                    s3SyncStatus === 'connected' ? 'text-green-500' :
                    s3SyncStatus === 'error' ? 'text-red-500' :
                    s3SyncStatus === 'connecting' ? 'text-yellow-500' :
                    'text-muted-foreground'
                  }`}>
                    {s3SyncStatus.charAt(0).toUpperCase() + s3SyncStatus.slice(1)}
                  </span>
                </div>
              </div>

              <div className="pt-4 border-t space-y-3">
                <div className="flex gap-2">
                  <Button 
                    variant="outline" 
                    className="flex-1" 
                    onClick={() => setShowQR(!showQR)}
                    disabled={!serverUrl || !syncSecret}
                  >
                    {showQR ? "Hide" : "Show Config QR"}
                  </Button>
                  <Button 
                    variant="outline" 
                    className="flex-1"
                    onClick={async () => {
                      if (isPairing) {
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
                    {isPairing ? "Cancel" : "Receive from Phone"}
                  </Button>
                </div>
                
                {showQR && serverUrl && syncSecret && (
                  <div className="flex flex-col items-center space-y-2 p-4 bg-white rounded-lg border">
                    <div className="bg-white p-2">
                      <QRCode 
                        value={`peach://sync?url=${encodeURIComponent(serverUrl)}&secret=${encodeURIComponent(syncSecret)}`} 
                        size={180} 
                      />
                    </div>
                    <p className="text-xs text-center text-muted-foreground">
                      Scan to configure phone
                    </p>
                  </div>
                )}
                
                {isPairing && pairingQR && (
                  <div className="flex flex-col items-center space-y-2 p-4 bg-white rounded-lg border">
                    <div className="bg-white p-2">
                      <QRCode 
                        value={pairingQR}
                        size={180}
                        bgColor="#ffffff"
                        fgColor="#000000"
                      />
                    </div>
                    <p className="text-xs text-center text-muted-foreground">
                      Scan with phone to receive configuration
                    </p>
                    <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/60">
                      <div className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-pulse" />
                      Waiting for phone…
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {activeCategory === 'backup' && (
          <div className="space-y-6">
            <div className="space-y-4">
              <h3 className="font-medium text-lg">Backups</h3>
              
              <div className="space-y-2">
                <Button variant="outline" className="w-full justify-start" onClick={handleExport}>
                  <Icons.download className="mr-2 h-4 w-4" />
                  Export Vault (JSON)
                </Button>
                <p className="text-xs text-muted-foreground">
                  Download a decrypted backup of your vault
                </p>
              </div>

              <div className="space-y-2 pt-4 border-t">
                <h4 className="font-medium">S3 Backup (Scaleway)</h4>
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
                  <Input value={s3Bucket} onChange={(e) => setS3Bucket(e.target.value)} className="h-8 text-xs" placeholder="my-peach-backup" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Access Key ID</Label>
                  <Input value={s3AccessKey} onChange={(e) => setS3AccessKey(e.target.value)} className="h-8 text-xs" type="password" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Secret Access Key</Label>
                  <Input value={s3SecretKey} onChange={(e) => setS3SecretKey(e.target.value)} className="h-8 text-xs" type="password" />
                </div>
                
                <Button 
                  variant="outline" 
                  className="w-full justify-start mt-2" 
                  onClick={handleS3Backup}
                  disabled={isUploading || !s3Bucket || !s3AccessKey || !s3SecretKey}
                >
                  {isUploading ? <Icons.refresh className="mr-2 h-4 w-4 animate-spin" /> : <Icons.cloud className="mr-2 h-4 w-4" />}
                  {isUploading ? 'Uploading...' : 'Backup to S3'}
                </Button>
              </div>
            </div>
          </div>
        )}

        {activeCategory === 'import' && (
          <div className="space-y-6">
            <div className="space-y-4">
              <h3 className="font-medium text-lg">Import Data</h3>
              <div className="space-y-2">
                <Label>Import from CSV</Label>
                <div className="flex gap-2">
                  <Input 
                    type="file" 
                    accept=".csv"
                    onChange={handleImport}
                    className="text-xs"
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Supports Bitwarden and Proton Pass CSV exports
                </p>
                {importStatus && (
                  <p className="text-xs font-medium text-primary">{importStatus}</p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="p-4 border-t">
        <Button variant="destructive" className="w-full" onClick={lockVault}>
          <Icons.lock className="mr-2 h-4 w-4" />
          Lock Vault
        </Button>
      </div>
    </div>
  )
}
