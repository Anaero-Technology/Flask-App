import React, { useState, useEffect } from "react";
import DeviceCard from '../components/deviceCard'
import ActiveTestCard from '../components/ActiveTestCard'
import TipNotification from '../components/TipNotification'
import ChimeraConfig from '../components/ChimeraConfig'
import GFM from '../assets/gfm.png'
import Chimera from "../assets/chimera.jpg"
import { RefreshCw, Server, Activity, CheckCircle, FlaskConical } from 'lucide-react';



function Dashboard({ onViewPlot }) {
  const [devices, setDevices] = useState([])
  const [activeTests, setActiveTests] = useState([])
  const [recentEvents, setRecentEvents] = useState([])
  const [loading, setLoading] = useState(false)

  const loadData = async () => {
    setLoading(true)
    try {
      // Fetch devices
      const devicesResponse = await fetch('/api/v1/devices/connected')
      let devicesData = []
      if (devicesResponse.ok) {
        const data = await devicesResponse.json()
        devicesData = data.map(device => ({
          id: device.id,
          name: device.name,
          port: device.serial_port,
          device_type: device.device_type,
          logging: device.logging,
          active_test_id: device.active_test_id,
          active_test_name: device.active_test_name // Ensure this is captured
        }))
      }

      // Fetch active tests
      const testsResponse = await fetch('/api/v1/tests?status=running&include_devices=true')
      let testsData = []
      let testMap = {}
      if (testsResponse.ok) {
        testsData = await testsResponse.json()
        // Create map of test_id -> start_time
        testsData.forEach(test => {
          testMap[test.id] = test.date_started
        })
      }

      // Enrich devices with test start time
      devicesData = devicesData.map(device => ({
        ...device,
        test_start_time: device.active_test_id ? testMap[device.active_test_id] : null
      }))

      // Fetch recent events
      const eventsResponse = await fetch('/api/v1/events/recent')
      let eventsData = []
      if (eventsResponse.ok) {
        eventsData = await eventsResponse.json()
      }

      setDevices(devicesData)
      setActiveTests(testsData)
      setRecentEvents(eventsData)

    } catch (error) {
      console.error('Error loading dashboard data:', error)
    } finally {
      setLoading(false)
    }
  }

  const discoverDevices = async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/v1/devices/discover')
      if (response.ok) {
        // After discovery, reload all data
        sessionStorage.setItem('discoveryCompleted', 'true')
        await loadData()
      } else {
        console.error('Failed to discover devices:', response.statusText)
      }
    } catch (error) {
      console.error('Error discovering devices:', error)
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
    // Also update in active tests if present
    setActiveTests(prevTests =>
      prevTests.map(test => ({
        ...test,
        devices: test.devices.map(d => d.id === deviceId ? { ...d, name: newName } : d)
      }))
    )
  }

  const handleCalibrateAction = async (deviceId, sensorNumber, gasPercentage) => {
    try {
      const response = await fetch(`/api/v1/chimera/${deviceId}/calibrate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sensor_number: sensorNumber, gas_percentage: gasPercentage })
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          // Optional: use a toast here
          console.log('Calibration started successfully');
        } else {
          console.error(`Failed to calibrate: ${data.message}`);
          alert(`Failed: ${data.message}`);
        }
      }
    } catch (error) {
      console.error('Calibration error:', error);
      alert('Calibration failed to start.');
    }
  };

  useEffect(() => {
    const hasDiscovered = sessionStorage.getItem('discoveryCompleted')
    if (hasDiscovered) {
      loadData()
    } else {
      discoverDevices()
    }

    // Poll for updates every 30 seconds as backup
    const interval = setInterval(loadData, 30000)

    // Setup SSE connection
    const source = new EventSource('/stream');

    source.addEventListener('tip', (e) => {
      const data = JSON.parse(e.data);
      setRecentEvents(prev => {
        const newEvent = {
          id: `tip_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          type: 'tip',
          device_name: data.device_name,
          channel: data.channel,
          timestamp: data.timestamp,
          details: data.details
        };
        return [newEvent, ...prev].slice(0, 20);
      });
    });

    source.addEventListener('gas_analysis', (e) => {
      const data = JSON.parse(e.data);
      setRecentEvents(prev => {
        const newEvent = {
          id: `gas_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          type: 'gas_analysis',
          device_name: data.device_name,
          channel: data.channel,
          timestamp: data.timestamp,
          details: data.details
        };
        return [newEvent, ...prev].slice(0, 20);
      });
    });

    source.onerror = (e) => {
      console.error("SSE Error:", e);
      source.close();
    };

    return () => {
      clearInterval(interval);
      source.close();
    }
  }, [])

  // Calculate stats
  const totalDevices = devices?.length || 0;
  const activeLogging = devices?.filter(d => d.logging).length || 0;
  const runningTests = activeTests?.length || 0;

  // Filter devices that are NOT in an active test
  const unassignedDevices = devices?.filter(d => !d.active_test_id) || [];

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">System Overview</h1>
        </div>
        <button
          onClick={discoverDevices}
          className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-lg text-gray-700 hover:bg-gray-50 hover:border-gray-300 shadow-sm transition-all font-medium"
        >
          <RefreshCw size={18} className={loading ? 'animate-spin text-blue-500' : 'text-gray-400'} />
          <span>{loading ? 'Scanning...' : 'Scan Devices'}</span>
        </button>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex items-center gap-4 transition-transform hover:scale-[1.02]">
          <div className="p-3 bg-blue-50 text-blue-600 rounded-xl">
            <Server size={24} />
          </div>
          <div>
            <p className="text-sm text-gray-500 font-medium">Total Devices</p>
            <p className="text-2xl font-bold text-gray-900">{totalDevices}</p>
          </div>
        </div>
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex items-center gap-4 transition-transform hover:scale-[1.02]">
          <div className="p-3 bg-green-50 text-green-600 rounded-xl">
            <Activity size={24} />
          </div>
          <div>
            <p className="text-sm text-gray-500 font-medium">Active Logging</p>
            <p className="text-2xl font-bold text-gray-900">{activeLogging}</p>
          </div>
        </div>
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex items-center gap-4 transition-transform hover:scale-[1.02]">
          <div className="p-3 bg-purple-50 text-purple-600 rounded-xl">
            <FlaskConical size={24} />
          </div>
          <div>
            <p className="text-sm text-gray-500 font-medium">Running Tests</p>
            <p className="text-2xl font-bold text-gray-900">{runningTests}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-8">

          {/* Active Devices Section */}
          {activeLogging > 0 && (
            <section>
              <h2 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
                Active Devices
              </h2>
              <div className="grid grid-cols-1 gap-4">
                {devices
                  .filter(d => d.active_test_id)
                  .map((device, index) => (
                    <DeviceCard
                      key={device.id || index}
                      deviceId={device.id}
                      deviceType={device.device_type}
                      title={device.device_type === "black-box" ? "Gas-flow meter" : "Chimera"}
                      name={device.name}
                      logging={device.logging}
                      port={device.port}
                      image={device.device_type === "black-box" ? GFM : Chimera}
                      activeTestName={device.active_test_name}
                      activeTestId={device.active_test_id}
                      testStartTime={device.test_start_time}
                      onNameUpdate={handleNameUpdate}
                      onViewPlot={onViewPlot}
                    />
                  ))}
              </div>
            </section>
          )}

          {/* Unassigned Devices Section */}
          <section className="-mt-2">
            <h2 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
              Available Devices
            </h2>
            {unassignedDevices.length > 0 ? (
              <div className="grid grid-cols-1 gap-4">
                {unassignedDevices.map((device, index) => (
                  <DeviceCard
                    key={device.id || index}
                    deviceId={device.id}
                    deviceType={device.device_type}
                    title={device.device_type === "black-box" ? "Gas-flow meter" : "Chimera"}
                    name={device.name}
                    logging={device.logging}
                    port={device.port}
                    image={device.device_type === "black-box" ? GFM : Chimera}
                    onNameUpdate={handleNameUpdate}
                    onViewPlot={onViewPlot}
                    onCalibrateAction={handleCalibrateAction}
                  />
                ))}
              </div>
            ) : (
              <div className="text-center py-12 bg-white rounded-xl border border-dashed border-gray-300">
                <p className="text-gray-500">No available devices found.</p>
                {activeLogging > 0 && <p className="text-sm text-gray-400 mt-1">All devices are currently assigned to active tests.</p>}
              </div>
            )}
          </section>
        </div>

        {/* Sidebar Notifications */}
        <div className="lg:col-span-1">
          <div className="sticky top-6">
            <h2 className="text-xl font-bold text-gray-800 mb-5">Recent Activity</h2>
            <div className="space-y-2 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
              {recentEvents.length > 0 ? (
                recentEvents.map((event) => (
                  <div key={event.id} className="bg-white p-3 rounded-lg shadow-sm border border-gray-100 hover:bg-gray-50 transition-colors">
                    <div className="flex justify-between items-start mb-1">
                      <span className={`text-xs font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${event.type === 'tip' || event.type === 'raw_data' ? 'bg-blue-100 text-blue-700' :
                        event.type === 'gas_analysis' ? 'bg-purple-100 text-purple-700' :
                          'bg-gray-100 text-gray-700'
                        }`}>
                        {event.type === 'tip' || event.type === 'raw_data' ? 'Tip' : event.type === 'gas_analysis' ? 'Gas' : 'Event'}
                      </span>
                      <span className="text-xs text-gray-400">
                        {new Date(event.timestamp * 1000).toLocaleTimeString()}
                      </span>
                    </div>

                    <div className="text-sm font-medium text-gray-900 truncate">
                      {event.device_name} <span className="text-gray-400">•</span> Ch {event.channel}
                    </div>

                    <div className="text-xs text-gray-500 mt-1">
                      {event.type === 'tip' && (
                        event.details.volume > 0 ? (
                          <span>Vol: {event.details.volume.toFixed(2)} mL</span>
                        ) : (
                          <span>P: {event.details.pressure?.toFixed(1)} | T: {event.details.temperature !== 'N/A' ? event.details.temperature?.toFixed(1) : 'N/A'}</span>
                        )
                      )}
                      {event.type === 'gas_analysis' && (
                        <div className="flex flex-wrap gap-2">
                          {event.details.gases?.map((gas, idx) => (
                            <span key={idx} className="text-xs">
                              {gas.gas}: {gas.peak.toFixed(2)}
                            </span>
                          ))}
                        </div>
                      )}
                      {event.type === 'raw_data' && (
                        <span>P: {event.details.pressure?.toFixed(1)} | T: {event.details.temperature?.toFixed(1)}</span>
                      )}
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center py-8 bg-white rounded-xl border border-dashed border-gray-300 text-gray-500 text-sm">
                  No recent activity
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )

}
export default Dashboard
