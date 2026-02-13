import React, { useState } from 'react'
import { motion } from 'framer-motion'
import { Search, Plus, Settings, Trash2, Star, Folder } from 'lucide-react'
import { Input } from './ui/input'
import { Button } from './ui/button'
import { useVault } from '../contexts/VaultContext'

interface VaultListProps {
  onSelectEntry: (entryId: string) => void
  onAddEntry: () => void
  onOpenSettings: () => void
}

export function VaultList({ onSelectEntry, onAddEntry, onOpenSettings }: VaultListProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const { searchEntries, lockVault, vault } = useVault()
  
  const entries = searchEntries(searchQuery)
  const favorites = entries.filter(e => e.favorite)

  return (
    <div className="flex flex-col h-screen bg-background">
      <header className="flex items-center justify-between p-4 border-b">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-gradient-to-br from-[#FFB07C] to-[#FF8C69] rounded-lg flex items-center justify-center">
            <span className="text-white font-bold text-sm">P</span>
          </div>
          <h1 className="font-semibold">Peach</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={onOpenSettings}>
            <Settings className="w-5 h-5" />
          </Button>
        </div>
      </header>

      <div className="p-4 border-b">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search entries..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <p>No entries found</p>
            <Button onClick={onAddEntry} className="mt-4">
              <Plus className="w-4 h-4 mr-2" />
              Add your first entry
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            {favorites.length > 0 && !searchQuery && (
              <div className="mb-4">
                <h3 className="text-sm font-medium text-muted-foreground mb-2 flex items-center gap-1">
                  <Star className="w-3 h-3" /> Favorites
                </h3>
                {favorites.map(entry => (
                  <EntryRow key={entry.id} entry={entry} onClick={() => onSelectEntry(entry.id)} />
                ))}
              </div>
            )}
            
            <h3 className="text-sm font-medium text-muted-foreground mb-2">
              {searchQuery ? 'Search Results' : 'All Entries'}
            </h3>
            
            {entries.filter(e => !favorites.includes(e) || searchQuery).map(entry => (
              <EntryRow key={entry.id} entry={entry} onClick={() => onSelectEntry(entry.id)} />
            ))}
          </div>
        )}
      </div>

      <div className="p-4 border-t flex justify-between items-center">
        <Button variant="outline" onClick={lockVault}>
          Lock
        </Button>
        <Button onClick={onAddEntry} className="bg-gradient-to-r from-[#FFB07C] to-[#FF8C69]">
          <Plus className="w-4 h-4 mr-2" />
          Add
        </Button>
      </div>
    </div>
  )
}

function EntryRow({ entry, onClick }: { entry: any; onClick: () => void }) {
  return (
    <motion.button
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className="w-full flex items-center gap-3 p-3 rounded-lg bg-card hover:bg-accent transition-colors text-left"
    >
      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#FFB07C]/20 to-[#FF8C69]/20 flex items-center justify-center flex-shrink-0">
        <span className="text-[#FFB07C] font-medium">
          {entry.name?.charAt(0).toUpperCase() || '?'}
        </span>
      </div>
      
      <div className="flex-1 min-w-0">
        <p className="font-medium truncate">{entry.name}</p>
        <p className="text-sm text-muted-foreground truncate">
          {entry.login?.username || 'No username'}
        </p>
      </div>
      
      {entry.favorite && <Star className="w-4 h-4 text-[#FFB07C] flex-shrink-0" />}
    </motion.button>
  )
}
