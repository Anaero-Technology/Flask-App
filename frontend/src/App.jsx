import { useState, useEffect } from 'react'
import DeviceCard from './components/deviceCard'
import GFM from './assets/gfm.png'
import refreshIcon from './assets/refresh.svg'
import './App.css'



function App() {
  const [devices, setDevices] = useState(null)
  const [loading, setLoading] = useState(true)

  const discoverDevices = async () => {
    setLoading(true)
    const response = await fetch('/api/v1/devices/discover')
    setDevices(await response.json())
    setLoading(false)
  }

  useEffect(() => {discoverDevices()}, [])

  return (
    <>
      <div>
        {devices && devices.map((device, index) => (
          <DeviceCard 
            key={index}
            title={device.device_type == "black-box" ? "Gas-flow meter" : "Chimera"} 
            name={device.name}
            image={GFM}
          />
        ))}
      </div>
      
      <div className="flex justify-center mt-6">
        <img 
          src={refreshIcon}
          onClick={discoverDevices}
          className={`w-8 h-8 cursor-pointer hover:scale-110 transition-transform ${loading ? 'animate-spin' : ''}`}
          style={{ filter: 'invert(0.4)' }}
          alt="Refresh"
        />
      </div>
    </>
  )
}

export default App
