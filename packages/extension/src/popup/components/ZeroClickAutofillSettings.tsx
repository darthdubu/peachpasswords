import { useState, useEffect } from 'react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Switch } from './ui/switch'
import { Icons } from './icons'
import { zeroClickAutofill, type TrustedSite } from '../../lib/zero-click-autofill'

interface ZeroClickSettingsProps {
  masterKey: CryptoKey | null
}

export function ZeroClickAutofillSettings({ masterKey }: ZeroClickSettingsProps) {
  const [isEnabled, setIsEnabled] = useState(false)
  const [requireBiometric, setRequireBiometric] = useState(true)
  const [trustedSites, setTrustedSites] = useState<TrustedSite[]>([])
  const [newSiteDomain, setNewSiteDomain] = useState('')
  const [maxSites, setMaxSites] = useState(10)

  useEffect(() => {
    loadSettings()
  }, [masterKey])

  const loadSettings = async () => {
    if (!masterKey) return
    await zeroClickAutofill.loadSettings()
    const settings = zeroClickAutofill.getSettings()
    setIsEnabled(settings.enabled)
    setRequireBiometric(settings.requireBiometric)
    setMaxSites(settings.maxSites)
    setTrustedSites(settings.trustedSites)
  }

  const handleToggleEnabled = async (checked: boolean) => {
    setIsEnabled(checked)
    if (checked) {
      await zeroClickAutofill.enable()
    } else {
      await zeroClickAutofill.disable()
    }
  }

  const handleToggleBiometric = async (checked: boolean) => {
    setRequireBiometric(checked)
    await zeroClickAutofill.updateSettings({ requireBiometric: checked })
  }

  const handleAddSite = async () => {
    if (!newSiteDomain.trim()) return

    try {
      await zeroClickAutofill.addTrustedSite(newSiteDomain.trim(), '')
      setNewSiteDomain('')
      const sites = zeroClickAutofill.getAllTrustedSites()
      setTrustedSites(sites)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to add site')
    }
  }

  const handleRemoveSite = async (domain: string) => {
    await zeroClickAutofill.removeTrustedSite(domain)
    const sites = zeroClickAutofill.getAllTrustedSites()
    setTrustedSites(sites)
  }

  const handleToggleSite = async (domain: string) => {
    await zeroClickAutofill.toggleTrustedSite(domain)
    const sites = zeroClickAutofill.getAllTrustedSites()
    setTrustedSites(sites)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-medium text-white/90">Enable Zero-Click Autofill</p>
          <p className="text-[10px] text-white/50">Auto-fill on trusted sites without confirmation</p>
        </div>
        <Switch
          checked={isEnabled}
          onCheckedChange={handleToggleEnabled}
          disabled={!masterKey}
        />
      </div>

      {isEnabled && (
        <>
          <div className="flex items-center justify-between rounded-lg border border-white/[0.08] bg-white/[0.02] p-3">
            <div>
              <p className="text-xs font-medium text-white/80">Require Biometric</p>
              <p className="text-[10px] text-white/50">Touch ID/Face ID before auto-fill</p>
            </div>
            <Switch
              checked={requireBiometric}
              onCheckedChange={handleToggleBiometric}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs text-white/70">Trusted Sites ({trustedSites.length}/{maxSites})</p>
            </div>

            <div className="flex gap-2">
              <Input
                type="text"
                value={newSiteDomain}
                onChange={(e) => setNewSiteDomain(e.target.value)}
                placeholder="example.com"
                className="text-xs bg-white/[0.05]"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    void handleAddSite()
                  }
                }}
              />
              <Button
                onClick={() => void handleAddSite()}
                disabled={!newSiteDomain.trim() || trustedSites.length >= maxSites}
                size="sm"
              >
                <Icons.plus className="h-4 w-4" />
              </Button>
            </div>

            {trustedSites.length > 0 ? (
              <div className="space-y-1">
                {trustedSites.map((site) => (
                  <div
                    key={site.domain}
                    className="flex items-center justify-between rounded bg-white/[0.03] p-2"
                  >
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={site.enabled}
                        onCheckedChange={() => void handleToggleSite(site.domain)}
                        className="scale-75"
                      />
                      <span className={`text-xs ${site.enabled ? 'text-white/80' : 'text-white/40'}`}>
                        {site.domain}
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void handleRemoveSite(site.domain)}
                      className="h-6 w-6 p-0"
                    >
                      <Icons.trash className="h-3 w-3 text-white/40" />
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-white/40 text-center py-4">No trusted sites added yet</p>
            )}
          </div>
        </>
      )}
    </div>
  )
}
