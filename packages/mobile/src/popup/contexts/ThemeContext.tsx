import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { StatusBar } from '@capacitor/status-bar';

interface ThemeContextType {
  isDark: boolean;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [isDark, setIsDark] = useState(true);

  useEffect(() => {
    StatusBar.setBackgroundColor({ color: '#0f0f0f' });
    document.documentElement.classList.add('dark');
  }, []);

  const toggleTheme = () => {
    setIsDark(prev => !prev);
    document.documentElement.classList.toggle('dark');
    StatusBar.setBackgroundColor({ color: isDark ? '#ffffff' : '#0f0f0f' });
  };

  return (
    <ThemeContext.Provider value={{ isDark, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
