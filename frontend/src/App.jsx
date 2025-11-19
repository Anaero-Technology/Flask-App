import { useState } from 'react'
import Layout from './components/Layout'
import { ToastProvider } from './components/Toast'
import Dashboard from './view/dashboard'
import SampleForm from './view/SampleForm'
import Database from './view/Database'
import TestForm from './view/TestForm'
import BlackBox from './view/BlackBox'
import Chimera from './view/Chimera'
import Settings from './view/Settings'
import './App.css'

function App() {
  const [currentView, setCurrentView] = useState('dashboard')

  const handleNavigate = (view) => {
    setCurrentView(view)
  }

  const renderView = () => {
    switch (currentView) {
      case 'dashboard':
        return <Dashboard />
      case 'create-sample':
        return <SampleForm />
      case 'test':
        return <TestForm />
      case 'database':
        return <Database />
      case 'plot':
        return <div className="p-6">Plot - Coming Soon</div>
      case 'upload':
        return <div className="p-6">Upload Data - Coming Soon</div>
      case 'blackbox':
        return <BlackBox />
      case 'chimera':
        return <Chimera />
      case 'monitor':
        return <div className="p-6">Monitor - Coming Soon</div>
      case 'settings':
        return <Settings />
      default:
        return <Dashboard />
    }
  }

  return (
    <ToastProvider>
      <Layout currentView={currentView} onNavigate={handleNavigate}>
        {renderView()}
      </Layout>
    </ToastProvider>
  )
}

export default App
