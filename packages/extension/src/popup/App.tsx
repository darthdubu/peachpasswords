import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { VaultProvider, useVaultActions, useVaultState } from './contexts/VaultContext'
import { ThemeProvider } from './contexts/ThemeContext'
import { UnlockScreen } from './components/UnlockScreen'
import { VaultList } from './components/VaultList'
import { EntryDetail } from './components/EntryDetail'
import { EntryForm } from './components/EntryForm'
import { Settings } from './components/Settings'
import { VaultEntry } from '@lotus/shared'
import { Icons } from './components/icons'
import { normalizeStoredUrl, parseUrlCandidate } from '../lib/url-match'
import { cn } from '@/lib/utils'

type MainView = 'list' | 'detail' | 'edit' | 'settings'
type FilterType = 'all' | 'login' | 'card' | 'identity' | 'note' | 'favorite' | 'trash'

const POPUP_VIEW_STATE_KEY = 'peach_popup_view_state'
const MAIN_VIEWS: MainView[] = ['list', 'detail', 'edit', 'settings']
const SETTINGS_CATEGORY_STATE_KEY = 'peach_settings_category'

class PopupErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean; errorMessage: string | null }> {
  state = { hasError: false, errorMessage: null as string | null }
  static getDerivedStateFromError(error: unknown) {
    const msg = error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown error'
    return { hasError: true, errorMessage: msg }
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="w-[600px] h-[420px] bg-[#0a0a0f] flex flex-col items-center justify-center p-5 gap-3">
          <Icons.shield className="h-8 w-8 text-red-500" />
          <p className="text-white font-medium">Something went wrong</p>
          <p className="text-white/40 text-xs text-center max-w-[300px]">{this.state.errorMessage}</p>
        </div>
      )
    }
    return this.props.children
  }
}

interface NavItemProps {
  icon: React.ComponentType<{ className?: string }>
  label: string
  count?: number
  active: boolean
  onClick: () => void
}

function NavItem({ icon: Icon, label, count, active, onClick }: NavItemProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all duration-200",
        active 
          ? "bg-white/[0.08] text-white shadow-sm" 
          : "text-white/50 hover:text-white/80 hover:bg-white/[0.04]"
      )}
    >
      <Icon className={cn("h-4 w-4", active ? "text-primary" : "text-white/40")} />
      <span className="flex-1 text-left font-medium">{label}</span>
      {count !== undefined && count > 0 && (
        <span className={cn(
          "text-xs px-2 py-0.5 rounded-full",
          active ? "bg-primary/20 text-primary" : "bg-white/[0.06] text-white/50"
        )}>
          {count}
        </span>
      )}
    </button>
  )
}

function Sidebar({ 
  filter, 
  onFilterChange, 
  entryCounts, 
  syncStatus, 
  s3SyncStatus,
  onSettings,
  onLock 
}: { 
  filter: FilterType
  onFilterChange: (f: FilterType) => void
  entryCounts: Record<string, number>
  syncStatus: string
  s3SyncStatus: string
  onSettings: () => void
  onLock: () => void
}) {
  const anyError = syncStatus === 'error' || s3SyncStatus === 'error'
  const anyConnected = syncStatus === 'connected' || s3SyncStatus === 'connected'
  const syncColor = anyError ? 'text-red-400' : anyConnected ? 'text-emerald-400' : 'text-muted-foreground'
  
  return (
    <aside className="w-44 h-full bg-[#0d0d12] border-r border-white/[0.04] flex flex-col">
      <div className="p-4">
        <div className="flex items-center justify-between mb-6">
          <button
            onClick={onSettings}
            className="flex flex-col items-center hover:opacity-80 transition-opacity group"
          >
            <span className="text-lg font-light tracking-[0.2em] text-white/90 group-hover:text-white transition-colors">
              PEACH
            </span>
            <div className="w-8 h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent mt-1" />
          </button>
          <div className={cn("w-1.5 h-1.5 rounded-full", syncColor)} />
        </div>
        
        <div className="space-y-0.5">
          <NavItem 
            icon={Icons.layoutGrid} 
            label="All Items" 
            count={entryCounts.all}
            active={filter === 'all'}
            onClick={() => onFilterChange('all')}
          />
          <NavItem 
            icon={Icons.star} 
            label="Favorites" 
            count={entryCounts.favorite}
            active={filter === 'favorite'}
            onClick={() => onFilterChange('favorite')}
          />
          <NavItem 
            icon={Icons.key} 
            label="Passwords" 
            count={entryCounts.login}
            active={filter === 'login'}
            onClick={() => onFilterChange('login')}
          />
          <NavItem 
            icon={Icons.card} 
            label="Cards" 
            count={entryCounts.card}
            active={filter === 'card'}
            onClick={() => onFilterChange('card')}
          />
          <NavItem 
            icon={Icons.note} 
            label="Notes" 
            count={entryCounts.note}
            active={filter === 'note'}
            onClick={() => onFilterChange('note')}
          />
          {entryCounts.trash > 0 && (
            <NavItem 
              icon={Icons.trash} 
              label="Trash" 
              count={entryCounts.trash}
              active={filter === 'trash'}
              onClick={() => onFilterChange('trash')}
            />
          )}
        </div>
      </div>
      
      <div className="mt-auto p-4 border-t border-white/[0.04]">
        <div className="flex items-center gap-2">
          <button 
            onClick={onSettings}
            className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-white/50 hover:text-white hover:bg-white/[0.06] transition-all text-xs font-medium"
          >
            <Icons.settings className="h-3.5 w-3.5" />
            Settings
          </button>
          <button 
            onClick={onLock}
            className="p-2 rounded-lg text-white/50 hover:text-white hover:bg-white/[0.06] transition-all"
          >
            <Icons.lock className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </aside>
  )
}

