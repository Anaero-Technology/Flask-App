import { useState } from 'react'
import Sidebar from './components/Sidebar'
import Dashboard from './view/dashboard'
import SampleForm from './view/SampleForm'
import InoculumForm from './view/InoculumForm'
import Database from './view/Database'
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
        {currentView === 'create-inoculum' && <InoculumForm />}
        {currentView === 'experiment' && <div className="p-6">Experiment Form - Coming Soon</div>}
        {currentView === 'database' && <Database />}
        {currentView === 'plot' && <div className="p-6">Plot - Coming Soon</div>}
        {currentView === 'upload' && <div className="p-6">Upload Data - Coming Soon</div>}
        {currentView === 'blackbox' && <div className="p-6">BlackBox - Coming Soon</div>}
        {currentView === 'chimera' && <div className="p-6">Chimera - Coming Soon</div>}
        {currentView === 'monitor' && <div className="p-6">Monitor - Coming Soon</div>}
        {currentView === 'settings' && <div className="p-6">Settings - Coming Soon</div>}
      </div>
    </div>
  )
}

export default App
