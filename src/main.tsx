import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './app/App'
import { StartupErrorBoundary } from './app/StartupErrorBoundary'
import '@fontsource-variable/inter/wght.css'
import '@fontsource-variable/atkinson-hyperlegible-next/wght.css'
import '@fontsource/opendyslexic/400.css'
import '@fontsource/opendyslexic/700.css'
import './styles/tokens.css'
import './styles/app.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StartupErrorBoundary>
      <App />
    </StartupErrorBoundary>
  </StrictMode>,
)
