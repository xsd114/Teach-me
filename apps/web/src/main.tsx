import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { installErrorReporting } from './lib/errorReport'

// 先接管全局报错，再渲染 —— 否则首屏就崩的话一条记录都留不下
installErrorReporting()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)
