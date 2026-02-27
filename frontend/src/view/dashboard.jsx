import React, { useState, useEffect } from "react";
import DeviceCard from '../components/deviceCard'
import GFM from '../assets/gfm.png'
import Chimera from "../assets/chimera.jpg"
import { RefreshCw, Server, Activity, FlaskConical, Loader2, TriangleAlert } from 'lucide-react';
import { useAuth } from '../components/AuthContext';
import { useTranslation } from 'react-i18next';



function Dashboard({ onViewPlot }) {
  const { authFetch, user } = useAuth();
  const { t: tPages } = useTranslation('pages');
  const [devices, setDevices] = useState([])
  const [activeTests, setActiveTests] = useState([])
  const [recentEvents, setRecentEvents] = useState([])
  const [loading, setLoading] = useState(false)
  const [globalDeviceModel, setGlobalDeviceModel] = useState(null)
  const [showFileManager, setShowFileManager] = useState(false)
  const [selectedFileDevice, setSelectedFileDevice] = useState(null)
  const [deviceFiles, setDeviceFiles] = useState([])
  const [deviceMemoryInfo, setDeviceMemoryInfo] = useState(null)
  const [loadingFiles, setLoadingFiles] = useState(false)
  const [filesCache, setFilesCache] = useState({})
  const dashboardActionsLocked = user?.role === 'viewer'

  const navigateToView = (view, params = null) => {
    window.dispatchEvent(new CustomEvent('app:navigate', {
      detail: { view, params }
    }))
  }

  const getDeviceApiBase = (deviceType) => (
    deviceType === 'black-box' ? '/api/v1/black_box' : '/api/v1/chimera'
  )

  const getFilesLocalePrefix = () => (
    selectedFileDevice?.device_type === 'black-box' ? 'black_box' : 'chimera'
  )

  const normalizeMemoryInfo = (memory) => {
    if (!memory || typeof memory !== 'object') return null
    const total = Number(memory.total)
    const used = Number(memory.used)
    if (!Number.isFinite(total) || !Number.isFinite(used) || total <= 0) return null
    return {
      total,
      used: Math.min(total, Math.max(0, used))
    }
  }

  const normalizeFiles = (files) => (
    Array.isArray(files)
      ? files.map(file => ({
          ...file,
          size: Number.isFinite(Number(file?.size)) ? Number(file.size) : 0
        }))
      : []
  )

  const applyDeletedFileToMemory = (memory, deletedBytes) => {
    const normalized = normalizeMemoryInfo(memory)
    if (!normalized || deletedBytes <= 0) return normalized
    return {
      ...normalized,
      used: Math.max(0, normalized.used - deletedBytes)
    }
  }

  const fetchFilesForDevice = async (device, options = {}) => {
    if (!device) return
    const { silent = false } = options
    if (!silent) setLoadingFiles(true)
    try {
      const response = await authFetch(`${getDeviceApiBase(device.device_type)}/${device.id}/files`)
      if (response.ok) {
        const data = await response.json()
        const files = normalizeFiles(data.files)
        const memory = normalizeMemoryInfo(data.memory)
        setDeviceFiles(files)
        setDeviceMemoryInfo(memory)
        setFilesCache(prev => ({
          ...prev,
          [device.id]: {
            files,
            memory,
            fetchedAt: Date.now()
          }
        }))
      } else {
        setDeviceFiles([])
        setDeviceMemoryInfo(null)
      }
    } catch (error) {
      console.error('Error fetching dashboard files:', error)
      setDeviceFiles([])
      setDeviceMemoryInfo(null)
    } finally {
      if (!silent) setLoadingFiles(false)
    }
  }

  const loadData = async () => {
    setLoading(true)
    try {
      // Fetch devices
      const devicesResponse = await authFetch('/api/v1/devices/connected')
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
      const testsResponse = await authFetch('/api/v1/tests?status=running&include_devices=true')
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
      const eventsResponse = await authFetch('/api/v1/events/recent')
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
      const response = await authFetch('/api/v1/devices/discover')
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

  const fetchGlobalDeviceModel = async () => {
    try {
      const response = await authFetch('/api/v1/chimera/config/model');
      if (response.ok) {
        const data = await response.json();
        setGlobalDeviceModel(data.device_model);
      }
    } catch (error) {
      console.error('Failed to fetch global device model:', error);
    }
  };

  const handleCalibrateAction = async (deviceId, sensorNumber, gasPercentage) => {
    try {
      const response = await authFetch(`/api/v1/chimera/${deviceId}/calibrate`, {
        method: 'POST',
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

  const handleViewFiles = (deviceId) => {
    const targetDevice = devices.find(device => device.id === deviceId)
    if (!targetDevice) return
    const cached = filesCache[targetDevice.id]
    if (cached) {
      setDeviceFiles(normalizeFiles(cached.files))
      setDeviceMemoryInfo(normalizeMemoryInfo(cached.memory))
      setLoadingFiles(false)
    } else {
      setDeviceFiles([])
      setDeviceMemoryInfo(null)
      setLoadingFiles(true)
    }
    setSelectedFileDevice(targetDevice)
    setShowFileManager(true)
    fetchFilesForDevice(targetDevice, { silent: Boolean(cached) })
  }

  const handleViewTest = (testId) => {
    if (!testId) return
    navigateToView('database', {
      focusTestId: testId
    })
  }

  const handleStartTestFromDevice = () => {
    navigateToView('test')
  }

  const handleStopTestFromDevice = async (testId) => {
    if (!testId) return
    const stopWarningMessage = `${tPages('database.stop_confirmation')}\n\nStopping this test will stop logging on all devices associated with this test.`
    if (!window.confirm(stopWarningMessage)) return

    try {
      const response = await authFetch(`/api/v1/tests/${testId}/stop`, {
        method: 'POST'
      })
      const data = await response.json()
      if (response.ok && data.success) {
        await loadData()
      } else {
        alert(data.error || tPages('database.stop_failed'))
      }
    } catch (error) {
      console.error('Failed to stop test from dashboard:', error)
      alert(tPages('database.stop_error'))
    }
  }

  useEffect(() => {
    fetchGlobalDeviceModel();

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
  const filesLocalePrefix = getFilesLocalePrefix();
  const normalizedMemoryInfo = normalizeMemoryInfo(deviceMemoryInfo)
  const hasValidMemoryInfo = Boolean(
    normalizedMemoryInfo
    && Number.isFinite(normalizedMemoryInfo.total)
    && Number.isFinite(normalizedMemoryInfo.used)
    && normalizedMemoryInfo.total > 0
  );
  const usedPercent = hasValidMemoryInfo
    ? Math.min(100, Math.max(0, (normalizedMemoryInfo.used / normalizedMemoryInfo.total) * 100))
    : 0;
  const usedPercentLabel = hasValidMemoryInfo ? usedPercent.toFixed(2) : '0.00'
  const usedBarWidth = hasValidMemoryInfo
    ? (usedPercent > 0 ? Math.max(usedPercent, 0.75) : 0)
    : 0

  const downloadFile = async (filename) => {
    if (dashboardActionsLocked) return
    if (!selectedFileDevice) return;
    try {
      const response = await authFetch(`${getDeviceApiBase(selectedFileDevice.device_type)}/${selectedFileDevice.id}/download`, {
        method: 'POST',
        body: JSON.stringify({ filename })
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          const fileContent = data.data.join('\n');
          const blob = new Blob([fileContent], { type: 'text/plain' });
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          window.URL.revokeObjectURL(url);
          document.body.removeChild(a);
        }
      }
    } catch (error) {
      console.error('Dashboard file download failed:', error);
    }
  };

  const deleteFile = async (filename) => {
    if (dashboardActionsLocked) return
    if (!selectedFileDevice) return;
    if (!window.confirm(tPages(`${filesLocalePrefix}.delete_confirmation`, { filename }))) {
      return;
    }

    try {
      const response = await authFetch(`${getDeviceApiBase(selectedFileDevice.device_type)}/${selectedFileDevice.id}/delete_file`, {
        method: 'POST',
        body: JSON.stringify({ filename })
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          const deletedSize = Number(deviceFiles.find(file => file.name === filename)?.size || 0)
          const nextFiles = normalizeFiles(deviceFiles.filter(file => file.name !== filename))
          const nextMemory = applyDeletedFileToMemory(deviceMemoryInfo, deletedSize)

          setDeviceFiles(nextFiles)
          setDeviceMemoryInfo(nextMemory)
          setFilesCache(prev => ({
            ...prev,
            [selectedFileDevice.id]: {
              files: nextFiles,
              memory: nextMemory,
              fetchedAt: Date.now()
            }
          }))
        }
      }
    } catch (error) {
      console.error('Dashboard file delete failed:', error);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">{tPages('dashboard.title')}</h1>
        </div>
        <button
          onClick={discoverDevices}
          className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-lg text-gray-700 hover:bg-gray-50 hover:border-gray-300 shadow-sm transition-all font-medium"
        >
          <RefreshCw size={18} className={loading ? 'animate-spin text-blue-500' : 'text-gray-400'} />
          <span>{loading ? tPages('dashboard.scanning') : tPages('dashboard.scan_devices')}</span>
        </button>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex items-center gap-4 transition-transform hover:scale-[1.02]">
          <div className="p-3 bg-blue-50 text-blue-600 rounded-xl">
            <Server size={24} />
          </div>
          <div>
            <p className="text-sm text-gray-500 font-medium">{tPages('dashboard.total_devices')}</p>
            <p className="text-2xl font-bold text-gray-900">{totalDevices}</p>
          </div>
        </div>
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex items-center gap-4 transition-transform hover:scale-[1.02]">
          <div className="p-3 bg-green-50 text-green-600 rounded-xl">
            <Activity size={24} />
          </div>
          <div>
            <p className="text-sm text-gray-500 font-medium">{tPages('dashboard.active_logging')}</p>
            <p className="text-2xl font-bold text-gray-900">{activeLogging}</p>
          </div>
        </div>
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex items-center gap-4 transition-transform hover:scale-[1.02]">
          <div className="p-3 bg-purple-50 text-purple-600 rounded-xl">
            <FlaskConical size={24} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm text-gray-500 font-medium">{tPages('dashboard.running_tests')}</p>
            {runningTests > 0 ? (
              <div className="mt-1 space-y-1 max-h-20 overflow-y-auto pr-1">
                {activeTests.map((test) => (
                  <button
                    key={test.id}
                    type="button"
                    onClick={() => handleViewTest(test.id)}
                    className="block w-full text-left text-sm font-semibold text-gray-900 truncate hover:text-blue-600 transition-colors"
                    title={test.name || `Test ${test.id}`}
                  >
                    {test.name || `Test ${test.id}`}
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-2xl font-bold text-gray-900">0</p>
            )}
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
                {tPages('dashboard.active_devices')}
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
                      onViewFiles={handleViewFiles}
                      onViewTest={handleViewTest}
                      onStartTest={handleStartTestFromDevice}
                      onStopTest={handleStopTestFromDevice}
                      showDashboardActions={true}
                      actionsDisabled={dashboardActionsLocked}
                      globalDeviceModel={globalDeviceModel}
                      onCalibrateAction={handleCalibrateAction}
                    />
                  ))}
              </div>
            </section>
          )}

          {/* Unassigned Devices Section */}
          <section className="-mt-2">
            <h2 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
              {tPages('dashboard.available_devices')}
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
                    onViewFiles={handleViewFiles}
                    onViewTest={handleViewTest}
                    onStartTest={handleStartTestFromDevice}
                    onStopTest={handleStopTestFromDevice}
                    showDashboardActions={true}
                    actionsDisabled={dashboardActionsLocked}
                    onCalibrateAction={handleCalibrateAction}
                    globalDeviceModel={globalDeviceModel}
                  />
                ))}
              </div>
            ) : (
              <div className="text-center py-12 bg-white rounded-xl border border-dashed border-gray-300">
                <p className="text-gray-500">{tPages('dashboard.no_available_devices')}</p>
                {activeLogging > 0 && <p className="text-sm text-gray-400 mt-1">{tPages('dashboard.all_devices_assigned')}</p>}
              </div>
            )}
          </section>
        </div>

        {/* Sidebar Notifications */}
        <div className="lg:col-span-1">
          <div className="sticky top-6">
            <h2 className="text-xl font-bold text-gray-800 mb-5">{tPages('dashboard.recent_activity')}</h2>
            <div className="space-y-2 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
              {recentEvents.length > 0 ? (
                recentEvents.map((event) => (
                  <div key={event.id} className="bg-white p-3 rounded-lg shadow-sm border border-gray-100 hover:bg-gray-50 transition-colors">
                    <div className="flex justify-between items-start mb-1">
                      <span className={`text-xs font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${event.type === 'tip' || event.type === 'raw_data' ? 'bg-blue-100 text-blue-700' :
                        event.type === 'gas_analysis' ? 'bg-purple-100 text-purple-700' :
                          'bg-gray-100 text-gray-700'
                        }`}>
                        {event.type === 'tip' ? tPages('dashboard.event_tip') : event.type === 'raw_data' ? tPages('dashboard.event_raw_data') : event.type === 'gas_analysis' ? tPages('dashboard.event_gas_analysis') : 'Event'}
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
                  {tPages('dashboard.no_recent_activity')}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* File Manager Modal */}
      {showFileManager && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/20 pt-20 px-4">
          <div className="w-full max-w-4xl bg-white rounded-lg p-6 max-h-[80vh] overflow-y-auto shadow-2xl border">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-2xl font-bold">
                {tPages(`${filesLocalePrefix}.files_modal_title`, { device_name: selectedFileDevice?.name })}
              </h2>
              <button
                onClick={() => setShowFileManager(false)}
                className="text-gray-500 hover:text-gray-700 text-2xl"
              >
                ×
              </button>
            </div>

            <div className="mb-4 p-3 rounded-lg border border-amber-200 bg-amber-50">
              <div className="flex items-start gap-2">
                <TriangleAlert size={16} className="text-amber-700 mt-0.5 shrink-0" />
                <div className="text-sm text-amber-900">
                  <div className="font-medium">Serial file downloads are slow and unprocessed.</div>
                  <div className="mt-0.5">
                    It is recommended to download processed files from the test view.
                  </div>
                  {selectedFileDevice?.active_test_id && (
                    <button
                      onClick={() => {
                        setShowFileManager(false)
                        handleViewTest(selectedFileDevice.active_test_id)
                      }}
                      className="mt-2 text-xs font-medium text-amber-900 underline hover:text-amber-950"
                    >
                      Open test view
                    </button>
                  )}
                </div>
              </div>
            </div>

            {loadingFiles ? (
              <div className="py-10 flex flex-col items-center justify-center gap-3 text-gray-600">
                <Loader2 size={24} className="animate-spin text-blue-600" />
                <div className="text-sm font-medium">{tPages(`${filesLocalePrefix}.loading_files`)}</div>
                <div className="text-xs text-gray-500">Reading file list over serial can take several seconds.</div>
              </div>
            ) : (
              <div>
                {hasValidMemoryInfo && (
                  <div className="mb-4 p-3 bg-gray-50 rounded-lg">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-600">{tPages('chimera.sd_card_storage')}</span>
                      <span className="font-medium">
                        {(normalizedMemoryInfo.used / (1024 * 1024)).toFixed(1)} MB used
                        <span className="text-gray-500 ml-1">
                          {tPages('chimera.memory_of')} {(normalizedMemoryInfo.total / (1024 * 1024)).toFixed(1)} {tPages('chimera.memory_total')} ({usedPercentLabel}%)
                        </span>
                      </span>
                    </div>
                    <div className="mt-2 w-full bg-gray-200 rounded-full h-2">
                      <div
                        className="bg-blue-600 h-2 rounded-full"
                        style={{ width: `${usedBarWidth}%` }}
                      />
                    </div>
                  </div>
                )}

                {deviceFiles.length === 0 ? (
                  <div className="text-center text-gray-500 py-8">
                    {tPages(`${filesLocalePrefix}.no_files`)}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {deviceFiles.map((file, index) => (
                      <div key={index} className="flex items-center justify-between p-3 border rounded">
                        <div>
                          <span className="font-medium">{file.name}</span>
                          <span className="text-gray-500 ml-2">
                            ({(file.size / 1024).toFixed(1)} KB)
                          </span>
                          {file.created && (
                            <span className="text-gray-400 ml-2 text-sm">
                              {new Date(file.created * 1000).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => downloadFile(file.name)}
                            disabled={dashboardActionsLocked}
                            className={`px-3 py-1 text-sm rounded font-medium ${dashboardActionsLocked ? 'bg-gray-300 text-gray-500 cursor-not-allowed' : 'bg-green-600 text-white hover:bg-green-700'}`}
                          >
                            {tPages(`${filesLocalePrefix}.download_button`)}
                          </button>
                          <button
                            onClick={() => deleteFile(file.name)}
                            disabled={dashboardActionsLocked}
                            className={`px-3 py-1 text-sm rounded font-medium ${dashboardActionsLocked ? 'bg-gray-300 text-gray-500 cursor-not-allowed' : 'bg-red-600 text-white hover:bg-red-700'}`}
                          >
                            {tPages(`${filesLocalePrefix}.delete_button`)}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="mt-6 flex justify-end">
                  <button
                    onClick={() => fetchFilesForDevice(selectedFileDevice)}
                    disabled={dashboardActionsLocked}
                    className={`px-4 py-2 rounded font-medium ${dashboardActionsLocked ? 'bg-gray-300 text-gray-500 cursor-not-allowed' : 'bg-blue-600 text-white hover:bg-blue-700'}`}
                  >
                    {tPages(`${filesLocalePrefix}.refresh_files_button`)}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )

}
export default Dashboard
