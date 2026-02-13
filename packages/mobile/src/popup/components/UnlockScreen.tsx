import React, { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Lock, Fingerprint, KeyRound, Eye, EyeOff } from 'lucide-react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { useVault } from '../contexts/VaultContext'
import { toast } from 'sonner'

interface UnlockScreenProps {
  onUnlock: () => void
  vaultExists: boolean
}

export function UnlockScreen({ onUnlock, vaultExists }: UnlockScreenProps) {
  const [password, setPassword] = useState('')
  const [pin, setPin] = useState('')
  const [showPin, setShowPin] = useState(false)
  const [activeMethod, setActiveMethod] = useState<'password' | 'pin' | 'biometric'>('password')
  const [isLoading, setIsLoading] = useState(false)
  const { unlockVault, unlockWithBiometric, unlockWithPin, createVault, hasBiometric, hasPin } = useVault()

  const [biometricAvailable, setBiometricAvailable] = useState(false)
  const [pinAvailable, setPinAvailable] = useState(false)

  useEffect(() => {
    hasBiometric().then(setBiometricAvailable)
    hasPin().then(setPinAvailable)
  }, [hasBiometric, hasPin])

  const handlePasswordUnlock = async () => {
    if (!password) return
    setIsLoading(true)
    try {
      const success = await unlockVault(password)
      if (success) {
        toast.success('Vault unlocked')
        onUnlock()
      } else {
        toast.error('Incorrect password')
      }
    } catch (error) {
      toast.error('Unlock failed')
    } finally {
      setIsLoading(false)
    }
  }

  const handleBiometricUnlock = async () => {
    setIsLoading(true)
    try {
      const success = await unlockWithBiometric()
      if (success) {
        toast.success('Vault unlocked')
        onUnlock()
      } else {
        toast.error('Biometric authentication failed')
      }
    } catch (error) {
      toast.error('Biometric unlock failed')
    } finally {
      setIsLoading(false)
    }
  }

  const handlePinUnlock = async () => {
    if (!pin) return
    setIsLoading(true)
    try {
      const success = await unlockWithPin(pin)
      if (success) {
        toast.success('Vault unlocked')
        onUnlock()
      } else {
        toast.error('Incorrect PIN')
      }
    } catch (error) {
      toast.error('PIN unlock failed')
    } finally {
      setIsLoading(false)
    }
  }

  const handleCreateVault = async () => {
    if (!password) {
      toast.error('Please enter a password')
      return
    }
    if (password.length < 8) {
      toast.error('Password must be at least 8 characters')
      return
    }
    setIsLoading(true)
    try {
      await createVault(password)
      toast.success('Vault created successfully')
      onUnlock()
    } catch (error) {
      toast.error('Failed to create vault')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-6 bg-gradient-to-b from-background to-background/95">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-sm space-y-8"
      >
        <div className="text-center space-y-2">
          <div className="w-20 h-20 mx-auto bg-gradient-to-br from-[#FFB07C] to-[#FF8C69] rounded-2xl flex items-center justify-center shadow-lg shadow-[#FFB07C]/20">
            <Lock className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-[#FFB07C] to-[#FF8C69] bg-clip-text text-transparent">
            {vaultExists ? 'Unlock Vault' : 'Create Vault'}
          </h1>
          <p className="text-muted-foreground">
            {vaultExists ? 'Enter your password to unlock' : 'Create a master password for your vault'}
          </p>
        </div>

        <AnimatePresence mode="wait">
          {activeMethod === 'password' && (
            <motion.div
              key="password"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="space-y-4"
            >
              <div className="space-y-2">
                <Input
                  type="password"
                  placeholder="Master password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && (vaultExists ? handlePasswordUnlock() : handleCreateVault())}
                  className="h-14 text-lg"
                  autoFocus
                />
              </div>
              
              <Button
                onClick={vaultExists ? handlePasswordUnlock : handleCreateVault}
                disabled={isLoading}
                className="w-full h-14 text-lg bg-gradient-to-r from-[#FFB07C] to-[#FF8C69] hover:from-[#FF9B69] hover:to-[#FF7B54]"
              >
                {isLoading ? 'Processing...' : vaultExists ? 'Unlock' : 'Create Vault'}
              </Button>
            </motion.div>
          )}

          {activeMethod === 'pin' && (
            <motion.div
              key="pin"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="space-y-4"
            >
              <div className="space-y-2 relative">
                <Input
                  type={showPin ? 'text' : 'password'}
                  placeholder="Enter PIN"
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handlePinUnlock()}
                  className="h-14 text-lg"
                  maxLength={6}
                />
                <button
                  onClick={() => setShowPin(!showPin)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground"
                >
                  {showPin ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
              
              <Button
                onClick={handlePinUnlock}
                disabled={isLoading || pin.length < 4}
                className="w-full h-14 text-lg bg-gradient-to-r from-[#FFB07C] to-[#FF8C69] hover:from-[#FF9B69] hover:to-[#FF7B54]"
              >
                {isLoading ? 'Processing...' : 'Unlock with PIN'}
              </Button>
            </motion.div>
          )}
        </AnimatePresence>

        {vaultExists && (
          <div className="flex justify-center gap-4">
            <button
              onClick={() => setActiveMethod('password')}
              className={`flex flex-col items-center gap-2 p-3 rounded-xl transition-all ${
                activeMethod === 'password' ? 'bg-primary/10 text-primary' : 'text-muted-foreground'
              }`}
            >
              <KeyRound className="w-6 h-6" />
              <span className="text-xs">Password</span>
            </button>
            
            {pinAvailable && (
              <button
                onClick={() => setActiveMethod('pin')}
                className={`flex flex-col items-center gap-2 p-3 rounded-xl transition-all ${
                  activeMethod === 'pin' ? 'bg-primary/10 text-primary' : 'text-muted-foreground'
                }`}
              >
                <Lock className="w-6 h-6" />
                <span className="text-xs">PIN</span>
              </button>
            )}
            
            {biometricAvailable && (
              <button
                onClick={handleBiometricUnlock}
                disabled={isLoading}
                className="flex flex-col items-center gap-2 p-3 rounded-xl text-muted-foreground hover:text-foreground transition-all"
              >
                <Fingerprint className="w-6 h-6" />
                <span className="text-xs">Biometric</span>
              </button>
            )}
          </div>
        )}
      </motion.div>
    </div>
  )
}
