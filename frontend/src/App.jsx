import { useState } from 'react'
import Layout from './components/Layout'
import { ToastProvider } from './components/Toast'
import { CalibrationProvider } from './components/CalibrationContext'
import Dashboard from './view/dashboard'
import SampleForm from './view/SampleForm'
import Database from './view/Database'
import TestForm from './view/TestForm'
import BlackBox from './view/BlackBox'
import Chimera from './view/Chimera'
import Settings from './view/Settings'
import './App.css'

import Plot from './view/Plot'

function App() {
  const [currentView, setCurrentView] = useState('dashboard')
  const [plotParams, setPlotParams] = useState(null)

  const handleNavigate = (view) => {
    setCurrentView(view)
    if (view !== 'plot') {
      setPlotParams(null)
    }
  }

  const handleViewPlot = (testId, deviceId, source = 'dashboard') => {
    setPlotParams({ testId, deviceId, source })
    setCurrentView('plot')
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
        return <PLC />
      case 'monitor':
        return <div className="p-6">Monitor - Coming Soon</div>
      case 'settings':
        return <Settings />
      default:
        return <Dashboard onViewPlot={handleViewPlot} />
    }
  }

  return (
    <ToastProvider>
      <CalibrationProvider>
        <Layout currentView={currentView} onNavigate={handleNavigate}>
          {renderView()}
        </Layout>
      </CalibrationProvider>
    </ToastProvider>
  )
}

export default App
