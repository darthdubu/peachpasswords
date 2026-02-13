import React, { useState, useEffect } from 'react'
import { useVaultActions } from '../contexts/VaultContext'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Icons } from './icons'
import { VaultEntry } from '@lotus/shared'
import { normalizeStoredUrl } from '../../lib/url-match'
import { generatePassword, PasswordOptions } from '../../lib/password-generator'
import { normalizeTotpSecret } from '../../lib/totp'
import { cn } from '@/lib/utils'

interface EntryFormProps {
  initialEntry?: VaultEntry | null
  onSave: () => void
  onCancel: () => void
}

const HISTORY_KEY = 'peach_generated_password_history'
const HISTORY_MAX = 20

interface HistoryItem { password: string; createdAt: number; url: string }

async function loadHistory(): Promise<HistoryItem[]> {
  const result = await chrome.storage.local.get([HISTORY_KEY]).catch(() => ({}))
  const raw = (result as Record<string, unknown>)[HISTORY_KEY]
  if (!Array.isArray(raw)) return []
  return raw.filter(i => i?.password && typeof i.password === 'string').map(i => ({
    password: i.password,
    createdAt: typeof i.createdAt === 'number' ? i.createdAt : Date.now(),
    url: typeof i.url === 'string' ? i.url : ''
  })).sort((a, b) => b.createdAt - a.createdAt).slice(0, HISTORY_MAX)
}

async function saveToHistory(password: string, url: string) {
  const history = await loadHistory()
  await chrome.storage.local.set({ [HISTORY_KEY]: [{ password, createdAt: Date.now(), url }, ...history.filter(i => i.password !== password)].slice(0, HISTORY_MAX) })
}

