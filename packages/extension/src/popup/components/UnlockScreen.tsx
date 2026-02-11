import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useVault } from '../contexts/VaultContext'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Icons } from './icons'
import QRCode from 'react-qr-code'

type View = 'home' | 'create' | 'unlock' | 's3-restore' | 'qr-sync'
type LastAuthMethod = 'password' | 'pin' | 'biometric'
const LAST_AUTH_METHOD_KEY = 'peach_last_auth_method'

interface PasswordStrength {
  score: number
  label: string
  color: string
  requirements: string[]
}

function checkPasswordStrength(password: string): PasswordStrength {
  const requirements: string[] = []
  let score = 0

  if (password.length >= 12) { score += 1 } else { requirements.push('12+ characters') }
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) { score += 1 } else { requirements.push('Mixed case') }
  if (/\d/.test(password)) { score += 1 } else { requirements.push('A number') }
  if (/[^a-zA-Z0-9]/.test(password)) { score += 1 } else { requirements.push('A symbol') }

  const labels = ['Very Weak', 'Weak', 'Fair', 'Good', 'Strong']
  const colors = ['bg-red-500', 'bg-red-400', 'bg-yellow-400', 'bg-green-400', 'bg-green-500']

  return { score, label: labels[score], color: colors[score], requirements }
}

const fade = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -6 },
  transition: { duration: 0.18, ease: [0.4, 0, 0.2, 1] as number[] }
}

function ViewHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div className="flex items-center gap-1.5 mb-3">
      <button
        onClick={onBack}
        className="p-1 rounded-md hover:bg-secondary/80 transition-colors text-muted-foreground hover:text-foreground"
      >
        <Icons.arrowLeft className="h-3.5 w-3.5" />
      </button>
      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{title}</span>
    </div>
  )
}

