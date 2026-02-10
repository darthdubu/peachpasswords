import { useState } from 'react'
import { useVault } from '../contexts/VaultContext'
import { Input } from './ui/input'
import { Button } from './ui/button'
import { ScrollArea } from './ui/scroll-area'
import { Tabs, TabsList, TabsTrigger } from './ui/tabs'
import { Icons } from './icons'
import { VaultEntry } from '@lotus/shared'

export function VaultList({ onSelectEntry, onAddEntry }: { onSelectEntry: (entry: VaultEntry) => void, onAddEntry: () => void }) {
  const { searchEntries } = useVault()
  const [searchQuery, setSearchQuery] = useState('')
  const [activeTab, setActiveTab] = useState('all')

  const entries = searchEntries(searchQuery)
  
  const filteredEntries = activeTab === 'all' 
    ? entries 
    : entries.filter(e => e.type === activeTab)

  const getIconForType = (type: string) => {
    switch (type) {
      case 'login': return Icons.key
      case 'card': return Icons.card
      case 'identity': return Icons.user
      case 'note': return Icons.note
      default: return Icons.lock
    }
  }

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="p-4 space-y-4 border-b">
        <div className="flex items-center space-x-2">
          <div className="relative flex-1">
            <Icons.search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search vault..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8"
            />
          </div>
          <Button size="icon" onClick={onAddEntry}>
            <Icons.plus className="h-4 w-4" />
          </Button>
        </div>
        
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="w-full grid grid-cols-5">
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="login"><Icons.key className="h-4 w-4" /></TabsTrigger>
            <TabsTrigger value="card"><Icons.card className="h-4 w-4" /></TabsTrigger>
            <TabsTrigger value="identity"><Icons.user className="h-4 w-4" /></TabsTrigger>
            <TabsTrigger value="note"><Icons.note className="h-4 w-4" /></TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-2">
          {filteredEntries.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <p>No entries found</p>
            </div>
          ) : (
            filteredEntries.map(entry => {
              const Icon = getIconForType(entry.type)
              return (
                <div
                  key={entry.id}
                  className="flex items-center p-3 rounded-lg border bg-card hover:bg-accent cursor-pointer transition-colors"
                  onClick={() => onSelectEntry(entry)}
                >
                  <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center mr-4">
                    <Icon className="h-5 w-5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium truncate">{entry.name}</h3>
                    <p className="text-xs text-muted-foreground truncate">
                      {entry.login?.username || entry.card?.number || entry.identity?.email || 'Secure Note'}
                    </p>
                  </div>
                  <Icons.chevronRight className="h-4 w-4 text-muted-foreground" />
                </div>
              )
            })
          )}
        </div>
      </ScrollArea>
    </div>
  )
}