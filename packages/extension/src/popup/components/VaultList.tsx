import { useState, useMemo, useDeferredValue, memo, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useVaultActions, useVaultState } from '../contexts/VaultContext'
import { Icons } from './icons'
import { VaultEntry } from '@lotus/shared'
import { getUrlMatchScore, parseUrlCandidate } from '../../lib/url-match'
import { cn } from '@/lib/utils'

interface VaultListProps {
  filter: 'all' | 'login' | 'card' | 'identity' | 'note' | 'favorite' | 'trash'
  searchQuery: string
  onSearchChange: (query: string) => void
  onSelectEntry: (entry: VaultEntry) => void
  syncStatus?: string
  s3SyncStatus?: string
}

function getTrashedAt(entry: VaultEntry): number | undefined {
  return (entry as VaultEntry & { trashedAt?: number }).trashedAt
}

function getTrashExpiresAt(entry: VaultEntry): number | undefined {
  return (entry as VaultEntry & { trashExpiresAt?: number }).trashExpiresAt
}

function getIconForType(type: string) {
  switch (type) {
    case 'login': return Icons.key
    case 'card': return Icons.card
    case 'identity': return Icons.user
    case 'note': return Icons.note
    default: return Icons.lock
  }
}

function getTypeColor(type: string) {
  switch (type) {
    case 'login': return 'bg-blue-500/10 text-blue-400'
    case 'card': return 'bg-emerald-500/10 text-emerald-400'
    case 'identity': return 'bg-violet-500/10 text-violet-400'
    case 'note': return 'bg-amber-500/10 text-amber-400'
    default: return 'bg-white/10 text-white/60'
  }
}

function getSubtitle(entry: VaultEntry) {
  if (typeof entry.login?.username === 'string' && entry.login.username.length > 0) return entry.login.username
  if (entry.card?.number) return `•••• ${entry.card.number.slice(-4)}`
  if (entry.identity?.email) return entry.identity.email
  return ''
}

function getFilterLabel(filter: string) {
  switch (filter) {
    case 'all': return 'All Items'
    case 'favorite': return 'Favorites'
    case 'login': return 'Passwords'
    case 'card': return 'Cards'
    case 'note': return 'Notes'
    case 'trash': return 'Trash'
    default: return 'Items'
  }
}

function getSyncStatusColor(syncStatus?: string, s3SyncStatus?: string): string {
  const anyError = syncStatus === 'error' || s3SyncStatus === 'error'
  const anyConnected = syncStatus === 'connected' || s3SyncStatus === 'connected'
  const anyConnecting = syncStatus === 'connecting' || s3SyncStatus === 'connecting'
  
  if (anyError) return 'text-red-400'
  if (anyConnecting) return 'text-amber-400'
  if (anyConnected) return 'text-emerald-400'
  return 'text-white/30'
}

function SyncStatusIcon({ syncStatus, s3SyncStatus }: { syncStatus?: string; s3SyncStatus?: string }) {
  const colorClass = getSyncStatusColor(syncStatus, s3SyncStatus)
  
  return (
    <div className="flex items-center gap-1.5">
      <Icons.cloud className={cn("h-3.5 w-3.5", colorClass)} />
      <span className={cn("w-1.5 h-1.5 rounded-full", colorClass.replace('text-', 'bg-'))} />
    </div>
  )
}

