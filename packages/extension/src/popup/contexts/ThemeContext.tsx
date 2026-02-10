import React, { createContext, useContext, useEffect, useState } from 'react'

export type Theme = 'dark' | 'light'
export type ColorScheme = 'peach' | 'green' | 'blue'

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
      if (result.theme) setTheme(result.theme)
      if (result.colorScheme) setColorScheme(result.colorScheme)
    })
  }, [])

  useEffect(() => {
    const root = window.document.documentElement
    
    // Theme
    root.classList.remove('light', 'dark')
    root.classList.add(theme)
    
    // Color Scheme
    root.classList.remove('theme-peach', 'theme-green', 'theme-blue')
    root.classList.add(`theme-${colorScheme}`)
    
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
