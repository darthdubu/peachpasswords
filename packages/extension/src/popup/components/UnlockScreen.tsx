import React, { useState, useMemo } from 'react'
import { useVault } from '../contexts/VaultContext'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from './ui/card'
import { Icons } from './icons'

interface PasswordStrength {
  score: number
  label: string
  color: string
  requirements: string[]
}

function checkPasswordStrength(password: string): PasswordStrength {
  const requirements = []
  let score = 0

  if (password.length >= 12) {
    score += 1
  } else {
    requirements.push('At least 12 characters')
  }

  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) {
    score += 1
  } else {
    requirements.push('Upper and lowercase letters')
  }

  if (/\d/.test(password)) {
    score += 1
  } else {
    requirements.push('At least one number')
  }

  if (/[^a-zA-Z0-9]/.test(password)) {
    score += 1
  } else {
    requirements.push('At least one symbol')
  }

  const labels = ['Very Weak', 'Weak', 'Fair', 'Good', 'Strong']
  const colors = ['bg-red-500', 'bg-red-400', 'bg-yellow-400', 'bg-green-400', 'bg-green-500']

  return {
    score,
    label: labels[score],
    color: colors[score],
    requirements
  }
}

export function UnlockScreen() {
  const { unlockVault, createVault, vaultExists, error } = useVault()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [localError, setLocalError] = useState('')

  const strength = useMemo(() => checkPasswordStrength(password), [password])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!password) return

    setLocalError('')

    if (!vaultExists) {
      if (password !== confirmPassword) {
        setLocalError('Passwords do not match')
        return
      }
      if (strength.score < 3) {
        setLocalError('Password is too weak. Please use at least 12 characters with mixed case, numbers, and symbols.')
        return
      }
    }

    setIsSubmitting(true)

    try {
      if (vaultExists) {
        await unlockVault(password)
      } else {
        await createVault(password)
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="w-[340px] h-[520px] flex items-center justify-center p-5 bg-background">
      <Card className="w-full border-none shadow-none bg-transparent">
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
              <>
                <div className="space-y-2">
                  <Input
                    type="password"
                    placeholder="Confirm Password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    disabled={isSubmitting}
                  />
                </div>
                {password && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Password Strength:</span>
                      <span className={strength.score >= 3 ? 'text-green-500' : strength.score >= 2 ? 'text-yellow-500' : 'text-red-500'}>
                        {strength.label}
                      </span>
                    </div>
                    <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                      <div
                        className={`h-full ${strength.color} transition-all duration-300`}
                        style={{ width: `${((strength.score + 1) / 5) * 100}%` }}
                      />
                    </div>
                    {strength.requirements.length > 0 && (
                      <ul className="text-xs text-muted-foreground space-y-0.5">
                        {strength.requirements.map((req, i) => (
                          <li key={i}>• {req}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </>
            )}
            {(error || localError) && (
              <p className="text-sm text-destructive text-center">{error || localError}</p>
            )}
          </CardContent>
          <CardFooter>
            <Button
              type="submit"
              className="w-full"
              disabled={isSubmitting || !password || (!vaultExists && (password !== confirmPassword || strength.score < 2))}
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