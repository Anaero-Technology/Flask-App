import React, { useState, useEffect } from "react";
import DeviceCard from '../components/deviceCard'
import GFM from '../assets/gfm.png'
import refreshIcon from '../assets/refresh.svg'


function Dashboard() {
    const [devices, setDevices] = useState(null)
    const [loading, setLoading] = useState(true)
  
    const discoverDevices = async () => {
      setLoading(true)
      try {
        const response = await fetch('/api/v1/devices/discover')
        if (response.ok) {
          const data = await response.json()
          setDevices(data)
        } else {
          console.error('Failed to discover devices:', response.statusText)
          setDevices([])
        }
      } catch (error) {
        console.error('Error discovering devices:', error)
        setDevices([])
      } finally {
        setLoading(false)
      }
    }

    const handleNameUpdate = (deviceId, newName) => {
      setDevices(prevDevices => 
        prevDevices.map(device => 
          device.id === deviceId ? { ...device, name: newName } : device
        )
      )
    }
  
    useEffect(() => {discoverDevices()}, [])
  
    return (
      <div>
        <h1 className="text-4xl font-bold text-black pl-6 m-6">Connected Devices</h1>
        <div className="p-6 pt-6">
          {devices && devices.map((device, index) => (
            <DeviceCard 
              key={device.id || index}
              deviceId={device.id}
              title={device.device_type == "black-box" ? "Gas-flow meter" : "Chimera"} 
              name={device.name}
              logging={device.logging}
              port={device.port}
              image={GFM}
              onNameUpdate={handleNameUpdate}
            />
          ))}
          
          <div className="flex justify-center mt-6">
            <img 
              src={refreshIcon}
              onClick={discoverDevices}
              className={`w-8 h-8 cursor-pointer hover:scale-110 transition-transform ${loading ? 'animate-spin' : ''}`}
              style={{ filter: 'invert(0.4)' }}
              alt="Refresh"
            />
          </div>
        </div>
      </div>
    )
  }
  
  export default Dashboard
  