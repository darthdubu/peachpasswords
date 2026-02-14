import { useState, useEffect, useCallback, useRef } from 'react'
import { useVaultActions } from '../contexts/VaultContext'
import { Button } from './ui/button'
import { Icons } from './icons'
import { VaultEntry } from '@lotus/shared'
import { generateTotpCode, getTotpRemainingSeconds } from '../../lib/totp'
import { cn } from '@/lib/utils'
import { copyToClipboard, isClipboardActive, getClipboardTimeRemaining } from '../../lib/clipboard'

interface EntryDetailProps {
  entry: VaultEntry
  onEdit: () => void
  onDelete: () => void
}

type SensitiveField = 'password' | 'cardNumber' | 'cvv' | 'note' | 'totpSecret'
type CopyField = SensitiveField | 'username' | 'url' | 'cardHolder'

export function EntryDetail({ entry, onEdit, onDelete }: EntryDetailProps) {
  const { decryptValue } = useVaultActions()
  const [decrypted, setDecrypted] = useState<Record<SensitiveField, string | null>>({ password: null, cardNumber: null, cvv: null, note: null, totpSecret: null })
  const [showPassword, setShowPassword] = useState(false)
  const [showCardNumber, setShowCardNumber] = useState(false)
  const [showCvv, setShowCvv] = useState(false)
  const [decryptingField, setDecryptingField] = useState<SensitiveField | null>(null)
  const [copiedField, setCopiedField] = useState<CopyField | null>(null)
  const [totpCode, setTotpCode] = useState('')
  const [totpRemaining, setTotpRemaining] = useState(0)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const passwordRevealTimerRef = useRef<NodeJS.Timeout | null>(null)
  const cardNumberRevealTimerRef = useRef<NodeJS.Timeout | null>(null)
  const cvvRevealTimerRef = useRef<NodeJS.Timeout | null>(null)

  const markCopied = useCallback((field: CopyField) => {
    setCopiedField(field)
    setTimeout(() => setCopiedField(current => current === field ? null : current), 900)
  }, [])

  const getEncryptedValue = useCallback((field: SensitiveField): string | null => {
    switch (field) {
      case 'password':
        return entry.login?.password || null
      case 'cardNumber':
        return entry.card?.number || null
      case 'cvv':
        return entry.card?.cvv || null
      case 'note':
        return entry.note?.content || null
      case 'totpSecret':
        return entry.login?.totp?.secret || null
      default:
        return null
    }
  }, [entry])

  const ensureDecrypted = useCallback(async (field: SensitiveField): Promise<string> => {
    if (decrypted[field]) return decrypted[field] || ''
    const enc = getEncryptedValue(field)
    if (!enc) return ''
    const value = await decryptValue(enc, entry.id, entry.modified)
    setDecrypted(c => ({ ...c, [field]: value }))
    return value
  }, [decrypted, decryptValue, entry, getEncryptedValue])

  useEffect(() => {
    if (entry.type === 'note' && entry.note?.content && !decrypted.note) {
      ensureDecrypted('note').catch(console.error)
    }
  }, [entry, decrypted.note, ensureDecrypted])

  useEffect(() => {
    if (entry.type !== 'login' || !entry.login?.totp?.secret) {
      setTotpCode(''); setTotpRemaining(0); return
    }
    let mounted = true
    const update = async () => {
      const secret = await ensureDecrypted('totpSecret')
      if (!secret || !mounted) return
      const code = await generateTotpCode(secret, entry.login?.totp?.algorithm || 'SHA1', entry.login?.totp?.digits || 6, entry.login?.totp?.period || 30)
      if (mounted) { setTotpCode(code); setTotpRemaining(getTotpRemainingSeconds(entry.login?.totp?.period || 30)) }
    }
    update()
    const interval = setInterval(update, 1000)
    return () => { mounted = false; clearInterval(interval) }
  }, [entry, ensureDecrypted])

  const clearRevealTimer = useCallback((field: 'password' | 'cardNumber' | 'cvv') => {
    if (field === 'password' && passwordRevealTimerRef.current) {
      clearTimeout(passwordRevealTimerRef.current)
      passwordRevealTimerRef.current = null
    } else if (field === 'cardNumber' && cardNumberRevealTimerRef.current) {
      clearTimeout(cardNumberRevealTimerRef.current)
      cardNumberRevealTimerRef.current = null
    } else if (field === 'cvv' && cvvRevealTimerRef.current) {
      clearTimeout(cvvRevealTimerRef.current)
      cvvRevealTimerRef.current = null
    }
  }, [])

  const setRevealTimer = useCallback((field: 'password' | 'cardNumber' | 'cvv') => {
    clearRevealTimer(field)
    const timer = setTimeout(() => {
      if (field === 'password') setShowPassword(false)
      else if (field === 'cardNumber') setShowCardNumber(false)
      else if (field === 'cvv') setShowCvv(false)
    }, 10000)

    if (field === 'password') passwordRevealTimerRef.current = timer
    else if (field === 'cardNumber') cardNumberRevealTimerRef.current = timer
    else if (field === 'cvv') cvvRevealTimerRef.current = timer
  }, [clearRevealTimer])

  const handleReveal = useCallback(async (field: 'password' | 'cardNumber' | 'cvv') => {
    setDecryptingField(field)
    try {
      await ensureDecrypted(field)

      if (field === 'password') {
        const newValue = !showPassword
        setShowPassword(newValue)
        if (newValue) setRevealTimer('password')
        else clearRevealTimer('password')
      } else if (field === 'cardNumber') {
        const newValue = !showCardNumber
        setShowCardNumber(newValue)
        if (newValue) setRevealTimer('cardNumber')
        else clearRevealTimer('cardNumber')
      } else {
        const newValue = !showCvv
        setShowCvv(newValue)
        if (newValue) setRevealTimer('cvv')
        else clearRevealTimer('cvv')
      }
    } finally {
      setDecryptingField(null)
    }
  }, [showPassword, showCardNumber, showCvv, ensureDecrypted, setRevealTimer, clearRevealTimer])

  useEffect(() => {
    setShowPassword(false)
    setShowCardNumber(false)
    setShowCvv(false)
    setShowDeleteConfirm(false)
    clearRevealTimer('password')
    clearRevealTimer('cardNumber')
    clearRevealTimer('cvv')
  }, [entry.id, clearRevealTimer])

  const [clipboardCountdown, setClipboardCountdown] = useState(0)
  const clipboardTimerRef = useRef<NodeJS.Timeout | null>(null)

  const updateClipboardCountdown = useCallback(() => {
    if (isClipboardActive()) {
      const remaining = getClipboardTimeRemaining()
      setClipboardCountdown(remaining)
      if (remaining > 0) {
        clipboardTimerRef.current = setTimeout(updateClipboardCountdown, 1000)
      } else {
        setClipboardCountdown(0)
      }
    } else {
      setClipboardCountdown(0)
    }
  }, [])

  useEffect(() => {
    return () => {
      if (clipboardTimerRef.current) {
        clearTimeout(clipboardTimerRef.current)
      }
    }
  }, [])

  const handleCopy = async (text: string, field: CopyField) => {
    if (!text?.trim()) return
    try {
      await copyToClipboard(String(text))
      markCopied(field)
      updateClipboardCountdown()
    } catch {}
  }

  const getIconForType = (type: string) => {
    switch (type) { case 'login': return Icons.key; case 'card': return Icons.card; case 'identity': return Icons.user; case 'note': return Icons.note; default: return Icons.lock }
  }

  const getTypeColor = (type: string) => {
    switch (type) { case 'login': return 'bg-blue-500/15 text-blue-400 border-blue-500/30'; case 'card': return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'; case 'identity': return 'bg-violet-500/15 text-violet-400 border-violet-500/30'; case 'note': return 'bg-amber-500/15 text-amber-400 border-amber-500/30'; default: return 'bg-primary/15 text-primary border-primary/30' }
  }

  const Icon = getIconForType(entry.type)
  const typeColor = getTypeColor(entry.type)

  return (
    <div className="h-full flex flex-col p-4">
      {/* Header */}
      <div className="flex items-start gap-3 mb-4 pb-4 border-b border-white/[0.05]">
        <div className={cn("w-12 h-12 rounded-xl flex items-center justify-center border", typeColor)}>
          <Icon className="h-6 w-6" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold text-white truncate">{entry.name || 'Untitled'}</h2>
            {entry.favorite && <Icons.star className="h-4 w-4 text-amber-400 fill-amber-400 shrink-0" />}
          </div>
          <p className="text-xs text-white/40 capitalize">{entry.type}</p>
        </div>
        <div className="flex gap-2">
          {!showDeleteConfirm ? (
            <>
              <Button size="sm" variant="outline" onClick={onEdit} className="h-8 border-white/10 text-white/70 hover:text-white hover:bg-white/[0.05]">
                <Icons.settings className="h-3.5 w-3.5 mr-1" />Edit
              </Button>
              <Button size="sm" variant="destructive" onClick={() => setShowDeleteConfirm(true)} className="h-8 bg-red-500/10 hover:bg-red-500/20 text-red-400 border-red-500/30">
                <Icons.trash className="h-3.5 w-3.5 mr-1" />Delete
              </Button>
            </>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-xs text-white/60">Move to trash?</span>
              <Button size="sm" variant="outline" onClick={() => setShowDeleteConfirm(false)} className="h-8 border-white/10 text-white/70 hover:text-white hover:bg-white/[0.05]">
                Cancel
              </Button>
              <Button size="sm" variant="destructive" onClick={onDelete} className="h-8 bg-red-500/20 hover:bg-red-500/30 text-red-400 border-red-500/40">
                <Icons.trash className="h-3.5 w-3.5 mr-1" />Confirm
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Tags */}
      {entry.tags && entry.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-4">
          {entry.tags.map(tag => (
            <span key={tag} className="px-2 py-1 text-[10px] rounded-lg bg-white/[0.05] text-white/60 border border-white/[0.08]">{tag}</span>
          ))}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto scrollbar-hide space-y-3">
        {entry.type === 'login' && (
          <>
            <DetailField label="Username" value={entry.login?.username || ''} onCopy={() => handleCopy(entry.login?.username || '', 'username')} copied={copiedField === 'username'} />
            
            <div>
              <label className="text-xs text-white/40 mb-1.5 block">Password</label>
              <div className="flex gap-2">
                <div className="flex-1 h-10 px-3 rounded-lg bg-white/[0.03] border border-white/[0.08] flex items-center font-mono text-sm text-white/80 overflow-hidden">
                  <span className="truncate">{showPassword ? decrypted.password || '' : '••••••••'}</span>
                </div>
                <button onClick={() => handleReveal('password')} disabled={decryptingField === 'password'} className="w-10 h-10 rounded-lg bg-white/[0.03] border border-white/[0.08] flex items-center justify-center text-white/50 hover:text-white transition-colors">
                  {decryptingField === 'password' ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : showPassword ? <Icons.eyeOff className="h-4 w-4" /> : <Icons.eye className="h-4 w-4" />}
                </button>
                <button onClick={() => handleCopy(decrypted.password || '', 'password')} className="w-10 h-10 rounded-lg bg-white/[0.03] border border-white/[0.08] flex items-center justify-center text-white/50 hover:text-white transition-colors">
                  {copiedField === 'password' ? <Icons.check className="h-4 w-4 text-green-400" /> : <Icons.copy className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {(() => {
              const url = entry.login?.urls?.[0]
              if (!url) return null
              return <DetailField label="Website" value={url} onCopy={() => handleCopy(url, 'url')} copied={copiedField === 'url'} action={<button onClick={() => window.open(url, '_blank')} className="w-10 h-10 rounded-lg bg-white/[0.03] border border-white/[0.08] flex items-center justify-center text-white/50 hover:text-white"><Icons.link className="h-4 w-4" /></button>} />
            })()}

            {entry.login?.totp && (
              <div>
                <label className="text-xs text-white/40 mb-1.5 block">TOTP {entry.login.totp.issuer && `· ${entry.login.totp.issuer}`}</label>
                <div className="flex gap-2">
                  <div className="flex-1 h-10 px-3 rounded-lg bg-white/[0.03] border border-white/[0.08] flex items-center justify-between">
                    <span className="font-mono text-lg text-white tracking-wider">{totpCode || '------'}</span>
                    <span className="text-xs text-white/40">{totpRemaining}s</span>
                  </div>
                  <button onClick={() => handleCopy(totpCode, 'totpSecret')} disabled={!totpCode} className="w-10 h-10 rounded-lg bg-white/[0.03] border border-white/[0.08] flex items-center justify-center text-white/50 hover:text-white disabled:opacity-30">
                    {copiedField === 'totpSecret' ? <Icons.check className="h-4 w-4 text-green-400" /> : <Icons.copy className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            )}

            {entry.login?.passkey && (
              <div className="glass-card rounded-xl p-3">
                <div className="flex items-center gap-2 mb-2">
                  <Icons.fingerprint className="h-4 w-4 text-primary" />
                  <span className="text-sm font-medium text-white">Passkey</span>
                </div>
                <p className="text-xs text-white/40">{entry.login.passkey.rpName || entry.login.passkey.rpId}</p>
              </div>
            )}
          </>
        )}

        {entry.type === 'card' && (
          <>
            <DetailField label="Card Holder" value={entry.card?.holder || ''} onCopy={() => handleCopy(entry.card?.holder || '', 'cardHolder')} copied={copiedField === 'cardHolder'} />
            <div>
              <label className="text-xs text-white/40 mb-1.5 block">Card Number</label>
              <div className="flex gap-2">
                <div className="flex-1 h-10 px-3 rounded-lg bg-white/[0.03] border border-white/[0.08] flex items-center font-mono text-sm text-white/80 overflow-hidden">
                  <span className="truncate">{showCardNumber ? decrypted.cardNumber || '' : '•••• •••• •••• ••••'}</span>
                </div>
                <button onClick={() => handleReveal('cardNumber')} disabled={decryptingField === 'cardNumber'} className="w-10 h-10 rounded-lg bg-white/[0.03] border border-white/[0.08] flex items-center justify-center text-white/50 hover:text-white">{decryptingField === 'cardNumber' ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : showCardNumber ? <Icons.eyeOff className="h-4 w-4" /> : <Icons.eye className="h-4 w-4" />}</button>
                <button onClick={() => handleCopy(decrypted.cardNumber || '', 'cardNumber')} className="w-10 h-10 rounded-lg bg-white/[0.03] border border-white/[0.08] flex items-center justify-center text-white/50 hover:text-white">{copiedField === 'cardNumber' ? <Icons.check className="h-4 w-4 text-green-400" /> : <Icons.copy className="h-4 w-4" />}</button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-white/40 mb-1.5 block">Expiry</label>
                <div className="h-10 px-3 rounded-lg bg-white/[0.03] border border-white/[0.08] flex items-center text-sm text-white/80">{entry.card?.expMonth}/{entry.card?.expYear}</div>
              </div>
              <div>
                <label className="text-xs text-white/40 mb-1.5 block">CVV</label>
                <div className="flex gap-2">
                  <div className="flex-1 h-10 px-3 rounded-lg bg-white/[0.03] border border-white/[0.08] flex items-center font-mono text-sm text-white/80 overflow-hidden">
                  <span className="truncate">{showCvv ? decrypted.cvv || '' : '•••'}</span>
                </div>
                  <button onClick={() => handleReveal('cvv')} disabled={decryptingField === 'cvv'} className="w-10 h-10 rounded-lg bg-white/[0.03] border border-white/[0.08] flex items-center justify-center text-white/50 hover:text-white">{decryptingField === 'cvv' ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : showCvv ? <Icons.eyeOff className="h-4 w-4" /> : <Icons.eye className="h-4 w-4" />}</button>
                  <button onClick={() => handleCopy(decrypted.cvv || '', 'cvv')} className="w-10 h-10 rounded-lg bg-white/[0.03] border border-white/[0.08] flex items-center justify-center text-white/50 hover:text-white">{copiedField === 'cvv' ? <Icons.check className="h-4 w-4 text-green-400" /> : <Icons.copy className="h-4 w-4" />}</button>
                </div>
              </div>
            </div>
          </>
        )}

        {entry.type === 'note' && (
          <div>
            <label className="text-xs text-white/40 mb-1.5 block">Content</label>
            <div className="relative">
              <textarea readOnly className="w-full min-h-[150px] p-3 rounded-lg bg-white/[0.03] border border-white/[0.08] text-sm text-white/80 resize-none" value={decrypted.note || ''} />
              <button onClick={() => handleCopy(decrypted.note || '', 'note')} className="absolute top-2 right-2 w-8 h-8 rounded-lg bg-white/[0.05] flex items-center justify-center text-white/50 hover:text-white transition-colors">
                {copiedField === 'note' ? <Icons.check className="h-4 w-4 text-green-400" /> : <Icons.copy className="h-4 w-4" />}
              </button>
            </div>
          </div>
        )}
      </div>

      {clipboardCountdown > 0 && (
        <div className="mt-3 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
          <div className="flex items-center justify-between">
            <span className="text-xs text-amber-400">Clipboard will clear in</span>
            <span className="text-xs font-mono text-amber-400">{Math.ceil(clipboardCountdown / 1000)}s</span>
          </div>
        </div>
      )}
    </div>
  )
}

function DetailField({ label, value, onCopy, copied, action }: { label: string; value: string; onCopy: () => void; copied: boolean; action?: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs text-white/40 mb-1.5 block">{label}</label>
      <div className="flex gap-2">
        <div className="flex-1 h-10 px-3 rounded-lg bg-white/[0.03] border border-white/[0.08] flex items-center text-sm text-white/80 truncate">{value}</div>
        <button onClick={onCopy} className="w-10 h-10 rounded-lg bg-white/[0.03] border border-white/[0.08] flex items-center justify-center text-white/50 hover:text-white transition-colors">
          {copied ? <Icons.check className="h-4 w-4 text-green-400" /> : <Icons.copy className="h-4 w-4" />}
        </button>
        {action}
      </div>
    </div>
  )
}
