import React from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './styles/tokens.css'
import './styles/base.css'
import './styles/shell.css'
import './lib/platform'
import { initTheme } from './lib/theme'

const isDesktop = !!(window as any).neom?.isDesktop
if (!isDesktop) document.body.classList.add('is-web')

initTheme()

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
)
