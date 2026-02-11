import React, { useState, useEffect } from 'react'
import { useVault } from '../contexts/VaultContext'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Icons } from './icons'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs'
import { VaultEntry } from '@lotus/shared'
import { normalizeStoredUrl } from '../../lib/url-match'

interface EntryFormProps {
  initialEntry?: VaultEntry | null
  initialPassword?: string
  onSave: () => void
  onCancel: () => void
}

export function EntryForm({ initialEntry, initialPassword, onSave, onCancel }: EntryFormProps) {
  const { addEntry, updateEntry, encryptValue, decryptValue } = useVault()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isDecrypting, setIsDecrypting] = useState(false)
  
  // Type state
  const [type, setType] = useState<VaultEntry['type']>(initialEntry?.type || 'login')

  // Common state
  const [name, setName] = useState(initialEntry?.name || '')
  const [tags, setTags] = useState(initialEntry?.tags?.join(', ') || '')

  // Login state
  const [username, setUsername] = useState(initialEntry?.login?.username || '')
  const [password, setPassword] = useState(initialPassword || '') 
  const [url, setUrl] = useState(initialEntry?.login?.urls[0] || '')

  // Card state
  const [cardHolder, setCardHolder] = useState(initialEntry?.card?.holder || '')
  const [cardNumber, setCardNumber] = useState('') // Encrypted, will decrypt
  const [cardExpMonth, setCardExpMonth] = useState(initialEntry?.card?.expMonth || '')
  const [cardExpYear, setCardExpYear] = useState(initialEntry?.card?.expYear || '')
  const [cardCvv, setCardCvv] = useState('') // Encrypted, will decrypt

  // Note state
  const [noteContent, setNoteContent] = useState('') // Encrypted, will decrypt

  // Decrypt existing data on mount
  useEffect(() => {
    if (!initialEntry) return

    const loadDecrypted = async () => {
      setIsDecrypting(true)
      try {
        if (initialEntry.type === 'card') {
           if (initialEntry.card?.number) {
             const num = await decryptValue(initialEntry.card.number, initialEntry.id)
             setCardNumber(num)
           }
           if (initialEntry.card?.cvv) {
             const cvv = await decryptValue(initialEntry.card.cvv, initialEntry.id)
             setCardCvv(cvv)
           }
        } else if (initialEntry.type === 'note') {
           if (initialEntry.note?.content) {
             const content = await decryptValue(initialEntry.note.content, initialEntry.id)
             setNoteContent(content)
           }
        } else if (initialEntry.type === 'login') {
           // For login, we usually don't prefill password for security unless explicitly requested?
           // But for editing, it's annoying to not see it.
           // EntryDetail hides it. EntryForm usually shows it if you are editing.
           // Let's decrypt it too.
           if (initialEntry.login?.password && !initialPassword) {
             const pwd = await decryptValue(initialEntry.login.password, initialEntry.id)
             setPassword(pwd)
           }
        }
      } catch (e) {
        console.error('Failed to decrypt entry for editing', e)
      } finally {
        setIsDecrypting(false)
      }
    }
    loadDecrypted()
  }, [initialEntry, initialPassword]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name) return

    setIsSubmitting(true)
    try {
      const entryId = initialEntry?.id || crypto.randomUUID()
      
      const entry: VaultEntry = {
        id: entryId,
        type,
        name,
        favorite: initialEntry?.favorite || false,
        created: initialEntry?.created || Date.now(),
        modified: Date.now(),
        tags: tags.split(',').map(t => t.trim()).filter(Boolean),
      }

      if (type === 'login') {
        const encryptedPassword = await encryptValue(password, entryId)
        const normalizedUrl = normalizeStoredUrl(url)
        entry.login = {
          username,
          password: encryptedPassword,
          urls: normalizedUrl ? [normalizedUrl] : []
        }
      } else if (type === 'card') {
        const encryptedNumber = await encryptValue(cardNumber, entryId)
        const encryptedCvv = await encryptValue(cardCvv, entryId)
        entry.card = {
          holder: cardHolder,
          number: encryptedNumber,
          expMonth: cardExpMonth,
          expYear: cardExpYear,
          cvv: encryptedCvv
        }
      } else if (type === 'note') {
        const encryptedContent = await encryptValue(noteContent, entryId)
        entry.note = {
          content: encryptedContent
        }
      }

      if (initialEntry) {
        // If changing type, we overwrite fields. 
        // If keeping type, we update.
        await updateEntry(entry)
      } else {
        await addEntry(entry)
      }
      
      onSave()
    } catch (error) {
      console.error('Failed to save entry:', error)
      const msg = error instanceof Error ? error.message : String(error)
      alert(`Failed to save: ${msg}`)
    } finally {
      setIsSubmitting(false)
    }
  }

  if (isDecrypting) {
    return (
      <div className="flex h-full items-center justify-center">
        <Icons.refresh className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-background p-4 overflow-hidden">
      <form onSubmit={handleSubmit} className="space-y-4 flex-1 overflow-y-auto scrollbar-hide">
        
        <div className="space-y-2">
          <Label htmlFor="name">Name</Label>
          <div className="relative">
            <Icons.tag className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              id="name"
              placeholder="e.g. Google or Visa Card"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="pl-8"
              autoFocus
            />
          </div>
        </div>

        <Tabs value={type} onValueChange={(v) => setType(v as VaultEntry['type'])} className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="login">Login</TabsTrigger>
            <TabsTrigger value="card">Card</TabsTrigger>
            <TabsTrigger value="note">Note</TabsTrigger>
          </TabsList>
          
          <TabsContent value="login" className="space-y-4 pt-4">
            <div className="space-y-2">
              <Label htmlFor="username">Username</Label>
              <div className="relative">
                <Icons.user className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  id="username"
                  placeholder="username@example.com"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="pl-8"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Icons.lock className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  id="password"
                  type="text" // Show as text since we are in edit mode and decrypted
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-8"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="url">URL</Label>
              <div className="relative">
                <Icons.link className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  id="url"
                  type="url"
                  placeholder="https://example.com"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  className="pl-8"
                />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="card" className="space-y-4 pt-4">
            <div className="space-y-2">
              <Label htmlFor="cardHolder">Card Holder</Label>
              <Input
                id="cardHolder"
                placeholder="John Doe"
                value={cardHolder}
                onChange={(e) => setCardHolder(e.target.value)}
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="cardNumber">Card Number</Label>
              <div className="relative">
                <Icons.card className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  id="cardNumber"
                  placeholder="0000 0000 0000 0000"
                  value={cardNumber}
                  onChange={(e) => setCardNumber(e.target.value)}
                  className="pl-8"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-2">
                <Label htmlFor="expMonth">Month</Label>
                <Input
                  id="expMonth"
                  placeholder="MM"
                  maxLength={2}
                  value={cardExpMonth}
                  onChange={(e) => setCardExpMonth(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="expYear">Year</Label>
                <Input
                  id="expYear"
                  placeholder="YY"
                  maxLength={2}
                  value={cardExpYear}
                  onChange={(e) => setCardExpYear(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cvv">CVV</Label>
                <Input
                  id="cvv"
                  placeholder="123"
                  maxLength={4}
                  value={cardCvv}
                  onChange={(e) => setCardCvv(e.target.value)}
                />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="note" className="space-y-4 pt-4">
            <div className="space-y-2">
              <Label htmlFor="noteContent">Content</Label>
              <textarea 
                id="noteContent"
                className="flex min-h-[200px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                placeholder="Secure note content..."
                value={noteContent}
                onChange={(e) => setNoteContent(e.target.value)}
              />
            </div>
          </TabsContent>
        </Tabs>

        <div className="space-y-2 pt-4 border-t">
          <Label htmlFor="tags">Tags (comma separated)</Label>
          <Input
            id="tags"
            placeholder="work, personal, finance"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
          />
        </div>

        <div className="pt-4 flex gap-2">
          <Button type="button" variant="outline" className="flex-1" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" className="flex-1" disabled={isSubmitting || !name}>
            {isSubmitting ? <Icons.refresh className="h-4 w-4 animate-spin" /> : 'Save'}
          </Button>
        </div>
      </form>
    </div>
  )
}
