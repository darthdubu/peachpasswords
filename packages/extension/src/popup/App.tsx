import { useState, useEffect } from 'react'
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
        <Icons.refresh className="h-8 w-8 animate-spin text-primary" />
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

  // Header for non-list views
  const Header = ({ title, onBack }: { title: string, onBack: () => void }) => (
    <div className="flex items-center p-4 border-b bg-background">
      <Button variant="ghost" size="icon" onClick={onBack} className="mr-2">
        <Icons.chevronRight className="h-4 w-4 rotate-180" />
      </Button>
      <h2 className="font-semibold text-lg flex-1">{title}</h2>
    </div>
  )

  return (
    <div className="w-[380px] h-[560px] bg-background text-foreground overflow-hidden flex flex-col">
      {view === 'list' && (
        <>
          <div className="flex items-center justify-between p-4 border-b">
            <h1 className="text-xl font-bold text-primary">Lotus</h1>
            <div className="flex gap-2">
              {(syncStatus === 'error' || s3SyncStatus === 'error') && (
                 <div className="flex items-center justify-center w-9 h-9" title={syncStatus === 'error' ? 'Local Sync Error' : 'S3 Sync Error'}>
                    <Icons.cloud className="h-4 w-4 text-destructive" />
                 </div>
              )}
              <Button variant="ghost" size="icon" onClick={() => setView('settings')}>
                <Icons.settings className="h-5 w-5" />
              </Button>
              <Button variant="ghost" size="icon" onClick={lockVault}>
                <Icons.lock className="h-5 w-5" />
              </Button>
            </div>
          </div>
          <VaultList onSelectEntry={handleSelectEntry} onAddEntry={handleAddEntry} />
        </>
      )}

      {view === 'detail' && selectedEntry && (
        <div className="flex flex-col h-full">
          <Header title="Entry Details" onBack={() => setView('list')} />
          <EntryDetail 
            entry={selectedEntry} 
            onEdit={handleEditEntry} 
            onDelete={handleDeleteEntry} 
          />
        </div>
      )}

      {view === 'edit' && (
        <div className="flex flex-col h-full">
          <Header title={pendingSave ? 'Save Login' : (selectedEntry ? 'Edit Entry' : 'New Entry')} onBack={handleCancelEntry} />
          <EntryForm 
            initialEntry={selectedEntry} 
            initialPassword={pendingSave && selectedEntry?.login?.urls[0] === pendingSave.url ? pendingSave.password : undefined}
            onSave={handleSaveEntry} 
            onCancel={handleCancelEntry} 
          />
        </div>
      )}

      {view === 'settings' && (
        <div className="flex flex-col h-full">
          <Header title="Settings" onBack={() => setView('list')} />
          <Settings />
        </div>
      )}
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
