import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../index.css'
import { AccountProvider } from './account'
import { App, useSettings } from './App'

function SidePanel() {
  const { settings, setSettings } = useSettings()
  if (!settings) return null
  return (
    <AccountProvider serverUrl={settings.serverUrl}>
      <App settings={settings} setSettings={setSettings} />
    </AccountProvider>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SidePanel />
  </StrictMode>,
)
