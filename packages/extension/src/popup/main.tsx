import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import '../styles/globals.css'
import { appendExtensionError } from '../lib/error-log'

window.addEventListener('error', (event) => {
  void appendExtensionError({
    source: 'popup',
    category: 'runtime',
    message: event.message || 'Unknown popup error',
    details: event.filename ? `${event.filename}:${event.lineno}:${event.colno}` : undefined
  })
})

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason
  void appendExtensionError({
    source: 'popup',
    category: 'unhandledrejection',
    message: reason instanceof Error ? reason.message : String(reason || 'Unknown promise rejection'),
    details: reason instanceof Error ? reason.stack : undefined
  })
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)