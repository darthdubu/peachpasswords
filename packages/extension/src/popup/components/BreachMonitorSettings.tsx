import { useState, useEffect } from 'react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Switch } from './ui/switch'
import { Icons } from './icons'
import { breachMonitor, type PasswordHealth } from '../../lib/breach-monitor'
import { STORAGE_KEYS } from '../../lib/constants'

interface BreachMonitorSettingsProps {
  masterKey: CryptoKey | null
}

export function BreachMonitorSettings({ masterKey }: BreachMonitorSettingsProps) {
  const [apiKey, setApiKey] = useState('')
  const [isEnabled, setIsEnabled] = useState(false)
  const [isChecking, setIsChecking] = useState(false)
  const [passwordHealth, setPasswordHealth] = useState<PasswordHealth | null>(null)
  const [showApiKey, setShowApiKey] = useState(false)

  useEffect(() => {
    loadSettings()
  }, [])

  const loadSettings = async () => {
    try {
      const result = await chrome.storage.local.get([STORAGE_KEYS.SETTINGS])
      const settings = result[STORAGE_KEYS.SETTINGS] || {}
      if (settings.breachMonitorApiKey) {
        setApiKey(settings.breachMonitorApiKey)
        breachMonitor.setApiKey(settings.breachMonitorApiKey)
      }
      setIsEnabled(settings.breachMonitorEnabled || false)
    } catch {
      // Ignore
    }
  }

  const saveSettings = async () => {
    try {
      const result = await chrome.storage.local.get([STORAGE_KEYS.SETTINGS])
      const settings = result[STORAGE_KEYS.SETTINGS] || {}
      settings.breachMonitorApiKey = apiKey
      settings.breachMonitorEnabled = isEnabled
      await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: settings })
      breachMonitor.setApiKey(apiKey)
    } catch {
      // Ignore
    }
  }

  const handleCheckPasswords = async () => {
    if (!masterKey) return
    setIsChecking(true)
    try {
      const result = await chrome.storage.local.get(['vault'])
      const vault = result.vault
      if (!vault?.entries) return

      const passwords = vault.entries
        .filter((e: { type: string }) => e.type === 'login')
        .map((e: { entryId: string; login?: { password?: string } }) => ({
          entryId: e.entryId,
          password: e.login?.password || ''
        }))
        .filter((p: { password: string }) => p.password)

      const health = breachMonitor.analyzePasswordHealth(passwords)
      setPasswordHealth(health)
    } finally {
      setIsChecking(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-medium text-white/90">Enable Breach Monitoring</p>
          <p className="text-[10px] text-white/50">Check passwords against Have I Been Pwned</p>
        </div>
        <Switch
          checked={isEnabled}
          onCheckedChange={(checked) => {
            setIsEnabled(checked)
            saveSettings()
          }}
        />
      </div>

      {isEnabled && (
        <>
          <div className="space-y-2">
            <label className="text-xs text-white/70">HIBP API Key</label>
            <div className="flex gap-2">
              <Input
                type={showApiKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Enter your HIBP API key"
                className="text-xs bg-white/[0.05]"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowApiKey(!showApiKey)}
              >
                {showApiKey ? <Icons.eyeOff className="h-4 w-4" /> : <Icons.eye className="h-4 w-4" />}
              </Button>
            </div>
            <p className="text-[10px] text-white/40">
              Get your API key from{' '}
              <a
                href="https://haveibeenpwned.com/API/Key"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                haveibeenpwned.com
              </a>
            </p>
          </div>

          <Button
            onClick={handleCheckPasswords}
            disabled={isChecking || !masterKey}
            size="sm"
            variant="outline"
            className="w-full"
          >
            {isChecking ? (
              <>
                <Icons.refresh className="mr-2 h-4 w-4 animate-spin" />
                Checking...
              </>
            ) : (
              <>
                <Icons.shield className="mr-2 h-4 w-4" />
                Check Password Health
              </>
            )}
          </Button>

          {passwordHealth && (
            <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-white/70">Security Score</span>
                <span
                  className={`text-sm font-bold ${
                    passwordHealth.overallScore >= 80
                      ? 'text-emerald-400'
                      : passwordHealth.overallScore >= 50
                      ? 'text-amber-400'
                      : 'text-red-400'
                  }`}
                >
                  {passwordHealth.overallScore}/100
                </span>
              </div>

              <div className="h-2 rounded-full bg-white/[0.08] overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    passwordHealth.overallScore >= 80
                      ? 'bg-emerald-400'
                      : passwordHealth.overallScore >= 50
                      ? 'bg-amber-400'
                      : 'bg-red-400'
                  }`}
                  style={{ width: `${passwordHealth.overallScore}%` }}
                />
              </div>

              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded bg-white/[0.03] p-2">
                  <p className="text-lg font-bold text-red-400">{passwordHealth.weakPasswords}</p>
                  <p className="text-[10px] text-white/50">Weak</p>
                </div>
                <div className="rounded bg-white/[0.03] p-2">
                  <p className="text-lg font-bold text-amber-400">{passwordHealth.reusedPasswords}</p>
                  <p className="text-[10px] text-white/50">Reused</p>
                </div>
                <div className="rounded bg-white/[0.03] p-2">
                  <p className="text-lg font-bold text-red-400">{passwordHealth.breachedPasswords}</p>
                  <p className="text-[10px] text-white/50">Breached</p>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
