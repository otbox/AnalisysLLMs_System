import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import LlmTesterPage from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LlmTesterPage />
  </StrictMode>,
)