export function VaultList({ filter, searchQuery, onSearchChange, onSelectEntry, syncStatus, s3SyncStatus }: VaultListProps) {
  const { searchEntries, getTrashedEntries, restoreEntry, permanentlyDeleteEntry, deleteEntry, updateEntry } = useVaultActions()
  const { vault, lastSyncTime, s3LastSyncTime } = useVaultState()
  const [currentSiteUrl, setCurrentSiteUrl] = useState('')
  const [currentSiteHost, setCurrentSiteHost] = useState('')
  const [isSearchFocused, setIsSearchFocused] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [isBulkMode, setIsBulkMode] = useState(false)
  const deferredSearchQuery = useDeferredValue(searchQuery)
  const allEntries = useMemo(() => (Array.isArray(vault?.entries) ? vault.entries.filter((entry) => !getTrashedAt(entry)) : []), [vault?.entries])
  const tabRefreshTimerRef = useRef<number | null>(null)

  const entries = useMemo(() => { const r = searchEntries(deferredSearchQuery); return Array.isArray(r) ? r : [] }, [searchEntries, deferredSearchQuery])
  
  const filteredEntries = useMemo(() => {
    if (filter === 'favorite') return entries.filter(e => e.favorite)
    if (filter === 'trash') {
      return getTrashedEntries()
        .filter(e => !deferredSearchQuery.trim() || `${e.name} ${e.login?.username}`.toLowerCase().includes(deferredSearchQuery.toLowerCase()))
        .sort((a, b) => Number(getTrashedAt(b) || 0) - Number(getTrashedAt(a) || 0))
    }
    if (filter !== 'all') return entries.filter(e => e.type === filter)
    return entries
  }, [deferredSearchQuery, entries, filter, getTrashedEntries])

  const currentSiteMatches = useMemo(() => {
    console.log('[Peach Debug] currentSiteUrl:', currentSiteUrl)
    console.log('[Peach Debug] allEntries count:', allEntries.length)
    if (!currentSiteUrl) return []
    const matches = allEntries
      .filter(e => e.type === 'login' && e.login)
      .map(e => ({ entry: e, score: (e.login?.urls || []).reduce((b, u) => Math.max(b, getUrlMatchScore(u, currentSiteUrl)), 0) }))
      .filter(m => m.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
    console.log('[Peach Debug] currentSiteMatches:', matches.length)
    return matches
  }, [currentSiteUrl, allEntries])

  const refreshCurrentSite = useCallback(() => {
    chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
      const activeUrl = tabs[0]?.url || ''
      const parsed = activeUrl ? parseUrlCandidate(activeUrl) : null
      if (parsed) {
        setCurrentSiteUrl(parsed.toString())
        setCurrentSiteHost(parsed.hostname)
      }
    }).catch(() => {})
  }, [])

  useEffect(() => {
    const scheduleRefresh = () => {
      if (tabRefreshTimerRef.current) window.clearTimeout(tabRefreshTimerRef.current)
      tabRefreshTimerRef.current = window.setTimeout(() => refreshCurrentSite(), 120)
    }
    scheduleRefresh()
    chrome.tabs.onActivated?.addListener(scheduleRefresh)
    chrome.tabs.onUpdated?.addListener(scheduleRefresh)
    return () => {
      if (tabRefreshTimerRef.current) window.clearTimeout(tabRefreshTimerRef.current)
      chrome.tabs.onActivated?.removeListener(scheduleRefresh)
      chrome.tabs.onUpdated?.removeListener(scheduleRefresh)
    }
  }, [refreshCurrentSite])

  const handleFill = async (entryId?: string) => {
    if (!currentSiteUrl) return
    const response = await chrome.runtime.sendMessage({ type: 'REQUEST_CREDENTIALS', url: currentSiteUrl })
    const credentials = response?.success ? response.credentials : []
    const selected = entryId ? credentials.find((c: any) => c.entryId === entryId) || credentials[0] : credentials[0]
    if (!selected?.password) return
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
    const tabId = tabs[0]?.id
    if (typeof tabId === 'number') {
      await chrome.tabs.sendMessage(tabId, { type: 'PEACH_FILL_LOGIN', username: selected.username || '', password: selected.password })
    }
  }

  if (filter === 'trash') {
    const trashed = filteredEntries as VaultEntry[]
    return (
      <div className="h-full flex flex-col p-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-medium text-white/80">Trash</h2>
          <span className="text-xs text-white/40">{trashed.length} items</span>
        </div>
        <div className="relative mb-3">
          <Icons.search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30" />
          <input
            type="text"
            placeholder="Search trash..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full h-9 pl-9 pr-3 rounded-lg bg-white/[0.03] border border-white/[0.06] text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-white/[0.12] transition-colors"
          />
        </div>
        <div className="flex-1 overflow-y-auto scrollbar-hide -mx-1 px-1">
          <AnimatePresence>
            {trashed.length === 0 ? (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex flex-col items-center justify-center h-32 text-white/30"
              >
                <Icons.trash className="h-8 w-8 mb-2 opacity-50" />
                <p className="text-xs">Trash is empty</p>
              </motion.div>
            ) : (
              trashed.map((entry, index) => (
                <TrashItem 
                  key={entry.id} 
                  entry={entry} 
                  index={index}
                  onRestore={() => restoreEntry(entry.id)}
                  onDelete={() => permanentlyDeleteEntry(entry.id)}
                />
              ))
            )}
          </AnimatePresence>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-center justify-between mb-3">
          {isBulkMode ? (
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setIsBulkMode(false)
                  setSelectedIds(new Set())
                }}
                className="text-xs text-white/60 hover:text-white/90"
              >
                Cancel
              </button>
              <span className="text-xs text-white/40">
                {selectedIds.size} selected
              </span>
            </div>
          ) : (
            <h1 className="text-sm font-medium text-white/90">{getFilterLabel(filter)}</h1>
          )}
          <div className="flex items-center gap-2">
            {(filter as string) !== 'trash' && !isBulkMode && (
              <button
                onClick={() => setIsBulkMode(true)}
                className="text-[10px] text-white/40 hover:text-white/70 transition-colors"
              >
                Select
              </button>
            )}
            {(lastSyncTime || s3LastSyncTime) && !isBulkMode && (
              <span className="text-[10px] text-white/30">
                {(() => {
                  const lastSync = Math.max(lastSyncTime || 0, s3LastSyncTime || 0)
                  if (!lastSync) return ''
                  const mins = Math.floor((Date.now() - lastSync) / 60000)
                  if (mins < 1) return 'Just now'
                  if (mins < 60) return `${mins}m ago`
                  const hours = Math.floor(mins / 60)
                  if (hours < 24) return `${hours}h ago`
                  return `${Math.floor(hours / 24)}d ago`
                })()}
              </span>
            )}
            <SyncStatusIcon syncStatus={syncStatus} s3SyncStatus={s3SyncStatus} />
          </div>
        </div>
        
        <div className={cn(
          "relative transition-all duration-200",
          isSearchFocused && "scale-[1.02]"
        )}>
          <Icons.search className={cn(
            "absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 transition-colors",
            isSearchFocused ? "text-white/50" : "text-white/30"
          )} />
          <input
            type="text"
            placeholder="Search vault..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            onFocus={() => setIsSearchFocused(true)}
            onBlur={() => setIsSearchFocused(false)}
            className={cn(
              "w-full h-9 pl-9 pr-3 rounded-lg text-sm transition-all duration-200",
              "bg-white/[0.03] text-white placeholder:text-white/25",
              "border border-transparent focus:border-white/[0.12]",
              "focus:outline-none focus:bg-white/[0.04]"
            )}
          />
          {searchQuery && (
            <button
              onClick={() => onSearchChange('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 rounded-full hover:bg-white/[0.08] transition-colors"
            >
              <Icons.close className="h-3 w-3 text-white/40" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-hide px-4 pb-4">
        <AnimatePresence mode="wait">
          {!searchQuery && currentSiteHost && currentSiteMatches.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="mb-3 p-3 rounded-lg bg-primary/5 border border-primary/10"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                  <span className="text-xs text-white/70">{currentSiteHost}</span>
                </div>
                <button 
                  onClick={() => handleFill()} 
                  className="text-[10px] font-medium text-primary hover:text-primary/80 transition-colors"
                >
                  Auto-fill
                </button>
              </div>
              <div className="space-y-1">
                {currentSiteMatches.map(({ entry }) => (
                  <button 
                    key={entry.id} 
                    onClick={() => onSelectEntry(entry)} 
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-left hover:bg-white/[0.04] transition-colors"
                  >
                    <span className="text-xs text-white/80 truncate flex-1">{entry.name}</span>
                    <span className="text-[10px] text-white/40 truncate">{getSubtitle(entry)}</span>
                  </button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="space-y-1">
          <AnimatePresence>
            {filteredEntries.length === 0 ? (
              <EmptyState
                searchQuery={searchQuery}
                filter={filter}
              />
            ) : (
              filteredEntries.map((entry, index) => (
                <EntryCard 
                  key={entry.id} 
                  entry={entry} 
                  index={index}
                  onClick={() => onSelectEntry(entry)}
                  isBulkMode={isBulkMode}
                  isSelected={selectedIds.has(entry.id)}
                  onToggleSelect={() => {
                    const newSelected = new Set(selectedIds)
                    if (newSelected.has(entry.id)) {
                      newSelected.delete(entry.id)
                    } else {
                      newSelected.add(entry.id)
                    }
                    setSelectedIds(newSelected)
                  }}
                />
              ))
            )}
          </AnimatePresence>
        </div>

        {isBulkMode && selectedIds.size > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="absolute bottom-0 left-0 right-0 p-3 bg-[#0d0d12] border-t border-white/[0.06] flex items-center justify-between"
          >
            <span className="text-xs text-white/60">{selectedIds.size} selected</span>
            <div className="flex items-center gap-2">
              <button
                onClick={async () => {
                  if (confirm(`Delete ${selectedIds.size} items?`)) {
                    for (const id of selectedIds) {
                      await deleteEntry(id)
                    }
                    setSelectedIds(new Set())
                    setIsBulkMode(false)
                  }
                }}
                className="px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 text-xs font-medium hover:bg-red-500/20 transition-colors"
              >
                Delete
              </button>
              <button
                onClick={() => {
                  const tag = prompt('Enter tag to add:')
                  if (tag) {
                    for (const id of selectedIds) {
                      const entry = vault?.entries.find(e => e.id === id)
                      if (entry) {
                        const tags = entry.tags || []
                        if (!tags.includes(tag)) {
                          updateEntry({ ...entry, tags: [...tags, tag] })
                        }
                      }
                    }
                    setSelectedIds(new Set())
                    setIsBulkMode(false)
                  }
                }}
                className="px-3 py-1.5 rounded-lg bg-white/[0.06] text-white/80 text-xs font-medium hover:bg-white/[0.10] transition-colors"
              >
                Add Tag
              </button>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  )
}

function EmptyState({ searchQuery, filter }: { searchQuery: string; filter: string }) {
  const getMessage = () => {
    if (searchQuery) {
      return {
        title: 'No matches found',
        subtitle: 'Try a different search term',
        icon: Icons.search
      }
    }
    switch (filter) {
      case 'favorite':
        return {
          title: 'No favorites yet',
          subtitle: 'Star entries to see them here',
          icon: Icons.star
        }
      case 'trash':
        return {
          title: 'Trash is empty',
          subtitle: 'Deleted items appear here',
          icon: Icons.trash
        }
      case 'login':
        return {
          title: 'No logins saved',
          subtitle: 'Add your first login credentials',
          icon: Icons.key
        }
      case 'card':
        return {
          title: 'No cards saved',
          subtitle: 'Add your first payment card',
          icon: Icons.card
        }
      case 'note':
        return {
          title: 'No notes saved',
          subtitle: 'Add your first secure note',
          icon: Icons.note
        }
      default:
        return {
          title: 'Your vault is empty',
          subtitle: 'Click the + button to add your first item',
          icon: Icons.shield
        }
    }
  }

  const { title, subtitle, icon: Icon } = getMessage()

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="flex flex-col items-center justify-center h-48 text-white/30"
    >
      <div className="w-12 h-12 rounded-full bg-white/[0.03] flex items-center justify-center mb-3">
        <Icon className="h-5 w-5 opacity-50" />
      </div>
      <p className="text-xs mb-1">{title}</p>
      <p className="text-[10px] text-white/20">{subtitle}</p>
    </motion.div>
  )
}

function TrashItem({ entry, index, onRestore, onDelete }: { 
  entry: VaultEntry
  index: number
  onRestore: () => void
  onDelete: () => void
}) {
  const Icon = getIconForType(entry.type)
  const colorClass = getTypeColor(entry.type)
  const [showConfirm, setShowConfirm] = useState(false)
  
  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.03 }}
      className="group flex items-center gap-3 p-2.5 rounded-lg hover:bg-white/[0.03] transition-colors"
    >
      <div className={cn("w-8 h-8 rounded-md flex items-center justify-center", colorClass)}>
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-white/80 truncate">{entry.name || 'Untitled'}</p>
        <p className="text-[10px] text-white/30 truncate">
          {getTrashExpiresAt(entry) ? `Expires ${new Date(getTrashExpiresAt(entry)!).toLocaleDateString()}` : 'Trash'}
        </p>
      </div>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {!showConfirm ? (
          <>
            <button 
              onClick={onRestore} 
              className="px-2.5 py-1 text-[10px] font-medium text-primary hover:bg-primary/10 rounded transition-colors"
            >
              Restore
            </button>
            <button 
              onClick={() => setShowConfirm(true)} 
              className="px-2.5 py-1 text-[10px] font-medium text-red-400 hover:bg-red-500/10 rounded transition-colors"
            >
              Delete
            </button>
          </>
        ) : (
          <>
            <span className="text-[10px] text-white/60 mr-1">Permanently delete?</span>
            <button 
              onClick={() => setShowConfirm(false)} 
              className="px-2.5 py-1 text-[10px] font-medium text-white/60 hover:bg-white/10 rounded transition-colors"
            >
              Cancel
            </button>
            <button 
              onClick={() => { setShowConfirm(false); onDelete(); }} 
              className="px-2.5 py-1 text-[10px] font-medium text-red-400 hover:bg-red-500/10 rounded transition-colors"
            >
              Confirm
            </button>
          </>
        )}
      </div>
    </motion.div>
  )
}

interface EntryCardProps {
  entry: VaultEntry
  index: number
  onClick: () => void
  isBulkMode?: boolean
  isSelected?: boolean
  onToggleSelect?: () => void
}

const EntryCard = memo(function EntryCard({ entry, index, onClick, isBulkMode, isSelected, onToggleSelect }: EntryCardProps) {
  const Icon = getIconForType(entry.type)
  const colorClass = getTypeColor(entry.type)
  const subtitle = getSubtitle(entry)
  const [faviconError, setFaviconError] = useState(false)

  const faviconUrl = entry.type === 'login' && entry.login?.urls?.[0]
    ? `https://icons.duckduckgo.com/ip3/${encodeURIComponent(new URL(entry.login.urls[0]).hostname)}.ico`
    : null

  return (
    <motion.button
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.02, duration: 0.2 }}
      onClick={isBulkMode ? onToggleSelect : onClick}
      className={cn(
        "w-full group flex items-center gap-3 p-2.5 rounded-lg transition-all duration-150 text-left",
        isSelected ? "bg-primary/10" : "hover:bg-white/[0.04] active:bg-white/[0.06]"
      )}
    >
      {isBulkMode && (
        <div className={cn(
          "w-5 h-5 rounded border flex items-center justify-center transition-colors",
          isSelected ? "bg-primary border-primary" : "border-white/20"
        )}>
          {isSelected && <Icons.check className="h-3 w-3 text-white" />}
        </div>
      )}
      <div className={cn(
        "w-9 h-9 rounded-lg flex items-center justify-center transition-transform duration-200 overflow-hidden shrink-0",
        !faviconUrl || faviconError ? colorClass : "bg-white/[0.06]",
        !isBulkMode && "group-hover:scale-105"
      )}>
        {faviconUrl && !faviconError ? (
          <img
            src={faviconUrl}
            alt=""
            className="w-5 h-5"
            onError={() => setFaviconError(true)}
          />
        ) : (
          <Icon className="h-4 w-4" />
        )}
      </div>
      
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h3 className="text-sm text-white/90 truncate font-normal">{entry.name || 'Untitled'}</h3>
          {entry.favorite && (
            <Icons.star className="h-3 w-3 text-amber-400/80 fill-amber-400/80 shrink-0" />
          )}
        </div>
        {subtitle && (
          <p className="text-xs text-white/35 truncate mt-0.5">{subtitle}</p>
        )}
      </div>
      
      <Icons.chevronRight className="h-4 w-4 text-white/20 group-hover:text-white/40 transition-colors shrink-0" />
    </motion.button>
  )
})