export function EntryForm({ initialEntry, onSave, onCancel }: EntryFormProps) {
  const { addEntry, updateEntry, encryptValue, decryptValue } = useVaultActions()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isDecrypting, setIsDecrypting] = useState(false)
  
  const [type, setType] = useState<VaultEntry['type']>(initialEntry?.type || 'login')
  const [name, setName] = useState(initialEntry?.name || '')
  const [tags, setTags] = useState(initialEntry?.tags?.join(', ') || '')

  // Login
  const [username, setUsername] = useState(initialEntry?.login?.username || '')
  const [password, setPassword] = useState('')
  const [url, setUrl] = useState(initialEntry?.login?.urls?.[0] || '')
  const [totpSecret, setTotpSecret] = useState('')
  const [showGenerator, setShowGenerator] = useState(false)

  useEffect(() => {
    if (!url && name && type === 'login') {
      const domainMatch = name.match(/^([a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+)$/)
      if (domainMatch) {
        const possibleUrl = `https://${domainMatch[1].toLowerCase()}`
        setUrl(possibleUrl)
      }
    }
  }, [name, url, type])
  const [genNonce, setGenNonce] = useState(0)
  const [genOpts, setGenOpts] = useState<PasswordOptions>({ length: 20, useNumbers: true, useSymbols: true, useUppercase: true })

  // Card
  const [cardHolder, setCardHolder] = useState(initialEntry?.card?.holder || '')
  const [cardNumber, setCardNumber] = useState('')
  const [cardExpMonth, setCardExpMonth] = useState(initialEntry?.card?.expMonth || '')
  const [cardExpYear, setCardExpYear] = useState(initialEntry?.card?.expYear || '')
  const [cardCvv, setCardCvv] = useState('')

  // Note
  const [noteContent, setNoteContent] = useState('')

  const isEditing = Boolean(initialEntry?.id)
  const generatedPassword = React.useMemo(() => generatePassword(genOpts), [genOpts, genNonce])

  // Decrypt existing
  useEffect(() => {
    if (!initialEntry?.id) return
    setIsDecrypting(true)
    const load = async () => {
      try {
        if (initialEntry.type === 'card') {
          if (initialEntry.card?.number) setCardNumber(await decryptValue(initialEntry.card.number, initialEntry.id, initialEntry.modified))
          if (initialEntry.card?.cvv) setCardCvv(await decryptValue(initialEntry.card.cvv, initialEntry.id, initialEntry.modified))
        } else if (initialEntry.type === 'note') {
          if (initialEntry.note?.content) setNoteContent(await decryptValue(initialEntry.note.content, initialEntry.id, initialEntry.modified))
        } else if (initialEntry.type === 'login') {
          if (initialEntry.login?.password) setPassword(await decryptValue(initialEntry.login.password, initialEntry.id, initialEntry.modified))
          if (initialEntry.login?.totp?.secret) setTotpSecret(await decryptValue(initialEntry.login.totp.secret, initialEntry.id, initialEntry.modified))
        }
      } catch (e) { console.error(e) }
      finally { setIsDecrypting(false) }
    }
    load()
  }, [initialEntry, decryptValue])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name) return
    setIsSubmitting(true)
    try {
      const entryId = isEditing ? initialEntry!.id : crypto.randomUUID()
      const modifiedAt = Date.now()
      const entry: VaultEntry = { id: entryId, type, name, favorite: initialEntry?.favorite || false, created: initialEntry?.created || Date.now(), modified: modifiedAt, tags: tags.split(',').map(t => t.trim()).filter(Boolean), encryptedMetadata: '' }

      if (type === 'login') {
        entry.login = { username, password: await encryptValue(password, entryId, modifiedAt), urls: normalizeStoredUrl(url) ? [normalizeStoredUrl(url)!] : [] }
        const normalizedTotp = normalizeTotpSecret(totpSecret)
        if (normalizedTotp) entry.login.totp = { secret: await encryptValue(normalizedTotp, entryId, modifiedAt), algorithm: 'SHA1', digits: 6, period: 30 }
      } else if (type === 'card') {
        entry.card = { holder: cardHolder, number: await encryptValue(cardNumber, entryId, modifiedAt), expMonth: cardExpMonth, expYear: cardExpYear, cvv: await encryptValue(cardCvv, entryId, modifiedAt) }
      } else if (type === 'note') {
        entry.note = { content: await encryptValue(noteContent, entryId, modifiedAt) }
      }

      if (isEditing) await updateEntry(entry)
      else await addEntry(entry)
      onSave()
    } catch (error) {
      alert(`Failed: ${error instanceof Error ? error.message : String(error)}`)
    } finally { setIsSubmitting(false) }
  }

  if (isDecrypting) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-white/10 border-t-primary rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col p-4">
      <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto scrollbar-hide">
        <div className="space-y-4">
          {/* Name */}
          <div>
            <label className="text-xs text-white/40 mb-1.5 block">Name</label>
            <div className="relative">
              <Icons.tag className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30" />
              <Input placeholder="e.g. Google" value={name} onChange={(e) => setName(e.target.value)} className="pl-9 bg-white/[0.03] border-white/[0.08] text-white placeholder:text-white/30" autoFocus />
            </div>
          </div>

          {/* Type selector */}
          <div className="flex gap-1 p-1 rounded-xl bg-white/[0.03] border border-white/[0.08]">
            {(['login', 'card', 'note'] as const).map(t => (
              <button key={t} type="button" onClick={() => setType(t)} className={cn("flex-1 py-2 text-sm font-medium rounded-lg transition-all capitalize", type === t ? "bg-primary text-primary-foreground" : "text-white/50 hover:text-white/80")}>
                {t}
              </button>
            ))}
          </div>

          {/* Login form */}
          {type === 'login' && (
            <>
              <div>
                <label className="text-xs text-white/40 mb-1.5 block">Username</label>
                <div className="relative">
                  <Icons.user className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30" />
                  <Input placeholder="username@example.com" value={username} onChange={(e) => setUsername(e.target.value)} className="pl-9 bg-white/[0.03] border-white/[0.08] text-white placeholder:text-white/30" />
                </div>
              </div>

              <div>
                <label className="text-xs text-white/40 mb-1.5 block">Password</label>
                <div className="relative mb-2">
                  <Icons.lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30" />
                  <Input type="text" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} className="pl-9 bg-white/[0.03] border-white/[0.08] text-white font-mono placeholder:text-white/30" />
                </div>
                {password && <PasswordStrengthIndicator password={password} />}
                <button type="button" onClick={() => setShowGenerator(v => !v)} className="text-xs text-primary hover:text-primary/80 transition-colors mt-2">
                  {showGenerator ? 'Hide generator' : 'Generate password'}
                </button>

                {showGenerator && (
                  <div className="mt-3 p-3 rounded-xl bg-white/[0.03] border border-white/[0.08] space-y-3">
                    <div className="flex gap-2">
                      <Input value={generatedPassword} readOnly className="flex-1 font-mono text-xs bg-white/[0.05] border-white/[0.1]" />
                      <button type="button" onClick={() => navigator.clipboard.writeText(generatedPassword)} className="w-9 h-9 rounded-lg bg-white/[0.05] border border-white/[0.1] flex items-center justify-center text-white/50 hover:text-white"><Icons.copy className="h-4 w-4" /></button>
                      <button type="button" onClick={() => setGenNonce(n => n + 1)} className="w-9 h-9 rounded-lg bg-white/[0.05] border border-white/[0.1] flex items-center justify-center text-white/50 hover:text-white"><Icons.refresh className="h-4 w-4" /></button>
                      <button type="button" onClick={() => { setPassword(generatedPassword); saveToHistory(generatedPassword, url); }} className="px-3 h-9 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-medium">Use</button>
                    </div>
                    <div className="space-y-2">
                      <div className="flex justify-between text-xs text-white/50">
                        <span>Length: {genOpts.length}</span>
                      </div>
                      <input type="range" min={8} max={64} value={genOpts.length} onChange={(e) => setGenOpts(p => ({ ...p, length: Number(e.target.value) }))} className="w-full accent-primary" />
                      <div className="flex gap-4">
                        {['useUppercase', 'useNumbers', 'useSymbols'].map(opt => (
                          <label key={opt} className="flex items-center gap-1.5 text-xs text-white/50">
                            <input type="checkbox" checked={genOpts[opt as keyof PasswordOptions] as boolean} onChange={(e) => setGenOpts(p => ({ ...p, [opt]: e.target.checked }))} className="accent-primary" />
                            {opt.replace('use', '')}
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label className="text-xs text-white/40 mb-1.5 block flex items-center gap-1">
                  Website URL
                  <span className="text-[10px] text-amber-400/80">(required for autofill)</span>
                </label>
                <div className="relative">
                  <Icons.link className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30" />
                  <Input 
                    type="url" 
                    placeholder="https://example.com/login" 
                    value={url} 
                    onChange={(e) => setUrl(e.target.value)} 
                    className={cn(
                      "pl-9 bg-white/[0.03] border-white/[0.08] text-white placeholder:text-white/30",
                      !url && "border-amber-500/30 focus:border-amber-500/50"
                    )}
                  />
                </div>
                {!url && (
                  <p className="text-[10px] text-amber-400/60 mt-1">
                    Without a URL, Peach cannot auto-fill this login on websites.
                  </p>
                )}
              </div>

              <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.08] space-y-2">
                <label className="text-xs text-white/40">TOTP (Optional)</label>
                <Input placeholder="TOTP Secret (Base32)" value={totpSecret} onChange={(e) => setTotpSecret(normalizeTotpSecret(e.target.value))} className="font-mono text-xs bg-white/[0.05] border-white/[0.1]" />
              </div>
            </>
          )}

          {/* Card form */}
          {type === 'card' && (
            <>
              <div>
                <label className="text-xs text-white/40 mb-1.5 block">Card Holder</label>
                <Input placeholder="John Doe" value={cardHolder} onChange={(e) => setCardHolder(e.target.value)} className="bg-white/[0.03] border-white/[0.08] text-white placeholder:text-white/30" />
              </div>
              <div>
                <label className="text-xs text-white/40 mb-1.5 block">Card Number</label>
                <div className="relative">
                  <Icons.card className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30" />
                  <Input placeholder="0000 0000 0000 0000" value={cardNumber} onChange={(e) => setCardNumber(e.target.value)} className="pl-9 bg-white/[0.03] border-white/[0.08] text-white placeholder:text-white/30" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs text-white/40 mb-1.5 block">Month</label>
                  <Input placeholder="MM" maxLength={2} value={cardExpMonth} onChange={(e) => setCardExpMonth(e.target.value)} className="bg-white/[0.03] border-white/[0.08] text-white placeholder:text-white/30" />
                </div>
                <div>
                  <label className="text-xs text-white/40 mb-1.5 block">Year</label>
                  <Input placeholder="YY" maxLength={2} value={cardExpYear} onChange={(e) => setCardExpYear(e.target.value)} className="bg-white/[0.03] border-white/[0.08] text-white placeholder:text-white/30" />
                </div>
                <div>
                  <label className="text-xs text-white/40 mb-1.5 block">CVV</label>
                  <Input placeholder="123" maxLength={4} value={cardCvv} onChange={(e) => setCardCvv(e.target.value)} className="bg-white/[0.03] border-white/[0.08] text-white placeholder:text-white/30" />
                </div>
              </div>
            </>
          )}

          {/* Note form */}
          {type === 'note' && (
            <div>
              <label className="text-xs text-white/40 mb-1.5 block">Content</label>
              <textarea className="w-full min-h-[150px] p-3 rounded-lg bg-white/[0.03] border border-white/[0.08] text-white text-sm placeholder:text-white/30 focus:outline-none focus:border-primary/50 resize-none" placeholder="Secure note content..." value={noteContent} onChange={(e) => setNoteContent(e.target.value)} />
            </div>
          )}

          {/* Tags */}
          <div>
            <label className="text-xs text-white/40 mb-1.5 block">Tags</label>
            <Input placeholder="work, personal" value={tags} onChange={(e) => setTags(e.target.value)} className="bg-white/[0.03] border-white/[0.08] text-white placeholder:text-white/30" />
          </div>
        </div>
      </form>

      {/* Actions */}
      <div className="flex gap-2 pt-4 mt-4 border-t border-white/[0.05]">
        <Button type="button" variant="outline" onClick={onCancel} className="flex-1 h-10 border-white/10 text-white/70 hover:text-white hover:bg-white/[0.05]">Cancel</Button>
        <Button onClick={handleSubmit} disabled={isSubmitting || !name} className="flex-1 h-10 bg-primary hover:bg-primary/90 text-primary-foreground border-0">
          {isSubmitting ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2" /> : null}
          Save
        </Button>
      </div>
    </div>
  )
}

interface PasswordStrengthIndicatorProps {
  password: string
}

function PasswordStrengthIndicator({ password }: PasswordStrengthIndicatorProps) {
  const calculateStrength = (pwd: string): { score: number; label: string; color: string } => {
    let score = 0
    
    if (pwd.length >= 8) score += 1
    if (pwd.length >= 12) score += 1
    if (/[a-z]/.test(pwd) && /[A-Z]/.test(pwd)) score += 1
    if (/[0-9]/.test(pwd)) score += 1
    if (/[^a-zA-Z0-9]/.test(pwd)) score += 1
    
    if (score <= 2) return { score, label: 'Weak', color: 'bg-red-500' }
    if (score <= 3) return { score, label: 'Fair', color: 'bg-yellow-500' }
    if (score <= 4) return { score, label: 'Good', color: 'bg-blue-500' }
    return { score, label: 'Strong', color: 'bg-green-500' }
  }

  const strength = calculateStrength(password)
  const percentage = (strength.score / 5) * 100

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
          <div
            className={`h-full transition-all duration-300 ${strength.color}`}
            style={{ width: `${percentage}%` }}
          />
        </div>
        <span className={`text-xs ${strength.color.replace('bg-', 'text-')}`}>
          {strength.label}
        </span>
      </div>
    </div>
  )
}
