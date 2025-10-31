import { useState } from 'react'
import Sidebar from './components/Sidebar'
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


  return (
    <div className="flex">
      <Sidebar 
        onNavigate={handleNavigate} 
        currentView={currentView} 
      />
      
      <div className="flex-1 ml-64">
        {currentView === 'dashboard' && <Dashboard />}
        {currentView === 'create-sample' && <SampleForm />}
        {currentView === 'test' && <TestForm />}
        {currentView === 'database' && <Database />}
        {currentView === 'plot' && <div className="p-6">Plot - Coming Soon</div>}
        {currentView === 'upload' && <div className="p-6">Upload Data - Coming Soon</div>}
        {currentView === 'blackbox' && <BlackBox />}
        {currentView === 'chimera' && <Chimera />}
        {currentView === 'monitor' && <div className="p-6">Monitor - Coming Soon</div>}
        {currentView === 'settings' && <Settings />}
      </div>
    </div>
  )
}

export default App
