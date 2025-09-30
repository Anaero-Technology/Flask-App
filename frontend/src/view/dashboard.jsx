import React, { useState, useEffect } from "react";
import DeviceCard from '../components/deviceCard'
import TipNotification from '../components/TipNotification'
import GFM from '../assets/gfm.png'
import Chimera from "../assets/chimera.jpg"
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
        
        {/* Show tip notifications for connected blackbox devices */}
        <div className="p-6 pb-2">
          {devices && devices
            .filter(device => device.device_type === "black-box")
            .map((device, index) => (
            <div key={`tip-${device.id || index}`} className="mb-4">
              <TipNotification deviceId={device.id} />
            </div>
          ))}
        </div>
        
        <div className="p-6 pt-6">
          {devices && devices.map((device, index) => (
            <DeviceCard 
              key={device.id || index}
              deviceId={device.id}
              deviceType={device.device_type}
              title={device.device_type == "black-box" ? "Gas-flow meter" : "Chimera"} 
              name={device.name}
              logging={device.logging}
              port={device.port}
              image={device.device_type == "black-box" ? GFM : Chimera}
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
  