import React, { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useVaultActions, useVaultState } from '../contexts/VaultContext'

import { Icons } from './icons'
import QRCode from 'react-qr-code'
import { getBiometricSupportInfo } from '../../lib/biometric'
import { cn } from '@/lib/utils'

type View = 'home' | 'create' | 'unlock' | 's3-restore' | 'qr-sync'
type LastAuthMethod = 'password' | 'pin' | 'biometric'
const LAST_AUTH_METHOD_KEY = 'peach_last_auth_method'

function AnimatedGridBackground() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      <div 
        className="absolute inset-0 opacity-[0.09]"
        style={{
          backgroundImage: `
            linear-gradient(rgba(255, 255, 255, 0.03) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255, 255, 255, 0.03) 1px, transparent 1px)
          `,
          backgroundSize: '40px 40px'
        }}
      />
      <div 
        className="absolute inset-0 opacity-30"
        style={{
          background: `
            radial-gradient(ellipse at 20% 30%, rgba(255, 107, 74, 0.15) 0%, transparent 50%),
            radial-gradient(ellipse at 80% 70%, rgba(255, 138, 92, 0.1) 0%, transparent 50%),
            radial-gradient(ellipse at 50% 50%, rgba(255, 107, 74, 0.05) 0%, transparent 70%)
          `,
          animation: 'gridPulse 8s ease-in-out infinite'
        }}
      />
      <motion.div
        className="absolute w-64 h-64 rounded-full"
        style={{
          background: 'radial-gradient(circle, rgba(255, 107, 74, 0.08) 0%, transparent 70%)',
          filter: 'blur(40px)'
        }}
        animate={{
          x: [0, 50, 0],
          y: [0, -30, 0],
          scale: [1, 1.2, 1]
        }}
        transition={{
          duration: 12,
          repeat: Infinity,
          ease: "easeInOut"
        }}
        initial={{ left: '10%', top: '20%' }}
      />
      <motion.div
        className="absolute w-48 h-48 rounded-full"
        style={{
          background: 'radial-gradient(circle, rgba(255, 138, 92, 0.06) 0%, transparent 70%)',
          filter: 'blur(30px)'
        }}
        animate={{
          x: [0, -40, 0],
          y: [0, 40, 0],
          scale: [1, 0.9, 1]
        }}
        transition={{
          duration: 10,
          repeat: Infinity,
          ease: "easeInOut",
          delay: 2
        }}
        initial={{ right: '15%', bottom: '25%' }}
      />
    </div>
  )
}

// Glass input component
function GlassInput({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "w-full h-12 px-4 rounded-xl",
        "bg-white/[0.03] border border-white/[0.08]",
        "text-white placeholder:text-white/30",
        "focus:outline-none focus:border-[#ff6b4a]/50 focus:ring-1 focus:ring-[#ff6b4a]/30",
        "transition-all duration-300",
        className
      )}
      {...props}
    />
  )
}

// Glass button component
function GlassButton({ children, className, variant = 'primary', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'outline' }) {
  const variants = {
    primary: "bg-gradient-to-r from-[#ff6b4a] to-[#ff8a5c] text-white border-transparent shadow-lg shadow-[#ff6b4a]/25",
    secondary: "bg-white/[0.05] text-white border-white/[0.1] hover:bg-white/[0.08]",
    outline: "bg-transparent text-white/70 border-white/[0.15] hover:border-[#ff6b4a]/50 hover:text-white"
  }
  
  return (
    <button
      className={cn(
        "h-12 px-6 rounded-xl font-medium",
        "border backdrop-blur-sm",
        "transition-all duration-300",
        "active:scale-[0.98]",
        variants[variant],
        className
      )}
      {...props}
    >
      {children}
    </button>
  )
}

// PIN dot component
function PinDot({ filled, active }: { filled: boolean; active: boolean }) {
  return (
    <div className={cn(
      "w-10 h-12 rounded-lg border-2 flex items-center justify-center transition-all duration-200",
      filled 
        ? "border-[#ff6b4a] bg-[#ff6b4a]/20 text-white shadow-lg shadow-[#ff6b4a]/20" 
        : active 
          ? "border-[#ff6b4a]/50 bg-white/[0.03]"
          : "border-white/[0.1] bg-white/[0.02]"
    )}>
      {filled && <div className="w-2 h-2 rounded-full bg-[#ff6b4a]" />}
    </div>
  )
}

