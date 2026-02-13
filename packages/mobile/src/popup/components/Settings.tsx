import { useState } from 'react'
import { ArrowLeft, Trash2, Download, Upload, Cloud, Shield, Moon, Smartphone } from 'lucide-react'
import { Button } from './ui/button'
import { Switch } from './ui/switch'
import { useVault } from '../contexts/VaultContext'
import { toast } from 'sonner'

interface SettingsProps {
  onBack: () => void
}

export function Settings({ onBack }: SettingsProps) {
  const { getTrashedEntries, restoreEntry, permanentlyDeleteEntry, lockVault } = useVault()
  const [activeTab, setActiveTab] = useState<'general' | 'security' | 'sync' | 'trash'>('general')
  const trashedEntries = getTrashedEntries()

  const handleRestore = (entryId: string) => {
    restoreEntry(entryId)
    toast.success('Entry restored')
  }

  const handlePermanentDelete = (entryId: string) => {
    if (confirm('Permanently delete this entry? This cannot be undone.')) {
      permanentlyDeleteEntry(entryId)
      toast.success('Entry permanently deleted')
    }
  }

  const handleExport = () => {
    toast.info('Export functionality coming soon')
  }

  const handleImport = () => {
    toast.info('Import functionality coming soon')
  }

  return (
    <div className="flex flex-col h-screen bg-background">
      <header className="flex items-center gap-4 p-4 border-b">
        <Button variant="ghost" size="icon" onClick={onBack}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <h1 className="font-semibold">Settings</h1>
      </header>

      <div className="flex border-b">
        {(['general', 'security', 'sync', 'trash'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 py-3 text-sm font-medium capitalize transition-colors ${
              activeTab === tab 
                ? 'text-[#FFB07C] border-b-2 border-[#FFB07C]' 
                : 'text-muted-foreground'
            }`}
          >
            {tab}
            {tab === 'trash' && trashedEntries.length > 0 && (
              <span className="ml-1 text-xs bg-destructive text-destructive-foreground px-1.5 py-0.5 rounded-full">
                {trashedEntries.length}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto p-4">
        {activeTab === 'general' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Moon className="w-5 h-5 text-muted-foreground" />
                <div>
                  <p className="font-medium">Dark Mode</p>
                  <p className="text-sm text-muted-foreground">Always use dark theme</p>
                </div>
              </div>
              <Switch checked={true} disabled />
            </div>

            <div className="pt-4 border-t space-y-3">
              <Button variant="outline" className="w-full justify-start" onClick={handleExport}>
                <Download className="w-4 h-4 mr-2" />
                Export Vault
              </Button>
              
              <Button variant="outline" className="w-full justify-start" onClick={handleImport}>
                <Upload className="w-4 h-4 mr-2" />
                Import Data
              </Button>
            </div>
          </div>
        )}

        {activeTab === 'security' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Shield className="w-5 h-5 text-muted-foreground" />
                <div>
                  <p className="font-medium">Biometric Unlock</p>
                  <p className="text-sm text-muted-foreground">Use fingerprint or face</p>
                </div>
              </div>
              <Switch />
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Smartphone className="w-5 h-5 text-muted-foreground" />
                <div>
                  <p className="font-medium">PIN Unlock</p>
                  <p className="text-sm text-muted-foreground">Use 4-6 digit PIN</p>
                </div>
              </div>
              <Switch />
            </div>

            <div className="pt-4 border-t">
              <Button variant="destructive" className="w-full" onClick={lockVault}>
                Lock Vault Now
              </Button>
            </div>
          </div>
        )}

        {activeTab === 'sync' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Cloud className="w-5 h-5 text-muted-foreground" />
                <div>
                  <p className="font-medium">S3 Sync</p>
                  <p className="text-sm text-muted-foreground">Sync to S3-compatible storage</p>
                </div>
              </div>
              <Switch />
            </div>

            <div className="p-4 bg-muted rounded-lg">
              <p className="text-sm text-muted-foreground">
                S3 sync configuration will be added in a future update.
              </p>
            </div>
          </div>
        )}

        {activeTab === 'trash' && (
          <div className="space-y-4">
            {trashedEntries.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Trash2 className="w-12 h-12 mx-auto mb-2 opacity-50" />
                <p>Trash is empty</p>
              </div>
            ) : (
              trashedEntries.map(entry => (
                <div key={entry.id} className="flex items-center justify-between p-3 bg-muted rounded-lg">
                  <div>
                    <p className="font-medium">{entry.name}</p>
                    <p className="text-sm text-muted-foreground">
                      Deleted {new Date((entry as any).trashedAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => handleRestore(entry.id)}>
                      Restore
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => handlePermanentDelete(entry.id)}>
                      Delete
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  )
}
