import { StrictMode, type ComponentType } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import './theme.css'

function render(App: ComponentType) {
  createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
}

if (import.meta.env.MODE === 'restricted') {
  void import('./RestrictedApp').then(({ RestrictedApp }) => render(RestrictedApp))
} else {
  void import('./App').then(({ App }) => render(App))
}
