import React, { useState, useEffect } from 'react'
import { UnlockScreen } from './components/UnlockScreen'
import { VaultList } from './components/VaultList'
import { EntryDetail } from './components/EntryDetail'
import { EntryForm } from './components/EntryForm'
import { Settings } from './components/Settings'
import { useVault } from '../contexts/VaultContext'
import { Toaster } from 'sonner'

type View = 'unlock' | 'list' | 'detail' | 'form' | 'settings'

export function AppContent() {
  const [currentView, setCurrentView] = useState<View>('unlock')
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null)
  const { isUnlocked, vaultExists } = useVault()

  useEffect(() => {
    if (isUnlocked) {
      setCurrentView('list')
    } else {
      setCurrentView('unlock')
    }
  }, [isUnlocked])

  const handleUnlock = () => {
    setCurrentView('list')
  }

  const handleSelectEntry = (entryId: string) => {
    setSelectedEntryId(entryId)
    setCurrentView('detail')
  }

  const handleBackToList = () => {
    setCurrentView('list')
    setSelectedEntryId(null)
  }

  const handleAddEntry = () => {
    setSelectedEntryId(null)
    setCurrentView('form')
  }

  const handleEditEntry = (entryId: string) => {
    setSelectedEntryId(entryId)
    setCurrentView('form')
  }

  const handleOpenSettings = () => {
    setCurrentView('settings')
  }

  const handleSaveComplete = () => {
    setCurrentView('list')
    setSelectedEntryId(null)
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Toaster 
        position="top-center"
        toastOptions={{
          style: {
            background: '#1a1a1a',
            color: '#fff',
            border: '1px solid #333'
          }
        }}
      />
      
      {currentView === 'unlock' && (
        <UnlockScreen 
          onUnlock={handleUnlock}
          vaultExists={vaultExists}
        />
      )}
      
      {currentView === 'list' && (
        <VaultList
          onSelectEntry={handleSelectEntry}
          onAddEntry={handleAddEntry}
          onOpenSettings={handleOpenSettings}
        />
      )}
      
      {currentView === 'detail' && selectedEntryId && (
        <EntryDetail
          entryId={selectedEntryId}
          onBack={handleBackToList}
          onEdit={() => handleEditEntry(selectedEntryId)}
        />
      )}
      
      {currentView === 'form' && (
        <EntryForm
          entryId={selectedEntryId}
          onCancel={handleBackToList}
          onSave={handleSaveComplete}
        />
      )}
      
      {currentView === 'settings' && (
        <Settings
          onBack={handleBackToList}
        />
      )}
    </div>
  )
}
