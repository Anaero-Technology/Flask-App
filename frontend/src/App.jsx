import { useState, useEffect, useCallback } from 'react'
import { I18nextProvider } from 'react-i18next'
import i18n from './i18n'
import Layout from './components/Layout'
import { ToastProvider } from './components/Toast'
import { ChimeraProvider } from './components/ChimeraContext'
import { AuthProvider, useAuth } from './components/AuthContext'
import { I18nProvider } from './components/i18nContext'
import { ThemeProvider } from './components/ThemeContext'
import { AppSettingsProvider, useAppSettings } from './components/AppSettingsContext'
import Dashboard from './view/dashboard'
import SampleForm from './view/SampleForm'
import Database from './view/Database'
import TestForm from './view/TestForm'
import Settings from './view/Settings'
import Login from './view/Login'
import UserManagement from './view/UserManagement'
import './App.css'

import Plot from './view/Plot'
import { Loader2 } from 'lucide-react'

const DEFAULT_FAVICON = '/anaero-logo.png'

function AppContent() {
  const { isAuthenticated, loading, canPerform } = useAuth()
  const { logoUrl } = useAppSettings()
  const [currentView, setCurrentView] = useState('dashboard')
  const [plotParams, setPlotParams] = useState(null)
  const [viewParams, setViewParams] = useState(null)

  useEffect(() => {
    document.title = 'Data Digester'
  }, [])

  useEffect(() => {
    const setFavicon = (href) => {
      let favicon = document.querySelector("link[rel='icon']")

      if (!favicon) {
        favicon = document.createElement('link')
        favicon.setAttribute('rel', 'icon')
        document.head.appendChild(favicon)
      }

      favicon.setAttribute('type', 'image/png')
      favicon.setAttribute('href', href)
    }

    // Always start from the static fallback logo in public/.
    setFavicon(DEFAULT_FAVICON)

    // If a custom logo exists, only apply it if it resolves successfully.
    if (!logoUrl) return

    const cacheBustedUrl = `${logoUrl}${logoUrl.includes('?') ? '&' : '?'}t=${Date.now()}`
    const img = new Image()
    img.onload = () => setFavicon(cacheBustedUrl)
    img.onerror = () => setFavicon(DEFAULT_FAVICON)
    img.src = cacheBustedUrl

    return () => {
      img.onload = null
      img.onerror = null
    }
  }, [logoUrl])

  const handleNavigate = useCallback((view, params = null) => {
    // Check permissions for protected views
    if (view === 'users' && !canPerform('manage_users')) {
      return
    }
    setCurrentView(view)
    setViewParams(params ?? null)
    if (view !== 'plot') {
      setPlotParams(null)
    }
  }, [canPerform])

  useEffect(() => {
    const handleExternalNavigate = (event) => {
      const nextView = event?.detail?.view
      if (!nextView) return
      handleNavigate(nextView, event?.detail?.params ?? null)
    }
    window.addEventListener('app:navigate', handleExternalNavigate)
    return () => window.removeEventListener('app:navigate', handleExternalNavigate)
  }, [handleNavigate])

  const handleViewPlot = (testId, deviceId, source = 'dashboard') => {
    setPlotParams({ testId, deviceId, source })
    setCurrentView('plot')
  }

  // Show loading spinner while checking auth
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-slate-950">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600 dark:text-blue-300" />
      </div>
    )
  }

  // Show login if not authenticated
  if (!isAuthenticated) {
    return <Login />
  }

  const renderView = () => {
    switch (currentView) {
      case 'dashboard':
        return <Dashboard onViewPlot={handleViewPlot} />
      case 'create-sample':
        return <SampleForm returnView={viewParams?.returnView} />
      case 'test':
        return <TestForm />
      case 'database':
        return <Database onViewPlot={handleViewPlot} initialParams={viewParams} />
      case 'plot':
        return <Plot initialParams={plotParams} onNavigate={handleNavigate} />
      case 'upload':
        return <div className="p-6">Upload Data - Coming Soon</div>
      case 'plc':
        return <div className="p-6">PLC - Coming Soon</div>
      case 'settings':
        return <Settings />
      case 'users':
        return canPerform('manage_users') ? <UserManagement /> : <Dashboard onViewPlot={handleViewPlot} />
      default:
        return <Dashboard onViewPlot={handleViewPlot} />
    }
  }

  return (
    <ChimeraProvider>
      <Layout currentView={currentView} onNavigate={handleNavigate}>
        {renderView()}
      </Layout>
    </ChimeraProvider>
  )
}

function App() {
  return (
    <I18nextProvider i18n={i18n}>
      <ThemeProvider>
        <ToastProvider>
          <AuthProvider>
            <I18nProvider>
              <AppSettingsProvider>
                <AppContent />
              </AppSettingsProvider>
            </I18nProvider>
          </AuthProvider>
        </ToastProvider>
      </ThemeProvider>
    </I18nextProvider>
  )
}

export default App
