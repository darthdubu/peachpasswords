import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { VaultProvider, useVault } from './contexts/VaultContext'
import { ThemeProvider } from './contexts/ThemeContext'
import { UnlockScreen } from './components/UnlockScreen'
import { VaultList } from './components/VaultList'
import { EntryDetail } from './components/EntryDetail'
import { EntryForm } from './components/EntryForm'
import { Settings } from './components/Settings'
import { VaultEntry } from '@lotus/shared'
import { Icons } from './components/icons'
import { Button } from './components/ui/button'

function Main() {
  const { isUnlocked, isLoading, lockVault, deleteEntry, pendingSave, clearPendingSave, syncStatus, s3SyncStatus } = useVault()
  const [view, setView] = useState<'list' | 'detail' | 'edit' | 'settings'>('list')
  const [selectedEntry, setSelectedEntry] = useState<VaultEntry | null>(null)

  // Handle pending save from background script
  useEffect(() => {
    if (pendingSave && isUnlocked) {
      const entry: VaultEntry = {
        id: '',
        type: 'login',
        name: new URL(pendingSave.url).hostname,
        created: Date.now(),
        modified: Date.now(),
        tags: [],
        favorite: false,
        login: {
          username: pendingSave.username,
          password: '', // Passed via initialPassword
          urls: [pendingSave.url]
        }
      }
      setSelectedEntry(entry)
      setView('edit')
    }
  }, [pendingSave, isUnlocked])

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
        >
          <Icons.refresh className="h-8 w-8 text-primary" />
        </motion.div>
      </div>
    )
  }

  if (!isUnlocked) {
    return <UnlockScreen />
  }

  const handleSelectEntry = (entry: VaultEntry) => {
    setSelectedEntry(entry)
    setView('detail')
  }

  const handleAddEntry = () => {
    setSelectedEntry(null)
    setView('edit')
  }

  const handleEditEntry = () => {
    setView('edit')
  }

  const handleDeleteEntry = async () => {
    if (selectedEntry) {
      if (confirm('Are you sure you want to delete this entry?')) {
        await deleteEntry(selectedEntry.id)
        setView('list')
        setSelectedEntry(null)
      }
    }
  }

  const handleSaveEntry = () => {
    if (pendingSave) clearPendingSave()
    setView('list')
    setSelectedEntry(null)
  }

  const handleCancelEntry = () => {
    if (pendingSave) clearPendingSave()
    setView('list')
  }

  const Header = ({ title, onBack }: { title: string, onBack: () => void }) => (
    <div className="flex items-center p-4 glass border-b border-border/50">
      <Button 
        variant="ghost" 
        size="icon" 
        onClick={onBack} 
        className="mr-2 hover:bg-secondary/80 transition-colors"
      >
        <Icons.chevronRight className="h-4 w-4 rotate-180" />
      </Button>
      <h2 className="font-semibold text-lg flex-1">{title}</h2>
    </div>
  )

  return (
    <div className="w-[340px] h-[520px] bg-background text-foreground overflow-hidden flex flex-col lotus-popup">
      <AnimatePresence mode="wait">
        {view === 'list' && (
          <motion.div 
            key="list"
            className="flex flex-col h-full"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.2 }}
          >
            <div className="flex items-center justify-between p-4 glass border-b border-border/50">
<div className="flex items-center gap-2">
              <img 
                src="/icons/icon-32.png" 
                alt="Peach" 
                className="w-8 h-8 drop-shadow-lg"
              />
              <h1 className="text-xl font-bold bg-gradient-to-r from-primary to-primary/70 bg-clip-text text-transparent">Peach</h1>
            </div>
              <div className="flex gap-1">
                {(syncStatus === 'error' || s3SyncStatus === 'error') && (
                   <div className="flex items-center justify-center w-9 h-9" title={syncStatus === 'error' ? 'Local Sync Error' : 'S3 Sync Error'}>
                      <Icons.cloud className="h-4 w-4 text-destructive" />
                   </div>
                )}
                <Button variant="ghost" size="icon" onClick={() => setView('settings')} className="hover:bg-secondary/80">
                  <Icons.settings className="h-5 w-5" />
                </Button>
                <Button variant="ghost" size="icon" onClick={lockVault} className="hover:bg-secondary/80">
                  <Icons.lock className="h-5 w-5" />
                </Button>
              </div>
            </div>
            <VaultList onSelectEntry={handleSelectEntry} onAddEntry={handleAddEntry} />
          </motion.div>
        )}

        {view === 'detail' && selectedEntry && (
          <motion.div 
            key="detail"
            className="flex flex-col h-full"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            transition={{ duration: 0.2 }}
          >
            <Header title="Entry Details" onBack={() => setView('list')} />
            <EntryDetail 
              entry={selectedEntry} 
              onEdit={handleEditEntry} 
              onDelete={handleDeleteEntry} 
            />
          </motion.div>
        )}

        {view === 'edit' && (
          <motion.div 
            key="edit"
            className="flex flex-col h-full"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            transition={{ duration: 0.2 }}
          >
            <Header title={pendingSave ? 'Save Login' : (selectedEntry ? 'Edit Entry' : 'New Entry')} onBack={handleCancelEntry} />
            <EntryForm 
              initialEntry={selectedEntry} 
              initialPassword={pendingSave && selectedEntry?.login?.urls[0] === pendingSave.url ? pendingSave.password : undefined}
              onSave={handleSaveEntry} 
              onCancel={handleCancelEntry} 
            />
          </motion.div>
        )}

        {view === 'settings' && (
          <motion.div 
            key="settings"
            className="flex flex-col h-full"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            transition={{ duration: 0.2 }}
          >
            <Header title="Settings" onBack={() => setView('list')} />
            <Settings />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function App() {
  return (
    <ThemeProvider>
      <VaultProvider>
        <Main />
      </VaultProvider>
    </ThemeProvider>
  )
}

export default App
