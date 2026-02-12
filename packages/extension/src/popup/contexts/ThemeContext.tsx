import React, { createContext, useContext, useEffect, useState } from 'react'

export type Theme = 'dark' | 'light'
export type ColorScheme =
  | 'peach'
  | 'green'
  | 'blue'
  | 'apple'
  | 'banana'
  | 'cherry'
  | 'grape'
  | 'lemon'
  | 'lime'
  | 'mango'
  | 'plum'
  | 'berry'
  | 'coconut'

const COLOR_SCHEMES: ColorScheme[] = [
  'peach',
  'green',
  'blue',
  'apple',
  'banana',
  'cherry',
  'grape',
  'lemon',
  'lime',
  'mango',
  'plum',
  'berry',
  'coconut'
]

const ACCENT_TOKENS: Record<ColorScheme, { primary: string; primaryForeground: string; accent: string; accentForeground: string; ring: string }> = {
  peach: { primary: '15 90% 65%', primaryForeground: '0 0% 100%', accent: '15 90% 65%', accentForeground: '0 0% 100%', ring: '15 90% 65%' },
  green: { primary: '142 71% 45%', primaryForeground: '144 80% 10%', accent: '142 71% 45%', accentForeground: '0 0% 95%', ring: '142 71% 45%' },
  blue: { primary: '217 91% 60%', primaryForeground: '0 0% 100%', accent: '217 91% 60%', accentForeground: '0 0% 100%', ring: '217 91% 60%' },
  apple: { primary: '2 77% 56%', primaryForeground: '0 0% 100%', accent: '2 77% 56%', accentForeground: '0 0% 100%', ring: '2 77% 56%' },
  banana: { primary: '48 96% 56%', primaryForeground: '48 70% 14%', accent: '48 96% 56%', accentForeground: '48 70% 14%', ring: '48 96% 56%' },
  cherry: { primary: '350 78% 54%', primaryForeground: '0 0% 100%', accent: '350 78% 54%', accentForeground: '0 0% 100%', ring: '350 78% 54%' },
  grape: { primary: '268 83% 65%', primaryForeground: '0 0% 100%', accent: '268 83% 65%', accentForeground: '0 0% 100%', ring: '268 83% 65%' },
  lemon: { primary: '55 96% 62%', primaryForeground: '55 75% 15%', accent: '55 96% 62%', accentForeground: '55 75% 15%', ring: '55 96% 62%' },
  lime: { primary: '96 61% 50%', primaryForeground: '96 75% 14%', accent: '96 61% 50%', accentForeground: '96 75% 14%', ring: '96 61% 50%' },
  mango: { primary: '32 95% 56%', primaryForeground: '32 75% 15%', accent: '32 95% 56%', accentForeground: '32 75% 15%', ring: '32 95% 56%' },
  plum: { primary: '295 44% 52%', primaryForeground: '0 0% 100%', accent: '295 44% 52%', accentForeground: '0 0% 100%', ring: '295 44% 52%' },
  berry: { primary: '330 72% 58%', primaryForeground: '0 0% 100%', accent: '330 72% 58%', accentForeground: '0 0% 100%', ring: '330 72% 58%' },
  coconut: { primary: '30 24% 58%', primaryForeground: '30 40% 13%', accent: '30 24% 58%', accentForeground: '30 40% 13%', ring: '30 24% 58%' }
}

interface ThemeContextType {
  theme: Theme
  setTheme: (theme: Theme) => void
  colorScheme: ColorScheme
  setColorScheme: (scheme: ColorScheme) => void
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined)

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>('dark')
  const [colorScheme, setColorScheme] = useState<ColorScheme>('peach')

  useEffect(() => {
    // Load from storage
    chrome.storage.sync.get(['theme', 'colorScheme']).then(result => {
      if (result.theme === 'dark' || result.theme === 'light') {
        setTheme(result.theme)
      }
      if (typeof result.colorScheme === 'string' && COLOR_SCHEMES.includes(result.colorScheme as ColorScheme)) {
        setColorScheme(result.colorScheme as ColorScheme)
      }
    })
  }, [])

  useEffect(() => {
    const root = window.document.documentElement
    
    // Theme
    root.classList.remove('light', 'dark')
    root.classList.add(theme)
    
    // Color Scheme
    root.classList.remove(...COLOR_SCHEMES.map((scheme) => `theme-${scheme}`))
    root.classList.add(`theme-${colorScheme}`)
    const accent = ACCENT_TOKENS[colorScheme]
    root.style.setProperty('--primary', accent.primary)
    root.style.setProperty('--primary-foreground', accent.primaryForeground)
    root.style.setProperty('--accent', accent.accent)
    root.style.setProperty('--accent-foreground', accent.accentForeground)
    root.style.setProperty('--ring', accent.ring)
    
    // Save
    chrome.storage.sync.set({ theme, colorScheme })
  }, [theme, colorScheme])

  return (
    <ThemeContext.Provider value={{ theme, setTheme, colorScheme, setColorScheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return context
}
