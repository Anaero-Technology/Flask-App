import React, { useState, useEffect } from "react";
import DeviceCard from '../components/deviceCard'
import TipNotification from '../components/TipNotification'
import GFM from '../assets/gfm.png'
import Chimera from "../assets/chimera.jpg"
import { RefreshCw, Server, Activity, CheckCircle } from 'lucide-react';

function Dashboard() {
    const [devices, setDevices] = useState(null)
    const [loading, setLoading] = useState(true)

    const loadDevicesFromDB = async () => {
      setLoading(true)
      try {
        const response = await fetch('/api/v1/devices/connected')
        if (response.ok) {
          const data = await response.json()
          // Map DB fields to match expected format
          const mappedData = data.map(device => ({
            id: device.id,
            name: device.name,
            port: device.serial_port,
            device_type: device.device_type,
            logging: device.logging
          }))
          setDevices(mappedData)
        } else {
          console.error('Failed to load devices:', response.statusText)
          setDevices([])
        }
      } catch (error) {
        console.error('Error loading devices:', error)
        setDevices([])
      } finally {
        setLoading(false)
      }
    }

    const discoverDevices = async () => {
      setLoading(true)
      try {
        const response = await fetch('/api/v1/devices/discover')
        if (response.ok) {
          const data = await response.json()
          setDevices(data)
          // Mark that discovery has been run
          sessionStorage.setItem('discoveryCompleted', 'true')
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

    useEffect(() => {
      // Check if discovery has been run in this session
      const hasDiscovered = sessionStorage.getItem('discoveryCompleted')

      if (hasDiscovered) {
        // Just load from DB if already discovered
        loadDevicesFromDB()
      } else {
        // Run full discovery on first load
        discoverDevices()
      }
    }, [])

    // Calculate stats
    const totalDevices = devices?.length || 0;
    const activeLogging = devices?.filter(d => d.logging).length || 0;
    const blackBoxes = devices?.filter(d => d.device_type === 'black-box').length || 0;

    return (
      <div className="space-y-6">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">System Overview</h1>
            <p className="text-gray-500 mt-1">Manage connected devices and active experiments</p>
          </div>
          <button
            onClick={discoverDevices}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 shadow-sm transition-all"
          >
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
            <span>{loading ? 'Scanning...' : 'Scan Devices'}</span>
          </button>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex items-center gap-4">
            <div className="p-3 bg-blue-50 text-blue-600 rounded-lg">
              <Server size={24} />
            </div>
            <div>
              <p className="text-sm text-gray-500 font-medium">Total Devices</p>
              <p className="text-2xl font-bold text-gray-900">{totalDevices}</p>
            </div>
          </div>
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex items-center gap-4">
            <div className="p-3 bg-green-50 text-green-600 rounded-lg">
              <Activity size={24} />
            </div>
            <div>
              <p className="text-sm text-gray-500 font-medium">Active Logging</p>
              <p className="text-2xl font-bold text-gray-900">{activeLogging}</p>
            </div>
          </div>
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex items-center gap-4">
            <div className="p-3 bg-purple-50 text-purple-600 rounded-lg">
              <CheckCircle size={24} />
            </div>
            <div>
              <p className="text-sm text-gray-500 font-medium">BlackBoxes</p>
              <p className="text-2xl font-bold text-gray-900">{blackBoxes}</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Device Grid */}
          <div className="lg:col-span-2 space-y-6">
            <h2 className="text-xl font-bold text-gray-800">Devices</h2>
            {devices && devices.length > 0 ? (
              devices.map((device, index) => (
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
              ))
            ) : (
              <div className="text-center py-12 bg-white rounded-xl border border-dashed border-gray-300">
                <p className="text-gray-500">No devices found.</p>
              </div>
            )}
          </div>

          {/* Sidebar Notifications */}
          <div className="lg:col-span-1">
            <h2 className="text-xl font-bold text-gray-800 mb-6">Recent Activity</h2>
            {devices && devices
              .filter(device => device.device_type === "black-box")
              .map((device, index) => (
                <div key={`tip-${device.id || index}`} className="mb-4">
                  <TipNotification deviceId={device.id} />
                </div>
              ))}
          </div>
        </div>
      </div>
    )
  }
  
  export default Dashboard
  