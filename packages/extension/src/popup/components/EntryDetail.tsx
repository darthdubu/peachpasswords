import { useState, useEffect } from 'react'
import { useVault } from '../contexts/VaultContext'
import { Button } from './ui/button'
import { Icons } from './icons'
import { VaultEntry } from '@lotus/shared'
import { Label } from './ui/label'
import { Input } from './ui/input'

interface EntryDetailProps {
  entry: VaultEntry
  onEdit: () => void
  onDelete: () => void
}

export function EntryDetail({ entry, onEdit, onDelete }: EntryDetailProps) {
  const { decryptValue } = useVault()

  // Decrypted values
  const [decryptedPassword, setDecryptedPassword] = useState<string | null>(null)
  const [decryptedCardNumber, setDecryptedCardNumber] = useState<string | null>(null)
  const [decryptedCvv, setDecryptedCvv] = useState<string | null>(null)
  const [decryptedNote, setDecryptedNote] = useState<string | null>(null)

  // Visibility states
  const [showPassword, setShowPassword] = useState(false)
  const [showCardNumber, setShowCardNumber] = useState(false)
  const [showCvv, setShowCvv] = useState(false)

  const [decryptingField, setDecryptingField] = useState<string | null>(null)

  // Auto-decrypt note content on mount
  useEffect(() => {
    if (entry.type === 'note' && entry.note?.content && !decryptedNote) {
      decryptValue(entry.note.content, entry.id).then(setDecryptedNote).catch(console.error)
    }
  }, [entry, decryptValue, decryptedNote])

  const handleReveal = async (field: 'password' | 'cardNumber' | 'cvv' | 'note') => {
    setDecryptingField(field)
    try {
      if (field === 'password') {
        if (showPassword) {
          setShowPassword(false)
        } else {
          if (!decryptedPassword && entry.login?.password) {
            const val = await decryptValue(entry.login.password, entry.id)
            setDecryptedPassword(val)
          }
          setShowPassword(true)
        }
      } else if (field === 'cardNumber') {
        if (showCardNumber) {
          setShowCardNumber(false)
        } else {
          if (!decryptedCardNumber && entry.card?.number) {
            const val = await decryptValue(entry.card.number, entry.id)
            setDecryptedCardNumber(val)
          }
          setShowCardNumber(true)
        }
      } else if (field === 'cvv') {
        if (showCvv) {
          setShowCvv(false)
        } else {
          if (!decryptedCvv && entry.card?.cvv) {
            const val = await decryptValue(entry.card.cvv, entry.id)
            setDecryptedCvv(val)
          }
          setShowCvv(true)
        }
      }
    } catch (error) {
      console.error(`Failed to decrypt ${field}:`, error)
    } finally {
      setDecryptingField(null)
    }
  }

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text)
    // TODO: Show toast
  }

  const handleCopyEncrypted = async (field: 'password' | 'cardNumber' | 'cvv' | 'note') => {
    try {
       let val = ''
       if (field === 'password' && entry.login?.password) val = decryptedPassword || await decryptValue(entry.login.password, entry.id)
       if (field === 'cardNumber' && entry.card?.number) val = decryptedCardNumber || await decryptValue(entry.card.number, entry.id)
       if (field === 'cvv' && entry.card?.cvv) val = decryptedCvv || await decryptValue(entry.card.cvv, entry.id)
       if (field === 'note' && entry.note?.content) val = decryptedNote || await decryptValue(entry.note.content, entry.id)
       
       if (val) handleCopy(val)
    } catch (e) {
      console.error(e)
    }
  }

  return (
    <div className="flex flex-col h-full bg-background p-4 space-y-6">
      <div className="space-y-4">
        
        {/* Login Details */}
        {entry.type === 'login' && (
          <>
            <div className="space-y-2">
              <Label>Username</Label>
              <div className="flex gap-2">
                <Input readOnly value={entry.login?.username || ''} />
                <Button variant="outline" size="icon" onClick={() => handleCopy(entry.login?.username || '')}>
                  <Icons.copy className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Password</Label>
              <div className="flex gap-2">
                <Input 
                  readOnly 
                  type={showPassword ? "text" : "password"} 
                  value={showPassword ? decryptedPassword || '' : "••••••••"} 
                />
                <Button variant="outline" size="icon" onClick={() => handleReveal('password')}>
                  {decryptingField === 'password' ? <Icons.refresh className="h-4 w-4 animate-spin" /> : (showPassword ? <Icons.eyeOff className="h-4 w-4" /> : <Icons.eye className="h-4 w-4" />)}
                </Button>
                <Button variant="outline" size="icon" onClick={() => handleCopyEncrypted('password')}>
                  <Icons.copy className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {entry.login?.urls && entry.login.urls.length > 0 && (
              <div className="space-y-2">
                <Label>URL</Label>
                <div className="flex gap-2">
                  <Input readOnly value={entry.login.urls[0]} />
                  <Button variant="outline" size="icon" onClick={() => handleCopy(entry.login?.urls[0] || '')}>
                    <Icons.copy className="h-4 w-4" />
                  </Button>
                  <Button variant="outline" size="icon" onClick={() => window.open(entry.login?.urls[0], '_blank')}>
                    <Icons.link className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </>
        )}

        {/* Card Details */}
        {entry.type === 'card' && (
          <>
            <div className="space-y-2">
              <Label>Card Holder</Label>
              <div className="flex gap-2">
                <Input readOnly value={entry.card?.holder || ''} />
                <Button variant="outline" size="icon" onClick={() => handleCopy(entry.card?.holder || '')}>
                  <Icons.copy className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Card Number</Label>
              <div className="flex gap-2">
                <Input 
                  readOnly 
                  type={showCardNumber ? "text" : "password"} 
                  value={showCardNumber ? decryptedCardNumber || '' : "••••••••••••••••"} 
                />
                <Button variant="outline" size="icon" onClick={() => handleReveal('cardNumber')}>
                   {decryptingField === 'cardNumber' ? <Icons.refresh className="h-4 w-4 animate-spin" /> : (showCardNumber ? <Icons.eyeOff className="h-4 w-4" /> : <Icons.eye className="h-4 w-4" />)}
                </Button>
                <Button variant="outline" size="icon" onClick={() => handleCopyEncrypted('cardNumber')}>
                  <Icons.copy className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-2">
                <Label>Exp Date</Label>
                <Input readOnly value={`${entry.card?.expMonth}/${entry.card?.expYear}`} />
              </div>
              <div className="space-y-2 col-span-2">
                <Label>CVV</Label>
                <div className="flex gap-2">
                  <Input 
                    readOnly 
                    type={showCvv ? "text" : "password"} 
                    value={showCvv ? decryptedCvv || '' : "•••"} 
                  />
                  <Button variant="outline" size="icon" onClick={() => handleReveal('cvv')}>
                     {decryptingField === 'cvv' ? <Icons.refresh className="h-4 w-4 animate-spin" /> : (showCvv ? <Icons.eyeOff className="h-4 w-4" /> : <Icons.eye className="h-4 w-4" />)}
                  </Button>
                  <Button variant="outline" size="icon" onClick={() => handleCopyEncrypted('cvv')}>
                    <Icons.copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          </>
        )}

        {/* Note Details */}
        {entry.type === 'note' && (
          <div className="space-y-2">
            <Label>Content</Label>
            <div className="relative">
              <textarea 
                readOnly
                className="flex min-h-[200px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none"
                value={decryptedNote || ''}
              />
              <Button 
                variant="ghost" 
                size="icon" 
                className="absolute top-2 right-2" 
                onClick={() => handleCopyEncrypted('note')}
              >
                <Icons.copy className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

      </div>

      <div className="flex gap-2 pt-4 border-t mt-auto">
        <Button variant="outline" className="flex-1" onClick={onEdit}>
          <Icons.settings className="h-4 w-4 mr-2" />
          Edit
        </Button>
        <Button variant="destructive" className="flex-1" onClick={onDelete}>
          <Icons.trash className="h-4 w-4 mr-2" />
          Delete
        </Button>
      </div>
    </div>
  )
}