function Main() {
  const { vault, isUnlocked, isLoading, pendingSave, syncStatus, s3SyncStatus, unresolvedConflictCount } = useVaultState()
  const { lockVault, deleteEntry, clearPendingSave } = useVaultActions()
  const [view, setView] = useState<MainView>('list')
  const [selectedEntry, setSelectedEntry] = useState<VaultEntry | null>(null)
  const [filter, setFilter] = useState<FilterType>('all')
  const [searchQuery, setSearchQuery] = useState('')

  const entryCounts = useMemo(() => {
    const entries = Array.isArray(vault?.entries) ? vault.entries : []
    const active = entries.filter(e => !e.trashedAt)
    const trashed = entries.filter(e => e.trashedAt)
    return {
      all: active.length,
      login: active.filter(e => e.type === 'login').length,
      card: active.filter(e => e.type === 'card').length,
      note: active.filter(e => e.type === 'note').length,
      favorite: active.filter(e => e.favorite).length,
      trash: trashed.length
    }
  }, [vault?.entries])

  useEffect(() => {
    if (!isUnlocked || !vault) return
    chrome.storage.session.get([POPUP_VIEW_STATE_KEY]).then((res) => {
      const state = res[POPUP_VIEW_STATE_KEY] as { view?: MainView; selectedEntryId?: string; filter?: FilterType } | undefined
      if (!state?.view || !MAIN_VIEWS.includes(state.view)) {
        setView('list')
        return
      }
      if (state.selectedEntryId) {
        const matched = vault.entries?.find((e) => e.id === state.selectedEntryId) || null
        setSelectedEntry(matched)
        if ((state.view === 'detail' || state.view === 'edit') && !matched) {
          setView('list')
          return
        }
      }
      if (state.filter) setFilter(state.filter)
      setView(state.view)
    })
  }, [isUnlocked, vault])

  useEffect(() => {
    if (!isUnlocked) return
    chrome.storage.session.set({ [POPUP_VIEW_STATE_KEY]: { view, selectedEntryId: selectedEntry?.id || null, filter } }).catch(() => {})
  }, [isUnlocked, view, selectedEntry?.id, filter])

  useEffect(() => {
    if (pendingSave && isUnlocked) {
      const normalizedUrl = normalizeStoredUrl(pendingSave.url)
      const displayHost = parseUrlCandidate(normalizedUrl)?.hostname || pendingSave.url
      setSelectedEntry({
        id: '', type: 'login', name: displayHost, created: Date.now(), modified: Date.now(), tags: [], favorite: false, encryptedMetadata: '',
        login: { username: pendingSave.username, password: '', urls: normalizedUrl ? [normalizedUrl] : [] }
      })
      setView('edit')
    }
  }, [pendingSave, isUnlocked])

  const handleSelectEntry = useCallback((entry: VaultEntry) => { setSelectedEntry(entry); setView('detail'); }, [])
  const handleAddEntry = useCallback((seed?: VaultEntry | null) => { setSelectedEntry(seed || null); setView('edit'); }, [])
  const handleSave = useCallback(() => { if (pendingSave) clearPendingSave(); setView('list'); setSelectedEntry(null); }, [pendingSave, clearPendingSave])
  const handleCancel = useCallback(() => { if (pendingSave) clearPendingSave(); setView('list'); }, [clearPendingSave, pendingSave])
  const handleDelete = useCallback(async () => {
    if (selectedEntry && confirm('Move to trash?')) {
      await deleteEntry(selectedEntry.id)
      setView('list')
      setSelectedEntry(null)
    }
  }, [deleteEntry, selectedEntry])

  const handleFilterChange = useCallback((f: FilterType) => {
    setFilter(f)
    setView('list')
  }, [])

  if (isLoading) {
    return (
      <div className="w-[600px] h-[420px] bg-[#0a0a0f] flex items-center justify-center">
        <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }}>
          <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full" />
        </motion.div>
      </div>
    )
  }

  if (!isUnlocked) return <UnlockScreen />

  return (
    <div className="w-[600px] h-[420px] bg-[#0a0a0f] flex overflow-hidden">
      <AnimatePresence mode="popLayout">
        {view !== 'settings' && (
          <motion.div
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 176, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <Sidebar
              filter={filter}
              onFilterChange={handleFilterChange}
              entryCounts={entryCounts}
              syncStatus={syncStatus}
              s3SyncStatus={s3SyncStatus}
              onSettings={() => setView('settings')}
              onLock={lockVault}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <main className="flex-1 relative overflow-hidden">
        <AnimatePresence mode="wait">
          {view === 'list' && (
            <motion.div 
              key="list" 
              className="h-full flex flex-col"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <div className="flex-1 overflow-hidden">
                <VaultList
                  filter={filter}
                  searchQuery={searchQuery}
                  onSearchChange={setSearchQuery}
                  onSelectEntry={handleSelectEntry}
                  syncStatus={syncStatus}
                  s3SyncStatus={s3SyncStatus}
                />
              </div>
            </motion.div>
          )}

          {view === 'detail' && selectedEntry && (
            <motion.div 
              key="detail" 
              className="h-full"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.2 }}
            >
              <EntryDetail entry={selectedEntry} onEdit={() => setView('edit')} onDelete={handleDelete} />
            </motion.div>
          )}

          {view === 'edit' && (
            <motion.div 
              key="edit" 
              className="h-full"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.2 }}
            >
              <EntryForm initialEntry={selectedEntry} onSave={handleSave} onCancel={handleCancel} />
            </motion.div>
          )}

          {view === 'settings' && (
            <motion.div 
              key="settings" 
              className="h-full"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.2 }}
            >
              <Settings onBack={() => setView('list')} />
            </motion.div>
          )}
        </AnimatePresence>

        {view === 'list' && (
          <motion.button
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => handleAddEntry()}
            className="absolute bottom-4 right-4 z-50 w-10 h-10 rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/25 flex items-center justify-center hover:bg-primary/90 transition-colors"
          >
            <Icons.plus className="h-5 w-5" />
          </motion.button>
        )}

        {unresolvedConflictCount > 0 && view === 'list' && (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="absolute bottom-4 left-4 right-16"
          >
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Icons.cloud className="h-3.5 w-3.5 text-amber-400" />
                <span className="text-xs text-amber-200">{unresolvedConflictCount} sync conflict{unresolvedConflictCount === 1 ? '' : 's'}</span>
              </div>
              <button 
                className="text-xs font-medium text-amber-300 hover:text-amber-100"
                onClick={() => { chrome.storage.session.set({ [SETTINGS_CATEGORY_STATE_KEY]: 'sync' }); setView('settings'); }}
              >
                Review
              </button>
            </div>
          </motion.div>
        )}
      </main>
    </div>
  )
}

function App() {
  return (
    <ThemeProvider>
      <VaultProvider>
        <PopupErrorBoundary>
          <Main />
        </PopupErrorBoundary>
      </VaultProvider>
    </ThemeProvider>
  )
}

export default App
