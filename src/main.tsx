import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './app/App'
import { StartupErrorBoundary } from './app/StartupErrorBoundary'
import './styles/tokens.css'
import './styles/app.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StartupErrorBoundary>
      <App />
    </StartupErrorBoundary>
  </StrictMode>,
)