function UnlockView({ onForgot }: { onForgot?: () => void }) {
  const { unlockVault, unlockWithPin, unlockWithBiometric } = useVaultActions()
  const { error } = useVaultState()
  const [password, setPassword] = useState('')
  const [pin, setPin] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [usePinMode, setUsePinMode] = useState(false)
  const [pinAvailable, setPinAvailable] = useState(false)
  const [biometricAvailable, setBiometricAvailable] = useState(false)
  const [, setPreferredAuthMethod] = useState<LastAuthMethod>('password')

  useEffect(() => {
    const checkAuthOptions = async () => {
      const [{ hasPin }, { hasBiometricCredential }] = await Promise.all([
        import('../../lib/pin'),
        import('../../lib/biometric')
      ])
      const pinIsAvailable = await hasPin()
      const biometricIsAvailable = await hasBiometricCredential()
      const supportInfo = getBiometricSupportInfo()
      setPinAvailable(pinIsAvailable)
      setBiometricAvailable(biometricIsAvailable && supportInfo.supported)

      const pref = await chrome.storage.local.get([LAST_AUTH_METHOD_KEY])
      setPreferredAuthMethod(pref[LAST_AUTH_METHOD_KEY] || 'password')

      if (pinIsAvailable && pref[LAST_AUTH_METHOD_KEY] === 'pin') {
        setUsePinMode(true)
      }
    }
    checkAuthOptions()
  }, [])

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!password) return
    setIsSubmitting(true)
    try {
      const success = await unlockVault(password)
      if (success) await chrome.storage.local.set({ [LAST_AUTH_METHOD_KEY]: 'password' })
    } finally { setIsSubmitting(false) }
  }

  const doPinUnlock = async (pinCode: string) => {
    if (pinCode.length !== 6) return
    setIsSubmitting(true)
    try {
      const success = await unlockWithPin(pinCode)
      if (success) await chrome.storage.local.set({ [LAST_AUTH_METHOD_KEY]: 'pin' })
    } finally { setIsSubmitting(false) }
  }

  const handleBiometricUnlock = async () => {
    setIsSubmitting(true)
    try {
      const success = await unlockWithBiometric()
      if (success) await chrome.storage.local.set({ [LAST_AUTH_METHOD_KEY]: 'biometric' })
    } finally { setIsSubmitting(false) }
  }

  // Auto-submit PIN
  useEffect(() => {
    if (pin.length === 6 && !isSubmitting && usePinMode) {
      void doPinUnlock(pin)
    }
  }, [pin, isSubmitting, usePinMode])

  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-10">
          <motion.h1 
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-3xl font-light tracking-[0.2em] text-white/90"
          >
            PEACH
          </motion.h1>
          <motion.div 
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ delay: 0.2, duration: 0.6 }}
            className="w-12 h-px bg-gradient-to-r from-transparent via-[#ff6b4a]/60 to-transparent mt-3"
          />
        </div>

        <AnimatePresence mode="wait">
          {usePinMode ? (
            <motion.div
              key="pin"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              <div className="text-center">
                <h2 className="text-lg font-medium text-white">Enter PIN</h2>
                <p className="text-xs text-white/40 mt-1">Unlock your vault</p>
              </div>

              <form onSubmit={(e) => { e.preventDefault(); void doPinUnlock(pin); }} className="space-y-4">
                <div className="flex justify-center gap-2">
                  {[0, 1, 2, 3, 4, 5].map((i) => (
                    <PinDot key={i} filled={pin.length > i} active={pin.length === i} />
                  ))}
                </div>

                <input
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  disabled={isSubmitting}
                  autoFocus
                  className="absolute opacity-0 w-0 h-0"
                />

                {error && <p className="text-xs text-red-400 text-center">{error}</p>}

                <GlassButton type="submit" disabled={isSubmitting || pin.length !== 6} className="w-full">
                  {isSubmitting ? <Icons.refresh className="h-4 w-4 animate-spin mx-auto" /> : 'Unlock'}
                </GlassButton>

                <div className="flex flex-col gap-2">
                  {biometricAvailable && (
                    <GlassButton type="button" variant="outline" onClick={handleBiometricUnlock} disabled={isSubmitting}>
                      <Icons.fingerprint className="h-4 w-4 mr-2 inline" />
                      Touch ID
                    </GlassButton>
                  )}
                  <button type="button" onClick={() => { setUsePinMode(false); setPin(''); }} className="text-xs text-white/40 hover:text-white/70 transition-colors">
                    Use password instead
                  </button>
                </div>
              </form>
            </motion.div>
          ) : (
            <motion.div
              key="password"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              <div className="text-center">
                <h2 className="text-lg font-medium text-white">Welcome back</h2>
                <p className="text-xs text-white/40 mt-1">Enter your master password</p>
              </div>

              <form onSubmit={handlePasswordSubmit} className="space-y-4">
                <GlassInput
                  type="password"
                  placeholder="Master password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={isSubmitting}
                  autoFocus
                />

          {error && <p className="text-xs text-red-400">{error}</p>}

                <GlassButton type="submit" disabled={isSubmitting || !password} className="w-full">
                  {isSubmitting ? <Icons.refresh className="h-4 w-4 animate-spin mr-2" /> : 'Unlock Vault'}
                </GlassButton>

                <div className="flex flex-col gap-2">
                  {biometricAvailable && (
                    <GlassButton type="button" variant="outline" onClick={handleBiometricUnlock} disabled={isSubmitting}>
                      <Icons.fingerprint className="h-4 w-4 mr-2 inline" />
                      Unlock with Touch ID
                    </GlassButton>
                  )}
                  {pinAvailable && (
                    <button type="button" onClick={() => setUsePinMode(true)} className="text-xs text-white/40 hover:text-white/70 transition-colors">
                      Use PIN code
                    </button>
                  )}
                  {onForgot && (
                    <button type="button" onClick={onForgot} className="text-xs text-white/30 hover:text-white/50 transition-colors">
                      Can&apos;t unlock?
                    </button>
                  )}
                </div>
              </form>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

function HomeView({ onNavigate }: { onNavigate: (v: View) => void }) {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="w-full max-w-lg">
        <div className="flex flex-col items-center mb-12">
          <motion.h1
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-4xl font-light tracking-[0.25em] text-white/90"
          >
            PEACH
          </motion.h1>
          <motion.div
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ delay: 0.2, duration: 0.6 }}
            className="w-16 h-px bg-gradient-to-r from-transparent via-[#ff6b4a]/60 to-transparent mt-4"
          />
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4 }}
            className="text-xs text-white/30 mt-4 tracking-widest uppercase"
          >
            Secure Vault
          </motion.p>
        </div>

        <div className="grid grid-cols-3 gap-3">
          {[
            { key: 'create' as View, icon: Icons.folderPlus, label: 'New Vault', accent: true },
            { key: 's3-restore' as View, icon: Icons.cloudDownload, label: 'Restore', accent: false },
            { key: 'qr-sync' as View, icon: Icons.smartphone, label: 'Sync', accent: false },
          ].map((opt) => (
            <button
              key={opt.key}
              onClick={() => onNavigate(opt.key)}
              className={cn(
                "group relative p-4 rounded-2xl transition-all duration-300",
                "border backdrop-blur-sm",
                opt.accent 
                  ? "bg-gradient-to-br from-[#ff6b4a]/20 to-[#ff8a5c]/10 border-[#ff6b4a]/30 hover:border-[#ff6b4a]/50"
                  : "bg-white/[0.03] border-white/[0.08] hover:bg-white/[0.06] hover:border-white/[0.15]"
              )}
            >
              <div className={cn(
                "w-10 h-10 rounded-xl flex items-center justify-center mb-3 mx-auto transition-transform group-hover:scale-110",
                opt.accent ? "bg-[#ff6b4a]/20 text-[#ff6b4a]" : "bg-white/[0.05] text-white/60"
              )}>
                <opt.icon className="h-5 w-5" />
              </div>
              <p className={cn("text-sm font-medium", opt.accent ? "text-white" : "text-white/70")}>{opt.label}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function CreateView({ onBack }: { onBack: () => void }) {
  const { createVault } = useVaultActions()
  const { error: contextError } = useVaultState()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [localError, setLocalError] = useState('')

  const strength = { score: password.length > 8 ? (password.length > 12 ? 3 : 2) : 1, label: password.length > 12 ? 'Strong' : password.length > 8 ? 'Good' : 'Weak' }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLocalError('')
    if (password !== confirm) { setLocalError("Passwords don't match"); return }
    if (password.length < 8) { setLocalError('Password too short'); return }
    setIsSubmitting(true)
    try {
      await createVault(password)
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Failed to create vault')
    } finally {
      setIsSubmitting(false)
    }
  }

  const displayError = localError || contextError

  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="w-full max-w-sm">
        <button onClick={onBack} className="flex items-center gap-1 text-white/40 hover:text-white/70 mb-6 transition-colors">
          <Icons.chevronRight className="h-4 w-4 rotate-180" />
          <span className="text-sm">Back</span>
        </button>

        <h2 className="text-xl font-bold text-white mb-1">Create Vault</h2>
        <p className="text-sm text-white/40 mb-6">Set your master password</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <label className="text-xs text-white/40">Master Password</label>
            <GlassInput type="password" placeholder="Create strong password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          
          <div className="space-y-1">
            <label className="text-xs text-white/40">Confirm</label>
            <GlassInput type="password" placeholder="Repeat password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </div>

          {password && (
            <div className="flex items-center gap-2">
              <div className="flex-1 h-1 bg-white/10 rounded-full overflow-hidden">
                <div className={cn("h-full transition-all duration-300", strength.score > 2 ? 'bg-green-500 w-full' : strength.score > 1 ? 'bg-yellow-500 w-2/3' : 'bg-red-500 w-1/3')} />
              </div>
              <span className={cn("text-xs", strength.score > 2 ? 'text-green-400' : strength.score > 1 ? 'text-yellow-400' : 'text-red-400')}>{strength.label}</span>
            </div>
          )}

          {displayError && <p className="text-xs text-red-400">{displayError}</p>}

          <GlassButton type="submit" disabled={isSubmitting || !password || password !== confirm} className="w-full">
            {isSubmitting ? <Icons.refresh className="h-4 w-4 animate-spin mr-2" /> : 'Create Vault'}
          </GlassButton>
        </form>
      </div>
    </div>
  )
}

function S3RestoreView({ onBack }: { onBack: () => void }) {
  const [fields, setFields] = useState({ bucket: '', region: '', accessKey: '', secretKey: '' })

  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="w-full max-w-md">
        <button onClick={onBack} className="flex items-center gap-1 text-white/40 hover:text-white/70 mb-6 transition-colors">
          <Icons.chevronRight className="h-4 w-4 rotate-180" />
          <span className="text-sm">Back</span>
        </button>

        <h2 className="text-xl font-bold text-white mb-6">Restore from Cloud</h2>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs text-white/40">Bucket</label>
            <GlassInput placeholder="my-vault" value={fields.bucket} onChange={(e) => setFields(f => ({ ...f, bucket: e.target.value }))} />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-white/40">Region</label>
            <GlassInput placeholder="us-east-1" value={fields.region} onChange={(e) => setFields(f => ({ ...f, region: e.target.value }))} />
          </div>
          <div className="col-span-2 space-y-1">
            <label className="text-xs text-white/40">Access Key</label>
            <GlassInput placeholder="AKIA..." value={fields.accessKey} onChange={(e) => setFields(f => ({ ...f, accessKey: e.target.value }))} />
          </div>
          <div className="col-span-2 space-y-1">
            <label className="text-xs text-white/40">Secret Key</label>
            <GlassInput type="password" placeholder="••••••••" value={fields.secretKey} onChange={(e) => setFields(f => ({ ...f, secretKey: e.target.value }))} />
          </div>
          <div className="col-span-2 mt-2">
            <GlassButton disabled={!fields.bucket || !fields.region || !fields.accessKey || !fields.secretKey} className="w-full">
              <Icons.cloudDownload className="h-4 w-4 mr-2 inline" />
              Restore
            </GlassButton>
          </div>
        </div>
      </div>
    </div>
  )
}

