import { useState, useEffect } from 'react'
import { useAuth } from '../components/AuthContext';

function Settings() {
  const { authFetch } = useAuth();
  const [networks, setNetworks] = useState([])
  const [loading, setLoading] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [selectedNetworkIndex, setSelectedNetworkIndex] = useState(null)
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState({ text: '', type: '' })
  const [pulling, setPulling] = useState(false)
  const [pullMessage, setPullMessage] = useState({ text: '', type: '' })
  const [serialLogInfo, setSerialLogInfo] = useState(null)
  const [serialLogMessage, setSerialLogMessage] = useState({ text: '', type: '' })
  const [downloadingLog, setDownloadingLog] = useState(false)
  const [clearingLog, setClearingLog] = useState(false)
  const [csvDelimiter, setCsvDelimiter] = useState(',')
  const [savingDelimiter, setSavingDelimiter] = useState(false)
  const [delimiterMessage, setDelimiterMessage] = useState({ text: '', type: '' })

  const scanNetworks = async () => {
    setLoading(true)
    setMessage({ text: '', type: '' })

    try {
      const response = await authFetch('/api/v1/wifi/scan')
      const data = await response.json()

      if (response.ok) {
        setNetworks(data.networks)
        setMessage({ text: 'Networks scanned successfully', type: 'success' })
      } else {
        setMessage({ text: data.error || 'Failed to scan networks', type: 'error' })
      }
    } catch (error) {
      setMessage({ text: 'Error scanning networks: ' + error.message, type: 'error' })
    } finally {
      setLoading(false)
    }
  }

  const handleNetworkSelect = (network, index) => {
    // If clicking the same network, collapse it
    if (selectedNetworkIndex === index) {
      setSelectedNetworkIndex(null)
      setPassword('')
      return
    }

    setSelectedNetworkIndex(index)
    setPassword('')
    setMessage({ text: '', type: '' })

    // If network is open, connect immediately
    if (network.security === 'None' || network.security === 'Open' || network.security === '') {
      connectToNetwork(network.ssid, '')
    }
  }

  const handleCancelConnect = () => {
    setSelectedNetworkIndex(null)
    setPassword('')
    setMessage({ text: '', type: '' })
  }

  const connectToNetwork = async (ssid, pwd) => {
    setConnecting(true)
    setMessage({ text: '', type: '' })

    try {
      const response = await authFetch('/api/v1/wifi/connect', {
        method: 'POST',
        body: JSON.stringify({
          ssid: ssid,
          password: pwd
        })
      })

      const data = await response.json()

      if (response.ok) {
        setMessage({ text: 'Successfully connected to ' + ssid, type: 'success' })
        setSelectedNetworkIndex(null)
        setPassword('')
      } else {
        setMessage({ text: data.error || 'Failed to connect', type: 'error' })
      }
    } catch (error) {
      setMessage({ text: 'Error connecting: ' + error.message, type: 'error' })
    } finally {
      setConnecting(false)
    }
  }

  const handleConnectWithPassword = (e, network) => {
    e.preventDefault()
    if (network && password) {
      connectToNetwork(network.ssid, password)
    }
  }

  const getSignalStrength = (signal) => {
    const signalNum = parseInt(signal)
    if (isNaN(signalNum)) return 'Unknown'

    if (signalNum >= -50) return 'Excellent'
    if (signalNum >= -60) return 'Good'
    if (signalNum >= -70) return 'Fair'
    return 'Weak'
  }

  const getSignalIcon = (signal) => {
    const signalNum = parseInt(signal)
    if (isNaN(signalNum)) return '📶'

    if (signalNum >= -50) return '📶'
    if (signalNum >= -60) return '📶'
    if (signalNum >= -70) return '📡'
    return '📡'
  }

  const pullFromGithub = async () => {
    setPulling(true)
    setPullMessage({ text: '', type: '' })

    try {
      const response = await authFetch('/api/v1/system/git-pull', {
        method: 'POST'
      })
      const data = await response.json()

      if (response.ok) {
        setPullMessage({ text: data.message || 'Successfully pulled from GitHub', type: 'success' })
      } else {
        setPullMessage({ text: data.error || 'Failed to pull from GitHub', type: 'error' })
      }
    } catch (error) {
      setPullMessage({ text: 'Error pulling from GitHub: ' + error.message, type: 'error' })
    } finally {
      setPulling(false)
    }
  }

  const fetchSerialLogInfo = async () => {
    try {
      const response = await authFetch('/api/v1/system/serial-log/info')
      const data = await response.json()
      if (response.ok) {
        setSerialLogInfo(data)
      }
    } catch (error) {
      console.error('Error fetching serial log info:', error)
    }
  }

  const downloadSerialLog = async () => {
    setDownloadingLog(true)
    setSerialLogMessage({ text: '', type: '' })

    try {
      const response = await authFetch('/api/v1/system/serial-log')

      if (response.ok) {
        const blob = await response.blob()
        const url = window.URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = 'serial_messages.log'
        document.body.appendChild(a)
        a.click()
        window.URL.revokeObjectURL(url)
        document.body.removeChild(a)
        setSerialLogMessage({ text: 'Serial log downloaded successfully', type: 'success' })
      } else {
        const data = await response.json()
        setSerialLogMessage({ text: data.error || 'Failed to download serial log', type: 'error' })
      }
    } catch (error) {
      setSerialLogMessage({ text: 'Error downloading serial log: ' + error.message, type: 'error' })
    } finally {
      setDownloadingLog(false)
    }
  }

  const clearSerialLog = async () => {
    if (!confirm('Are you sure you want to clear the serial log?')) {
      return
    }

    setClearingLog(true)
    setSerialLogMessage({ text: '', type: '' })

    try {
      const response = await authFetch('/api/v1/system/serial-log', {
        method: 'DELETE'
      })
      const data = await response.json()

      if (response.ok) {
        setSerialLogMessage({ text: 'Serial log cleared successfully', type: 'success' })
        fetchSerialLogInfo()
      } else {
        setSerialLogMessage({ text: data.error || 'Failed to clear serial log', type: 'error' })
      }
    } catch (error) {
      setSerialLogMessage({ text: 'Error clearing serial log: ' + error.message, type: 'error' })
    } finally {
      setClearingLog(false)
    }
  }

  const loadUserPreferences = async () => {
    try {
      // Get user data which includes csv_delimiter
      const response = await authFetch('/api/v1/users/me')
      if (response.ok) {
        const user = await response.json()
        setCsvDelimiter(user.csv_delimiter || ',')
      }
    } catch (error) {
      console.error('Error loading user preferences:', error)
    }
  }

  const saveDelimiterPreference = async () => {
    setSavingDelimiter(true)
    setDelimiterMessage({ text: '', type: '' })

    try {
      const response = await authFetch('/api/v1/user/preferences', {
        method: 'PUT',
        body: JSON.stringify({
          csv_delimiter: csvDelimiter
        })
      })

      if (response.ok) {
        setDelimiterMessage({ text: 'CSV delimiter preference saved', type: 'success' })
      } else {
        const data = await response.json()
        setDelimiterMessage({ text: data.error || 'Failed to save preference', type: 'error' })
      }
    } catch (error) {
      setDelimiterMessage({ text: 'Error saving preference: ' + error.message, type: 'error' })
    } finally {
      setSavingDelimiter(false)
    }
  }

  useEffect(() => {
    // Auto-scan on component mount
    scanNetworks()
    fetchSerialLogInfo()
    loadUserPreferences()
  }, [])

  return (
    <div className="p-6">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold mb-6">Settings</h1>

        {/* WiFi Section */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-semibold">WiFi Networks</h2>
            <button
              onClick={scanNetworks}
              disabled={loading}
              className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              {loading ? 'Scanning...' : 'Scan Networks'}
            </button>
          </div>

          {/* Message Display */}
          {message.text && (
            <div className={`mb-4 p-3 rounded ${
              message.type === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
            }`}>
              {message.text}
            </div>
          )}

          {/* Networks List */}
          {loading ? (
            <div className="text-center py-8 text-gray-500">
              Scanning for networks...
            </div>
          ) : networks.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              No networks found. Click "Scan Networks" to search.
            </div>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <div className="max-h-96 overflow-y-auto">
                {networks.map((network, index) => {
                  const isSelected = selectedNetworkIndex === index
                  const needsPassword = network.security !== 'None' && network.security !== 'Open' && network.security !== ''

                  return (
                    <div
                      key={index}
                      className={`border-b last:border-b-0 transition-colors ${isSelected ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
                    >
                      <div
                        className="p-4 flex justify-between items-center cursor-pointer"
                        onClick={() => handleNetworkSelect(network, index)}
                      >
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-lg">{getSignalIcon(network.signal)}</span>
                            <span className="font-semibold">{network.ssid}</span>
                            {needsPassword && <span className="text-gray-500">🔒</span>}
                          </div>
                          <div className="text-sm text-gray-600 mt-1">
                            Signal: {getSignalStrength(network.signal)} ({network.signal}) • {network.security}
                          </div>
                        </div>
                        <div>
                          <button
                            className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleNetworkSelect(network, index)
                            }}
                          >
                            {isSelected ? 'Hide' : 'Connect'}
                          </button>
                        </div>
                      </div>

                      {/* Expandable Password Input Section */}
                      {isSelected && needsPassword && (
                        <div className="px-4 pb-4 bg-blue-50">
                          <form onSubmit={(e) => handleConnectWithPassword(e, network)} className="space-y-3">
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-1">
                                Password
                              </label>
                              <input
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                                placeholder="Enter WiFi password"
                                autoFocus
                                required
                                onClick={(e) => e.stopPropagation()}
                              />
                            </div>

                            <div className="flex gap-3 justify-end">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleCancelConnect()
                                }}
                                className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-50"
                                disabled={connecting}
                              >
                                Cancel
                              </button>
                              <button
                                type="submit"
                                className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:bg-gray-400 disabled:cursor-not-allowed"
                                disabled={connecting || !password}
                                onClick={(e) => e.stopPropagation()}
                              >
                                {connecting ? 'Connecting...' : 'Connect'}
                              </button>
                            </div>
                          </form>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* User Preferences */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">Preferences</h2>

          {/* Delimiter Message Display */}
          {delimiterMessage.text && (
            <div className={`mb-4 p-3 rounded ${
              delimiterMessage.type === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
            }`}>
              {delimiterMessage.text}
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                CSV Delimiter
              </label>
              <div className="flex items-center gap-3">
                <select
                  value={csvDelimiter}
                  onChange={(e) => setCsvDelimiter(e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value=",">Comma (,)</option>
                  <option value=";">Semicolon (;)</option>
                  <option value="\t">Tab</option>
                </select>
                <button
                  onClick={saveDelimiterPreference}
                  disabled={savingDelimiter}
                  className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:bg-gray-400 disabled:cursor-not-allowed"
                >
                  {savingDelimiter ? 'Saving...' : 'Save'}
                </button>
              </div>
              <p className="text-sm text-gray-600 mt-2">
                Choose the delimiter used when exporting data to CSV files
              </p>
            </div>
          </div>
        </div>

        {/* System Settings */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <h2 className="text-xl font-semibold mb-4">System</h2>

          {/* Pull Message Display */}
          {pullMessage.text && (
            <div className={`mb-4 p-3 rounded ${
              pullMessage.type === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
            }`}>
              <pre className="whitespace-pre-wrap text-sm">{pullMessage.text}</pre>
            </div>
          )}

          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-medium">Update Software</h3>
              <p className="text-sm text-gray-600">Pull latest changes from GitHub repository</p>
            </div>
            <button
              onClick={pullFromGithub}
              disabled={pulling}
              className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              {pulling ? 'Pulling...' : 'Pull from GitHub'}
            </button>
          </div>
        </div>

        {/* Serial Log Section */}
        <div className="bg-white rounded-lg shadow-md p-6 mt-6">
          <h2 className="text-xl font-semibold mb-4">Serial Communication Log</h2>

          {/* Serial Log Message Display */}
          {serialLogMessage.text && (
            <div className={`mb-4 p-3 rounded ${
              serialLogMessage.type === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
            }`}>
              {serialLogMessage.text}
            </div>
          )}

          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-medium">Download Serial Log</h3>
              <p className="text-sm text-gray-600">
                Download all serial messages received from devices
                {serialLogInfo && serialLogInfo.exists && (
                  <span className="ml-2 text-gray-500">
                    (Current size: {serialLogInfo.size_formatted})
                  </span>
                )}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={clearSerialLog}
                disabled={clearingLog || !serialLogInfo?.exists}
                className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600 disabled:bg-gray-400 disabled:cursor-not-allowed"
              >
                {clearingLog ? 'Clearing...' : 'Clear Log'}
              </button>
              <button
                onClick={downloadSerialLog}
                disabled={downloadingLog || !serialLogInfo?.exists}
                className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:bg-gray-400 disabled:cursor-not-allowed"
              >
                {downloadingLog ? 'Downloading...' : 'Download Log'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default Settings
