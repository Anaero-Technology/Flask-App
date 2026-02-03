import { useState } from 'react'
import { I18nextProvider } from 'react-i18next'
import i18n from './i18n'
import Layout from './components/Layout'
import { ToastProvider } from './components/Toast'
import { ChimeraProvider } from './components/ChimeraContext'
import { AuthProvider, useAuth } from './components/AuthContext'
import { I18nProvider } from './components/i18nContext'
import { ThemeProvider } from './components/ThemeContext'
import { AppSettingsProvider } from './components/AppSettingsContext'
import Dashboard from './view/dashboard'
import SampleForm from './view/SampleForm'
import Database from './view/Database'
import TestForm from './view/TestForm'
import BlackBox from './view/BlackBox'
import Chimera from './view/Chimera'
import Settings from './view/Settings'
import Login from './view/Login'
import UserManagement from './view/UserManagement'
import './App.css'

import Plot from './view/Plot'
import { Loader2 } from 'lucide-react'

function AppContent() {
  const { isAuthenticated, loading, canPerform } = useAuth()
  const [currentView, setCurrentView] = useState('dashboard')
  const [plotParams, setPlotParams] = useState(null)

  const handleNavigate = (view) => {
    // Check permissions for protected views
    if (view === 'users' && !canPerform('manage_users')) {
      return
    }
    setCurrentView(view)
    if (view !== 'plot') {
      setPlotParams(null)
    }
  }

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
        return <SampleForm />
      case 'test':
        return <TestForm />
      case 'database':
        return <Database onViewPlot={handleViewPlot} />
      case 'plot':
        return <Plot initialParams={plotParams} onNavigate={handleNavigate} />
      case 'upload':
        return <div className="p-6">Upload Data - Coming Soon</div>
      case 'blackbox':
        return <BlackBox />
      case 'chimera':
        return <Chimera />
      case 'plc':
        return <div className="p-6">PLC - Coming Soon</div>
      case 'monitor':
        return <div className="p-6">Monitor - Coming Soon</div>
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
