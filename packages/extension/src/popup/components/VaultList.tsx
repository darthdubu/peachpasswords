import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useVault } from '../contexts/VaultContext'
import { Input } from './ui/input'
import { Button } from './ui/button'
import { ScrollArea } from './ui/scroll-area'
import { Icons } from './icons'
import { VaultEntry } from '@lotus/shared'

interface VaultListProps {
  onSelectEntry: (entry: VaultEntry) => void
  onAddEntry: () => void
}

export function VaultList({ onSelectEntry, onAddEntry }: VaultListProps) {
  const { searchEntries } = useVault()
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedType, setSelectedType] = useState<string | null>(null)

  const entries = searchEntries(searchQuery)
  
  const filteredEntries = useMemo(() => {
    if (!selectedType) return entries
    return entries.filter(e => e.type === selectedType)
  }, [entries, selectedType])

  const favorites = useMemo(() => 
    entries.filter(e => e.favorite),
    [entries]
  )

  const getIconForType = (type: string) => {
    switch (type) {
      case 'login': return Icons.key
      case 'card': return Icons.card
      case 'identity': return Icons.user
      case 'note': return Icons.note
      default: return Icons.lock
    }
  }

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'login': return 'bg-blue-500/20 text-blue-400'
      case 'card': return 'bg-emerald-500/20 text-emerald-400'
      case 'identity': return 'bg-violet-500/20 text-violet-400'
      case 'note': return 'bg-amber-500/20 text-amber-400'
      default: return 'bg-primary/20 text-primary'
    }
  }

  const getSubtitle = (entry: VaultEntry) => {
    if (entry.login?.username) return entry.login.username
    if (entry.card?.number) return `•••• ${entry.card.number.slice(-4)}`
    if (entry.identity?.email) return entry.identity.email
    return 'Secure content'
  }

  const typeFilters = [
    { type: null as string | null, icon: Icons.layoutGrid, label: 'All' },
    { type: 'login', icon: Icons.key, label: 'Passwords' },
    { type: 'card', icon: Icons.card, label: 'Cards' },
    { type: 'identity', icon: Icons.user, label: 'IDs' },
    { type: 'note', icon: Icons.note, label: 'Notes' },
  ]

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="relative p-4 space-y-4 gradient-mesh">
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Icons.search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/60" />
            <Input
              placeholder="Search your vault..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 pr-4 h-11 bg-background/80 backdrop-blur-sm border-border/50 focus:border-primary/50 transition-all"
            />
          </div>
          <Button 
            size="icon" 
            onClick={onAddEntry}
            className="h-11 w-11 glow-primary"
          >
            <Icons.plus className="h-5 w-5" />
          </Button>
        </div>
        
        <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
          {typeFilters.map((filter) => {
            const Icon = filter.icon
            const isActive = selectedType === filter.type
            return (
              <button
                key={filter.label}
                onClick={() => setSelectedType(isActive ? null : filter.type)}
                className={`
                  flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium
                  transition-all duration-200 whitespace-nowrap
                  ${isActive 
                    ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/25' 
                    : 'bg-secondary/80 hover:bg-secondary text-secondary-foreground'
                  }
                `}
              >
                <Icon className="h-3.5 w-3.5" />
                {filter.label}
              </button>
            )
          })}
        </div>
      </div>

      <ScrollArea className="flex-1 custom-scrollbar">
        <div className="p-4 space-y-6">
          {filteredEntries.length === 0 ? (
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex flex-col items-center justify-center py-12 text-center"
            >
              <div className="w-20 h-20 rounded-full bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center mb-4">
                <Icons.shield className="h-10 w-10 text-primary/60" />
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-1">
                {searchQuery ? 'No results found' : 'Your vault is empty'}
              </h3>
              <p className="text-sm text-muted-foreground max-w-[200px]">
                {searchQuery 
                  ? 'Try adjusting your search terms' 
                  : 'Add your first password to get started'
                }
              </p>
              {!searchQuery && (
                <Button onClick={onAddEntry} className="mt-4 gap-2">
                  <Icons.plus className="h-4 w-4" />
                  Add your first entry
                </Button>
              )}
            </motion.div>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-3">
                <div className="glass rounded-xl p-3 text-center">
                  <div className="text-2xl font-bold text-primary">{entries.length}</div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Total</div>
                </div>
                <div className="glass rounded-xl p-3 text-center">
                  <div className="text-2xl font-bold text-amber-500">{favorites.length}</div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Favorites</div>
                </div>
                <div className="glass rounded-xl p-3 text-center">
                  <div className="text-2xl font-bold text-emerald-500">
                    {entries.filter(e => e.login?.password).length}
                  </div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Passwords</div>
                </div>
              </div>

              {favorites.length > 0 && !searchQuery && !selectedType && (
                <div>
                  <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
                    <Icons.star className="h-3 w-3 text-amber-500" />
                    Favorites
                  </h4>
                  <div className="space-y-2">
                    {favorites.slice(0, 3).map((entry, index) => (
                      <EntryCard
                        key={entry.id}
                        entry={entry}
                        index={index}
                        onClick={() => onSelectEntry(entry)}
                        getIconForType={getIconForType}
                        getTypeColor={getTypeColor}
                        getSubtitle={getSubtitle}
                        isFavorite
                      />
                    ))}
                  </div>
                </div>
              )}

              <div>
                <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
                  {searchQuery ? 'Search Results' : selectedType ? `${selectedType.charAt(0).toUpperCase() + selectedType.slice(1)}s` : 'All Entries'}
                </h4>
                <div className="space-y-2">
                  <AnimatePresence mode="popLayout">
                    {filteredEntries.map((entry, index) => (
                      <EntryCard
                        key={entry.id}
                        entry={entry}
                        index={index}
                        onClick={() => onSelectEntry(entry)}
                        getIconForType={getIconForType}
                        getTypeColor={getTypeColor}
                        getSubtitle={getSubtitle}
                      />
                    ))}
                  </AnimatePresence>
                </div>
              </div>
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

interface EntryCardProps {
  entry: VaultEntry
  index: number
  onClick: () => void
  getIconForType: (type: string) => React.ComponentType<{ className?: string }>
  getTypeColor: (type: string) => string
  getSubtitle: (entry: VaultEntry) => string
  isFavorite?: boolean
}

function EntryCard({ entry, index, onClick, getIconForType, getTypeColor, getSubtitle, isFavorite }: EntryCardProps) {
  const Icon = getIconForType(entry.type)
  const typeColor = getTypeColor(entry.type)

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ delay: index * 0.03 }}
      onClick={onClick}
      className={`
        group flex items-center p-3 rounded-xl cursor-pointer
        transition-all duration-200 ease-out
        glass hover:bg-white/[0.05] 
        hover:shadow-lg hover:shadow-primary/10
        hover:scale-[1.02] hover:-translate-y-0.5
        ${isFavorite ? 'border-amber-500/20' : ''}
      `}
    >
      <div className={`
        h-11 w-11 rounded-xl flex items-center justify-center mr-3
        transition-transform duration-200 group-hover:scale-110
        ${typeColor}
      `}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h3 className="font-medium text-sm truncate text-foreground/90">{entry.name}</h3>
          {entry.favorite && (
            <Icons.star className="h-3 w-3 text-amber-500 fill-amber-500 flex-shrink-0" />
          )}
        </div>
        <p className="text-xs text-muted-foreground truncate mt-0.5">
          {getSubtitle(entry)}
        </p>
      </div>
      <div className="flex items-center gap-2">
        {entry.tags.slice(0, 2).map(tag => (
          <span 
            key={tag} 
            className="hidden sm:inline-block px-1.5 py-0.5 text-[10px] rounded bg-secondary text-secondary-foreground"
          >
            {tag}
          </span>
        ))}
        <Icons.chevronRight className="h-4 w-4 text-muted-foreground/50 transition-colors group-hover:text-primary" />
      </div>
    </motion.div>
  )
}