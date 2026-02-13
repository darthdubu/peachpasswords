import { useState } from 'react'
import { ArrowLeft, Save, Plus, Trash2, RefreshCw, Star } from 'lucide-react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { useVault } from '../contexts/VaultContext'
import { toast } from 'sonner'

interface EntryFormProps {
  entryId: string | null
  onCancel: () => void
  onSave: () => void
}

export function EntryForm({ entryId, onCancel, onSave }: EntryFormProps) {
  const { getEntry, addEntry, updateEntry } = useVault()
  const existingEntry = entryId ? getEntry(entryId) : null

  const [name, setName] = useState(existingEntry?.name || '')
  const [username, setUsername] = useState(existingEntry?.login?.username || '')
  const [password, setPassword] = useState(existingEntry?.login?.password || '')
  const [urls, setUrls] = useState<string[]>(existingEntry?.login?.urls || [''])
  const [note, setNote] = useState<string>(String(existingEntry?.note || ''))
  const [favorite, setFavorite] = useState(existingEntry?.favorite || false)
  const type = existingEntry?.type || 'login'

  const handleSave = () => {
    if (!name.trim()) {
      toast.error('Please enter a name')
      return
    }

    const entry = {
      id: existingEntry?.id || crypto.randomUUID(),
      type,
      name: name.trim(),
      favorite,
      created: existingEntry?.created || Date.now(),
      modified: Date.now(),
      login: type === 'login' ? {
        username: username.trim(),
        password,
        urls: urls.filter(u => u.trim())
      } : undefined,
      note: note.trim() || undefined
    }

    if (existingEntry) {
      updateEntry(entry as any)
      toast.success('Entry updated')
    } else {
      addEntry(entry as any)
      toast.success('Entry created')
    }

    onSave()
  }

  const handleAddUrl = () => {
    setUrls([...urls, ''])
  }

  const handleUpdateUrl = (index: number, value: string) => {
    const newUrls = [...urls]
    newUrls[index] = value
    setUrls(newUrls)
  }

  const handleRemoveUrl = (index: number) => {
    setUrls(urls.filter((_, i) => i !== index))
  }

  const generatePassword = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*'
    let result = ''
    for (let i = 0; i < 16; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    setPassword(result)
  }

  return (
    <div className="flex flex-col h-screen bg-background">
      <header className="flex items-center justify-between p-4 border-b">
        <Button variant="ghost" size="icon" onClick={onCancel}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        
        <h1 className="font-semibold">{existingEntry ? 'Edit Entry' : 'New Entry'}</h1>
        
        <Button variant="ghost" size="icon" onClick={handleSave}>
          <Save className="w-5 h-5" />
        </Button>
      </header>

      <div className="flex-1 overflow-auto p-4 space-y-4">
        <div className="flex items-center gap-4">
          <button
            onClick={() => setFavorite(!favorite)}
            className={`w-12 h-12 rounded-xl flex items-center justify-center transition-colors ${
              favorite ? 'bg-[#FFB07C]/20 text-[#FFB07C]' : 'bg-muted'
            }`}
          >
            <Star className={`w-6 h-6 ${favorite ? 'fill-[#FFB07C]' : ''}`} />
          </button>
          
          <div className="flex-1">
            <Input
              placeholder="Entry name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="text-lg"
            />
          </div>
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm text-muted-foreground">Username</label>
            <Input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="username@example.com"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm text-muted-foreground">Password</label>
            <div className="flex gap-2">
              <Input
                type="text"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                className="flex-1 font-mono"
              />
              <Button variant="outline" onClick={generatePassword}>
                <RefreshCw className="w-4 h-4" />
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm text-muted-foreground">Websites</label>
            {urls.map((url, index) => (
              <div key={index} className="flex gap-2">
                <Input
                  value={url}
                  onChange={(e) => handleUpdateUrl(index, e.target.value)}
                  placeholder="https://example.com"
                />
                {urls.length > 1 && (
                  <Button variant="ghost" size="icon" onClick={() => handleRemoveUrl(index)}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                )}
              </div>
            ))}
            <Button variant="outline" onClick={handleAddUrl} className="w-full">
              <Plus className="w-4 h-4 mr-2" />
              Add Website
            </Button>
          </div>

          <div className="space-y-2">
            <label className="text-sm text-muted-foreground">Notes</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Add notes..."
              className="w-full min-h-[100px] p-3 rounded-md border bg-transparent resize-none"
            />
          </div>
        </div>
      </div>

      <div className="p-4 border-t">
        <Button onClick={handleSave} className="w-full bg-gradient-to-r from-[#FFB07C] to-[#FF8C69]">
          {existingEntry ? 'Update Entry' : 'Create Entry'}
        </Button>
      </div>
    </div>
  )
}