function UnlockView({ onForgot }: { onForgot?: () => void }) {
  const { unlockVault, unlockWithPin, unlockWithBiometric, error } = useVault()
  const [password, setPassword] = useState('')
  const [pin, setPin] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [usePinMode, setUsePinMode] = useState(false)
  const [pinAvailable, setPinAvailable] = useState(false)
  const [biometricAvailable, setBiometricAvailable] = useState(false)
  const [preferredAuthMethod, setPreferredAuthMethod] = useState<LastAuthMethod>('password')
  const [pinLockRemainingMs, setPinLockRemainingMs] = useState(0)
  const [triedAutoBiometric, setTriedAutoBiometric] = useState(false)

  const formatRemaining = (remainingMs: number) => {
    const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000))
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds % 60
    if (minutes > 0) return `${minutes}m ${seconds}s`
    return `${seconds}s`
  }

  const refreshPinLockStatus = useCallback(async () => {
    const { getPinLockoutStatus } = await import('../../lib/pin')
    const lockout = await getPinLockoutStatus()
    setPinLockRemainingMs(lockout.isLocked ? lockout.remainingMs : 0)
  }, [])

  const isPinLocked = pinLockRemainingMs > 0

  useEffect(() => {
    const checkAuthOptions = async () => {
      const [{ hasPin }, { hasBiometricCredential }] = await Promise.all([
        import('../../lib/pin'),
        import('../../lib/biometric')
      ])
      const pinIsAvailable = await hasPin()
      const biometricIsAvailable = await hasBiometricCredential()
      setPinAvailable(pinIsAvailable)
      setBiometricAvailable(biometricIsAvailable)

      const pref = await chrome.storage.local.get([LAST_AUTH_METHOD_KEY])
      const lastAuthMethod = pref[LAST_AUTH_METHOD_KEY] as LastAuthMethod | undefined
      const preferred = lastAuthMethod || 'password'
      setPreferredAuthMethod(preferred)

      if (pinIsAvailable && preferred === 'pin') {
        setUsePinMode(true)
      } else {
        setUsePinMode(false)
      }
    }
    checkAuthOptions()
  }, [])

  useEffect(() => {
    if (!pinAvailable) {
      setPinLockRemainingMs(0)
      return
    }

    let isMounted = true

    const refresh = async () => {
      const { getPinLockoutStatus } = await import('../../lib/pin')
      const lockout = await getPinLockoutStatus()
      if (!isMounted) return
      setPinLockRemainingMs(lockout.isLocked ? lockout.remainingMs : 0)
    }

    void refresh()
    const intervalId = window.setInterval(() => {
      void refresh()
    }, 1000)

    return () => {
      isMounted = false
      window.clearInterval(intervalId)
    }
  }, [pinAvailable])

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!password) return
    setIsSubmitting(true)
    try {
      const success = await unlockVault(password)
      if (success) {
        await chrome.storage.local.set({ [LAST_AUTH_METHOD_KEY]: 'password' satisfies LastAuthMethod })
        setPreferredAuthMethod('password')
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  const handlePinSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (pin.length !== 6 || isPinLocked) return
    setIsSubmitting(true)
    try {
      const success = await unlockWithPin(pin)
      if (success) {
        await chrome.storage.local.set({ [LAST_AUTH_METHOD_KEY]: 'pin' satisfies LastAuthMethod })
        setPreferredAuthMethod('pin')
      }
      await refreshPinLockStatus()
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleBiometricUnlock = async () => {
    setIsSubmitting(true)
    try {
      const success = await unlockWithBiometric()
      if (success) {
        await chrome.storage.local.set({ [LAST_AUTH_METHOD_KEY]: 'biometric' satisfies LastAuthMethod })
        setPreferredAuthMethod('biometric')
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  useEffect(() => {
    if (triedAutoBiometric) return
    if (preferredAuthMethod !== 'biometric' || !biometricAvailable || usePinMode || isSubmitting) return
    setTriedAutoBiometric(true)
    void handleBiometricUnlock()
  }, [preferredAuthMethod, biometricAvailable, usePinMode, isSubmitting, triedAutoBiometric])

  return (
    <motion.div {...fade} className="flex flex-col h-full">
      <div className="flex items-center gap-2 mb-4">
        <img
          src="/icons/icon-32.png"
          alt="Peach"
          className="w-8 h-8 drop-shadow-md"
        />
        <span className="text-sm font-bold bg-gradient-to-r from-primary to-primary/70 bg-clip-text text-transparent">Peach</span>
      </div>

      {usePinMode ? (
        <form onSubmit={handlePinSubmit} className="flex flex-col flex-1">
          <p className="text-[11px] text-muted-foreground mb-2">Enter PIN</p>
          <Input
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            placeholder="• • • • • •"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
            disabled={isSubmitting || isPinLocked}
            autoFocus
            className="h-10 text-sm px-2.5 bg-secondary/50 border-border/60 text-center text-lg tracking-[0.5em]"
          />

          {error && (
            <p className="text-[10px] text-destructive mt-1.5">{error}</p>
          )}
          {isPinLocked && (
            <p className="text-[10px] text-amber-500 mt-1.5">
              PIN temporarily locked. Try again in {formatRemaining(pinLockRemainingMs)}.
            </p>
          )}

          <Button
            type="submit"
            disabled={isSubmitting || pin.length !== 6 || isPinLocked}
            className="h-10 text-sm mt-3 w-full glow-primary"
          >
            {isSubmitting ? (
              <Icons.refresh className="h-3 w-3 animate-spin" />
            ) : (
              'Unlock'
            )}
          </Button>

          <button
            type="button"
            onClick={() => {
              setUsePinMode(false)
              setPin('')
            }}
            className="text-[10px] text-muted-foreground hover:text-primary transition-colors mt-2 self-center"
          >
            Use password instead
          </button>
        </form>
      ) : (
        <form onSubmit={handlePasswordSubmit} className="flex flex-col flex-1">
          <p className="text-[11px] text-muted-foreground mb-2">Master password</p>
          <Input
            type="password"
            placeholder="Enter password…"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={isSubmitting}
            autoFocus
            className="h-10 text-sm px-2.5 bg-secondary/50 border-border/60"
          />

          {error && (
            <p className="text-[10px] text-destructive mt-1.5">{error}</p>
          )}

          <Button
            type="submit"
            disabled={isSubmitting || !password}
            className="h-10 text-sm mt-3 w-full glow-primary"
          >
            {isSubmitting ? (
              <Icons.refresh className="h-3 w-3 animate-spin" />
            ) : (
              'Unlock'
            )}
          </Button>

          {biometricAvailable && (
            <Button
              type="button"
              variant="outline"
              onClick={handleBiometricUnlock}
              disabled={isSubmitting}
              className="h-10 text-sm mt-2 w-full"
            >
              <Icons.fingerprint className="h-3.5 w-3.5 mr-1.5" />
              {preferredAuthMethod === 'biometric' ? 'Unlock with Touch ID (recommended)' : 'Unlock with Touch ID'}
            </Button>
          )}

          {pinAvailable && (
            <div className="flex flex-col items-center mt-2">
              <button
                type="button"
                onClick={() => {
                  setUsePinMode(true)
                  setPassword('')
                }}
                className="text-[10px] text-muted-foreground hover:text-primary transition-colors self-center"
              >
                Unlock with PIN
              </button>
              {isPinLocked && (
                <p className="text-[10px] text-amber-500 mt-1">
                  PIN locked for {formatRemaining(pinLockRemainingMs)}
                </p>
              )}
            </div>
          )}

          {onForgot && (
            <button
              type="button"
              onClick={onForgot}
              className="text-[10px] text-muted-foreground hover:text-primary transition-colors mt-1 self-center"
            >
              {"Can't unlock? Recover vault →"}
            </button>
          )}
        </form>
      )}
    </motion.div>
  )
}

function HomeView({ onNavigate }: { onNavigate: (v: View) => void }) {
  const options = [
    {
      key: 'create' as View,
      icon: Icons.folderPlus,
      label: 'Create New Vault',
      desc: 'Start fresh with a new vault',
      accent: true,
    },
    {
      key: 's3-restore' as View,
      icon: Icons.cloudDownload,
      label: 'Restore from S3',
      desc: 'Recover from cloud backup',
      accent: false,
    },
    {
      key: 'qr-sync' as View,
      icon: Icons.smartphone,
      label: 'Sync from Phone',
      desc: 'Scan QR to pair with mobile',
      accent: false,
    },
  ]

  return (
    <motion.div {...fade} className="flex flex-col h-full">
      <div className="flex flex-col items-center mb-4">
        <img
          src="/icons/icon-48.png"
          alt="Peach"
          className="w-10 h-10 drop-shadow-lg mb-2"
        />
        <span className="text-sm font-bold bg-gradient-to-r from-primary to-primary/70 bg-clip-text text-transparent">Peach</span>
        <p className="text-[10px] text-muted-foreground mt-0.5">Get started</p>
      </div>

      <div className="flex flex-col gap-1.5 flex-1">
        {options.map((opt, i) => (
          <motion.button
            key={opt.key}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.06 * i, duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
            onClick={() => onNavigate(opt.key)}
            className={`
              flex items-center gap-2.5 p-2.5 rounded-lg text-left transition-all duration-150
              ${opt.accent
                ? 'bg-primary/10 border border-primary/20 hover:bg-primary/15 hover:border-primary/30'
                : 'bg-secondary/40 border border-transparent hover:bg-secondary/70 hover:border-border/50'
              }
            `}
          >
            <div className={`
              w-7 h-7 rounded-md flex items-center justify-center shrink-0
              ${opt.accent
                ? 'bg-primary/20 text-primary'
                : 'bg-secondary text-muted-foreground'
              }
            `}>
              <opt.icon className="h-3.5 w-3.5" />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-medium text-foreground leading-tight">{opt.label}</div>
              <div className="text-[10px] text-muted-foreground leading-tight mt-0.5">{opt.desc}</div>
            </div>
            <Icons.chevronRight className="h-3 w-3 text-muted-foreground/50 ml-auto shrink-0" />
          </motion.button>
        ))}
      </div>
    </motion.div>
  )
}

function CreateView({ onBack }: { onBack: () => void }) {
  const { createVault } = useVault()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [localError, setLocalError] = useState('')

  const strength = useMemo(() => checkPasswordStrength(password), [password])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLocalError('')
    if (password !== confirmPassword) { setLocalError("Passwords don\u2019t match"); return }
    if (strength.score < 3) { setLocalError('Password too weak'); return }
    setIsSubmitting(true)
    try { await createVault(password) } finally { setIsSubmitting(false) }
  }

  return (
    <motion.div {...fade} className="flex flex-col h-full">
      <ViewHeader title="New vault" onBack={onBack} />

      <form onSubmit={handleSubmit} className="flex flex-col flex-1 gap-2">
        <div>
          <p className="text-[10px] text-muted-foreground mb-1">Master password</p>
          <Input
            type="password"
            placeholder="Choose a strong password…"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={isSubmitting}
            autoFocus
            className="h-10 text-sm px-2.5 bg-secondary/50 border-border/60"
          />
        </div>

        <div>
          <p className="text-[10px] text-muted-foreground mb-1">Confirm</p>
          <Input
            type="password"
            placeholder="Repeat password…"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            disabled={isSubmitting}
            className="h-10 text-sm px-2.5 bg-secondary/50 border-border/60"
          />
        </div>

        {password && (
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground">Strength</span>
              <span className={`text-[10px] font-medium ${strength.score >= 3 ? 'text-green-500' : strength.score >= 2 ? 'text-yellow-500' : 'text-red-500'}`}>
                {strength.label}
              </span>
            </div>
            <div className="h-1 w-full bg-muted rounded-full overflow-hidden">
              <motion.div
                className={`h-full ${strength.color}`}
                initial={{ width: 0 }}
                animate={{ width: `${((strength.score + 1) / 5) * 100}%` }}
                transition={{ duration: 0.3 }}
              />
            </div>
            {strength.requirements.length > 0 && (
              <p className="text-[9px] text-muted-foreground">
                Need: {strength.requirements.join(' \u00b7 ')}
              </p>
            )}
          </div>
        )}

        {localError && (
          <p className="text-[10px] text-destructive">{localError}</p>
        )}

        <div className="mt-auto">
          <Button
            type="submit"
            disabled={isSubmitting || !password || password !== confirmPassword || strength.score < 2}
            className="h-10 text-sm w-full glow-primary"
          >
            {isSubmitting ? (
              <Icons.refresh className="h-3 w-3 animate-spin" />
            ) : (
              'Create Vault'
            )}
          </Button>
        </div>
      </form>
    </motion.div>
  )
}

function S3RestoreView({ onBack }: { onBack: () => void }) {
  const [bucket, setBucket] = useState('')
  const [region, setRegion] = useState('')
  const [accessKey, setAccessKey] = useState('')
  const [secretKey, setSecretKey] = useState('')

  return (
    <motion.div {...fade} className="flex flex-col h-full">
      <ViewHeader title="Restore from S3" onBack={onBack} />

      <div className="flex flex-col gap-2 flex-1">
        <div className="flex items-center gap-2 p-2 rounded-lg bg-primary/5 border border-primary/10">
          <Icons.cloud className="h-3.5 w-3.5 text-primary shrink-0" />
          <p className="text-[10px] text-muted-foreground leading-snug">
            Enter your S3 bucket details to restore an encrypted backup.
          </p>
        </div>

        <div>
          <p className="text-[10px] text-muted-foreground mb-1">Bucket</p>
          <Input
            placeholder="my-vault-backup"
            value={bucket}
            onChange={(e) => setBucket(e.target.value)}
            className="h-9 text-xs px-2 bg-secondary/50 border-border/60"
          />
        </div>

        <div>
          <p className="text-[10px] text-muted-foreground mb-1">Region</p>
          <Input
            placeholder="us-east-1"
            value={region}
            onChange={(e) => setRegion(e.target.value)}
            className="h-9 text-xs px-2 bg-secondary/50 border-border/60"
          />
        </div>

        <div>
          <p className="text-[10px] text-muted-foreground mb-1">Access Key</p>
          <Input
            placeholder="AKIA…"
            value={accessKey}
            onChange={(e) => setAccessKey(e.target.value)}
            className="h-9 text-xs px-2 bg-secondary/50 border-border/60"
          />
        </div>

        <div>
          <p className="text-[10px] text-muted-foreground mb-1">Secret Key</p>
          <Input
            type="password"
            placeholder="\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022"
            value={secretKey}
            onChange={(e) => setSecretKey(e.target.value)}
            className="h-9 text-xs px-2 bg-secondary/50 border-border/60"
          />
        </div>

        <div className="mt-auto">
          <Button
            disabled={!bucket || !region || !accessKey || !secretKey}
            className="h-10 text-sm w-full"
            onClick={() => {}}
          >
            <Icons.cloudDownload className="h-3 w-3 mr-1.5" />
            Restore Backup
          </Button>
        </div>
      </div>
    </motion.div>
  )
}

function QrSyncView({ onBack, onConfigured }: { onBack: () => void; onConfigured?: () => void }) {
  const [existingSettings, setExistingSettings] = useState<{serverUrl: string; syncSecret: string} | null>(null)
  const [pairingToken, setPairingToken] = useState<string | null>(null)
  const [pairingQR, setPairingQR] = useState<string | null>(null)
  const [isPolling, setIsPolling] = useState(false)
  const [isConfigured, setIsConfigured] = useState(false)
  const pairingTokenRef = useRef<string | null>(null)

  useEffect(() => {
    pairingTokenRef.current = pairingToken
  }, [pairingToken])

  useEffect(() => {
    const loadExistingSettings = async () => {
      const result = await chrome.storage.local.get(['peach_settings'])
      if (result.peach_settings) {
        const settings = result.peach_settings
        if (settings.serverUrl && settings.syncSecret) {
          setExistingSettings({
            serverUrl: settings.serverUrl,
            syncSecret: settings.syncSecret
          })
        }
      }
    }
    loadExistingSettings()

    return () => {
      if (pairingTokenRef.current) {
        chrome.storage.session.remove(`pairing_${pairingTokenRef.current}`)
      }
    }
  }, [])

  const startPairing = async () => {
    const { createPairingSession, generatePairingQRValue } = await import('../../lib/pairing')
    const session = await createPairingSession()
    setPairingToken(session.token)
    const serverUrl = existingSettings?.serverUrl
    setPairingQR(generatePairingQRValue(session.token, serverUrl))
    setIsPolling(true)
  }

  useEffect(() => {
    if (!isPolling || !pairingToken) return

    const pollInterval = setInterval(async () => {
      const { pollForPairingCompletion } = await import('../../lib/pairing')
      const serverUrl = existingSettings?.serverUrl
      const data = await pollForPairingCompletion(pairingToken, serverUrl)
      
      if (data) {
        await chrome.storage.local.set({
          peach_settings: {
            serverUrl: data.serverUrl,
            syncSecret: data.syncSecret
          }
        })
        setIsConfigured(true)
        setIsPolling(false)
        onConfigured?.()
      }
    }, 2000)

    const timeout = setTimeout(() => {
      setIsPolling(false)
      clearInterval(pollInterval)
    }, 5 * 60 * 1000)

    return () => {
      clearInterval(pollInterval)
      clearTimeout(timeout)
    }
  }, [isPolling, pairingToken, onConfigured])

  const useExistingSettings = async () => {
    if (existingSettings) {
      onConfigured?.()
    }
  }

  return (
    <motion.div {...fade} className="flex flex-col h-full">
      <ViewHeader title="Sync from phone" onBack={onBack} />

      <div className="flex flex-col flex-1 gap-4 pt-2">
        {isConfigured ? (
          <div className="flex flex-col items-center justify-center flex-1 gap-4">
            <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center">
              <Icons.check className="h-8 w-8 text-green-500" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-foreground">Configuration Received!</p>
              <p className="text-xs text-muted-foreground mt-1">
                Your vault is now synced with your phone
              </p>
            </div>
            <Button onClick={onBack} className="w-full">
              Continue
            </Button>
          </div>
        ) : pairingQR ? (
          <div className="flex flex-col items-center gap-4">
            <div className="relative">
              <div className="p-3 bg-white rounded-xl border-2 border-dashed border-border/60">
                <QRCode 
                  value={pairingQR}
                  size={160}
                  bgColor="#ffffff"
                  fgColor="#000000"
                />
              </div>
              <div className="absolute inset-0 rounded-xl border-2 border-primary/40 pulse-glow pointer-events-none" />
            </div>

            <div className="text-center space-y-1">
              <p className="text-[11px] font-medium text-foreground">Scan with Peach Mobile</p>
              <p className="text-[10px] text-muted-foreground">
                Open the app and scan to share configuration
              </p>
            </div>

            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/60">
              <div className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-pulse" />
              Waiting for phone to connect&hellip;
            </div>

            <Button 
              variant="ghost" 
              size="sm"
              onClick={async () => {
                if (pairingToken) {
                  await chrome.storage.session.remove(`pairing_${pairingToken}`)
                }
                setIsPolling(false)
                setPairingToken(null)
                setPairingQR(null)
              }}
            >
              Cancel
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {existingSettings && (
              <div className="p-3 rounded-lg bg-primary/10 border border-primary/20">
                <p className="text-xs font-medium text-foreground mb-1">Existing Configuration Found</p>
                <p className="text-[10px] text-muted-foreground mb-2">
                  Server: {existingSettings.serverUrl}
                </p>
                <Button 
                  onClick={useExistingSettings}
                  variant="outline" 
                  size="sm"
                  className="w-full text-xs"
                >
                  Use Existing Settings
                </Button>
              </div>
            )}

            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                Don&apos;t have settings configured? Generate a pairing code to receive configuration from your phone.
              </p>
              <Button 
                onClick={startPairing}
                className="w-full"
              >
                <Icons.qrCode className="h-4 w-4 mr-2" />
                Generate Pairing Code
              </Button>
            </div>
          </div>
        )}
      </div>
    </motion.div>
  )
}

export function UnlockScreen() {
  const { vaultExists } = useVault()
  const [view, setView] = useState<View>(vaultExists ? 'unlock' : 'home')

  return (
    <div className="w-[340px] h-[520px] flex flex-col bg-background overflow-hidden relative">
      <div className="absolute inset-0 gradient-mesh opacity-60 pointer-events-none" />

      <div className="relative flex flex-col flex-1 p-3.5">
        <AnimatePresence mode="wait">
          {view === 'unlock' && (
            <UnlockView
              key="unlock"
              onForgot={() => setView('home')}
            />
          )}
          {view === 'home' && (
            <HomeView
              key="home"
              onNavigate={(v) => setView(v)}
            />
          )}
          {view === 'create' && (
            <CreateView
              key="create"
              onBack={() => setView('home')}
            />
          )}
          {view === 's3-restore' && (
            <S3RestoreView
              key="s3-restore"
              onBack={() => setView('home')}
            />
          )}
          {view === 'qr-sync' && (
            <QrSyncView
              key="qr-sync"
              onBack={() => setView('home')}
              onConfigured={() => setView('home')}
            />
          )}
        </AnimatePresence>
      </div>

      <div className="h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent" />
    </div>
  )
}