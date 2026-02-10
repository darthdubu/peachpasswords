import React, { useState } from 'react'
import { useVault } from '../contexts/VaultContext'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from './ui/card'
import { Icons } from './icons'

export function UnlockScreen() {
  const { unlockVault, createVault, vaultExists, error } = useVault()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!password) return

    setIsSubmitting(true)
    
    try {
      if (vaultExists) {
        await unlockVault(password)
      } else {
        if (password !== confirmPassword) {
          // TODO: Show error
          return
        }
        await createVault(password)
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="flex h-full items-center justify-center p-4 bg-background">
      <Card className="w-full max-w-sm border-none shadow-none bg-transparent">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <Icons.lock className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-2xl">
            {vaultExists ? 'Welcome Back' : 'Create Vault'}
          </CardTitle>
          <CardDescription>
            {vaultExists 
              ? 'Enter your master password to unlock' 
              : 'Set a strong master password to protect your data'}
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Input
                type="password"
                placeholder="Master Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isSubmitting}
                autoFocus
              />
            </div>
            {!vaultExists && (
              <div className="space-y-2">
                <Input
                  type="password"
                  placeholder="Confirm Password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={isSubmitting}
                />
              </div>
            )}
            {error && (
              <p className="text-sm text-destructive text-center">{error}</p>
            )}
          </CardContent>
          <CardFooter>
            <Button 
              type="submit" 
              className="w-full" 
              disabled={isSubmitting || !password || (!vaultExists && password !== confirmPassword)}
            >
              {isSubmitting ? (
                <Icons.refresh className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                vaultExists ? 'Unlock' : 'Create Vault'
              )}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  )
}