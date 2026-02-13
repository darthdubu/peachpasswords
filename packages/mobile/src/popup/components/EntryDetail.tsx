import React, { useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowLeft, Edit2, Trash2, Copy, Eye, EyeOff, Star } from 'lucide-react'
import { Button } from './ui/button'
import { useVault } from '../contexts/VaultContext'
import { toast } from 'sonner'

interface EntryDetailProps {
  entryId: string
  onBack: () => void
  onEdit: () => void
}

export function EntryDetail({ entryId, onBack, onEdit }: EntryDetailProps) {
  const { getEntry, deleteEntry, updateEntry } = useVault()
  const [showPassword, setShowPassword] = useState(false)
  
  const entry = getEntry(entryId)
  
  if (!entry) {
    return (
      <div className="flex flex-col h-screen items-center justify-center">
        <p>Entry not found</p>
        <Button onClick={onBack}>Go Back</Button>
      </div>
    )
  }

  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text)
    toast.success(`${label} copied`)
  }

  const handleToggleFavorite = () => {
    updateEntry({ ...entry, favorite: !entry.favorite })
  }

  const handleDelete = () => {
    if (confirm('Move this entry to trash?')) {
      deleteEntry(entryId)
      onBack()
      toast.success('Entry moved to trash')
    }
  }

  return (
    <div className="flex flex-col h-screen bg-background">
      <header className="flex items-center justify-between p-4 border-b">
        <Button variant="ghost" size="icon" onClick={onBack}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={handleToggleFavorite}>
            <Star className={`w-5 h-5 ${entry.favorite ? 'fill-[#FFB07C] text-[#FFB07C]' : ''}`} />
          </Button>
          <Button variant="ghost" size="icon" onClick={onEdit}>
            <Edit2 className="w-5 h-5" />
          </Button>
          <Button variant="ghost" size="icon" onClick={handleDelete}>
            <Trash2 className="w-5 h-5" />
          </Button>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-4 space-y-6">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#FFB07C] to-[#FF8C69] flex items-center justify-center">
            <span className="text-white text-2xl font-bold">
              {entry.name?.charAt(0).toUpperCase() || '?'}
            </span>
          </div>
          <div>
            <h1 className="text-2xl font-bold">{entry.name}</h1>
            <p className="text-muted-foreground">{entry.type}</p>
          </div>
        </div>

        {entry.login && (
          <div className="space-y-4">
            <Field 
              label="Username"
              value={entry.login.username}
              onCopy={() => handleCopy(entry.login.username, 'Username')}
            />
            
            <Field 
              label="Password"
              value={entry.login.password}
              type="password"
              showValue={showPassword}
              onToggleShow={() => setShowPassword(!showPassword)}
              onCopy={() => handleCopy(entry.login.password, 'Password')}
            />

            {entry.login.urls?.length > 0 && (
              <div className="space-y-2">
                <label className="text-sm text-muted-foreground">Websites</label>
                {entry.login.urls.map((url, i) => (
                  <div key={i} className="p-3 bg-muted rounded-lg text-sm break-all">
                    {url}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {entry.note && (
          <div className="space-y-2">
            <label className="text-sm text-muted-foreground">Notes</label>
            <div className="p-3 bg-muted rounded-lg whitespace-pre-wrap">
              {entry.note}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Field({ 
  label, 
  value, 
  type,
  showValue,
  onToggleShow,
  onCopy 
}: { 
  label: string
  value: string
  type?: string
  showValue?: boolean
  onToggleShow?: () => void
  onCopy: () => void
}) {
  return (
    <div className="space-y-2">
      <label className="text-sm text-muted-foreground">{label}</label>
      <div className="flex gap-2">
        <div className="flex-1 p-3 bg-muted rounded-lg font-mono text-sm break-all">
          {type === 'password' && !showValue 
            ? '•'.repeat(Math.min(value?.length || 0, 20))
            : value
          }
        </div>
        
        {type === 'password' && onToggleShow && (
          <Button variant="outline" size="icon" onClick={onToggleShow}>
            {showValue ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </Button>
        )}
        
        <Button variant="outline" size="icon" onClick={onCopy}>
          <Copy className="w-4 h-4" />
        </Button>
      </div>
    </div>
  )
}
