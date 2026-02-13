import type { FC } from 'react'
import { VaultProvider } from './contexts/VaultContext'
import { ThemeProvider } from './contexts/ThemeContext'
import { AppContent } from './components/AppContent'

const App: FC = () => {
  return (
    <ThemeProvider>
      <VaultProvider>
        <AppContent />
      </VaultProvider>
    </ThemeProvider>
  )
}

export default App