function QrSyncView({ onBack }: { onBack: () => void }) {
  const [qr, setQr] = useState<string | null>(null)
  const startPairing = async () => {
    const { createPairingSession, generatePairingQRValue } = await import('../../lib/pairing')
    const session = await createPairingSession()
    setQr(generatePairingQRValue(session.token))
  }

  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="w-full max-w-sm">
        <button onClick={onBack} className="flex items-center gap-1 text-white/40 hover:text-white/70 mb-6 transition-colors">
          <Icons.chevronRight className="h-4 w-4 rotate-180" />
          <span className="text-sm">Back</span>
        </button>

        <h2 className="text-xl font-bold text-white mb-6 text-center">Sync Device</h2>

        {qr ? (
          <div className="flex flex-col items-center gap-4">
            <div className="p-4 bg-white rounded-2xl shadow-2xl shadow-white/10">
              <QRCode value={qr} size={180} />
            </div>
            <p className="text-sm text-white/60">Scan with Peach mobile app</p>
            <button onClick={() => setQr(null)} className="text-xs text-white/40 hover:text-white/60">Cancel</button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4">
            <div className="w-20 h-20 rounded-2xl bg-white/[0.03] border border-white/[0.08] flex items-center justify-center">
              <Icons.smartphone className="h-10 w-10 text-white/30" />
            </div>
            <p className="text-sm text-white/50 text-center">Generate a QR code to pair with your phone</p>
            <GlassButton onClick={startPairing}>
              <Icons.qrCode className="h-4 w-4 mr-2 inline" />
              Generate QR
            </GlassButton>
          </div>
        )}
      </div>
    </div>
  )
}

export function UnlockScreen() {
  const { vaultExists } = useVaultState()
  const [view, setView] = useState<View>(vaultExists ? 'unlock' : 'home')

  return (
    <div className="w-[600px] h-[420px] bg-[#0a0a0f] overflow-hidden relative">
      <AnimatedGridBackground />
      
      <AnimatePresence mode="wait">
        {view === 'unlock' && <UnlockView key="unlock" onForgot={() => setView('home')} />}
        {view === 'home' && <HomeView key="home" onNavigate={(v) => setView(v)} />}
        {view === 'create' && <CreateView key="create" onBack={() => setView('home')} />}
        {view === 's3-restore' && <S3RestoreView key="s3-restore" onBack={() => setView('home')} />}
        {view === 'qr-sync' && <QrSyncView key="qr-sync" onBack={() => setView('home')} />}
      </AnimatePresence>
    </div>
  )
}
