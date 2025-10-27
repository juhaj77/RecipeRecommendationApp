import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './styles.scss'

const container = document.getElementById('root') as HTMLElement
const root = createRoot(container)
root.render(<App />)
