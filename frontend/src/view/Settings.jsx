import { useState, useEffect, useRef } from 'react'
import { useAuth } from '../components/AuthContext';
import { useI18n } from '../components/i18nContext';
import { useTranslation } from 'react-i18next';
import { useAppSettings } from '../components/AppSettingsContext';
import { useToast } from '../components/Toast';
import { useTheme } from '../components/ThemeContext';
import {
  Upload, X, Loader2, Wifi, WifiHigh, WifiLow, WifiOff,
  Lock, Search, Download, Trash2, ShieldAlert,
  Sun, Moon, Monitor
} from 'lucide-react';

function Settings() {
  const { authFetch, canPerform, refreshUser } = useAuth();
  const { changeLanguage, currentLanguage } = useI18n();
  const { t: tCommon } = useTranslation('common');
  const { t: tPages } = useTranslation('pages');
  const { companyName, logoUrl, refreshSettings } = useAppSettings();
  const toast = useToast();
  const { setTheme } = useTheme();
  const [themePreference, setThemePreference] = useState(() => {
    const stored = localStorage.getItem('themePreference')
    return stored === 'light' || stored === 'dark' ? stored : 'system'
  })
  const [networks, setNetworks] = useState([])
  const [loading, setLoading] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [connectingSsid, setConnectingSsid] = useState(null)
  const [selectedNetworkIndex, setSelectedNetworkIndex] = useState(null)
  const [password, setPassword] = useState('')
  const [username, setUsername] = useState('')
  const [message, setMessage] = useState({ text: '', type: '' })
  const [pulling, setPulling] = useState(false)
  const [pullMessage, setPullMessage] = useState({ text: '', type: '' })
  const [updateCheck, setUpdateCheck] = useState(null)
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const [networkStatus, setNetworkStatus] = useState(null)
  const [ethForm, setEthForm] = useState({ mode: 'dhcp', address: '', prefix: '24', gateway: '', dns: '' })
  const [applyingNetwork, setApplyingNetwork] = useState(false)
  const [networkMessage, setNetworkMessage] = useState({ text: '', type: '' })
  const [runningTestsCount, setRunningTestsCount] = useState(0)
  const [serialLogInfo, setSerialLogInfo] = useState(null)
  const [serialLogMessage, setSerialLogMessage] = useState({ text: '', type: '' })
  const [downloadingLog, setDownloadingLog] = useState(false)
  const [clearingLog, setClearingLog] = useState(false)
  const [databaseMessage, setDatabaseMessage] = useState({ text: '', type: '' })
  const [downloadingDb, setDownloadingDb] = useState(false)
  const [transferringDb, setTransferringDb] = useState(false)
  const [deletingDb, setDeletingDb] = useState(false)
  const [databaseFile, setDatabaseFile] = useState(null)
  const [passwordPrompt, setPasswordPrompt] = useState({
    open: false,
    message: '',
    password: '',
    error: '',
    loading: false
  })
  const passwordResolveRef = useRef(null)
  const updatePollRef = useRef(null)
  const [csvDelimiter, setCsvDelimiter] = useState(',')
  const [savingDelimiter, setSavingDelimiter] = useState(false)
  const [delimiterMessage, setDelimiterMessage] = useState({ text: '', type: '' })
  const [language, setLanguage] = useState('en')
  const [savingLanguage, setSavingLanguage] = useState(false)
  const [languageMessage, setLanguageMessage] = useState({ text: '', type: '' })
  const [brandingCompanyName, setBrandingCompanyName] = useState(companyName)
  const [brandingLogoPreview, setBrandingLogoPreview] = useState(logoUrl)
  const [savingBranding, setSavingBranding] = useState(false)
  const [brandingMessage, setBrandingMessage] = useState({ text: '', type: '' })
  const isSystemAdmin = canPerform('system_settings')

  const scanNetworks = async () => {
    setLoading(true)
    setMessage({ text: '', type: '' })

    try {
      const response = await authFetch('/api/v1/wifi/scan')
      const data = await response.json()

      if (response.ok) {
        setNetworks(data.networks)
        setMessage({ text: tPages('settings.networks_scanned_success'), type: 'success' })
      } else {
        setMessage({ text: data.error || tPages('settings.failed_scan_networks'), type: 'error' })
      }
    } catch (error) {
      setMessage({ text: `${tPages('settings.error_scanning_networks')}: ${error.message}`, type: 'error' })
    } finally {
      setLoading(false)
    }
  }

  const handleNetworkSelect = (network, index) => {
    if (network?.connected) {
      return
    }

    // Open networks have no credential form: connect straight away instead
    // of expanding an empty panel (which made the button flip to "Hide")
    if (network.security === 'None' || network.security === 'Open' || network.security === '') {
      if (!connecting) {
        setSelectedNetworkIndex(null)
        setPassword('')
        setUsername('')
        setMessage({ text: '', type: '' })
        connectToNetwork(network.ssid, '', '', network.security)
      }
      return
    }

    // If clicking the same network, collapse it
    if (selectedNetworkIndex === index) {
      setSelectedNetworkIndex(null)
      setPassword('')
      return
    }

    setSelectedNetworkIndex(index)
    setPassword('')
    setUsername('')
    setMessage({ text: '', type: '' })
  }

  const loadNetworkStatus = async () => {
    try {
      const response = await authFetch('/api/v1/network/status')
      if (!response.ok) return
      const data = await response.json()
      setNetworkStatus(data)
      // Pre-fill the form from the live config so Apply is never a surprise
      const eth = data.interfaces?.find(i => i.type === 'ethernet')
      if (eth) {
        const staticAddr = (eth.addresses || []).find(a => !a.startsWith('169.254.'))
        setEthForm(prev => ({
          ...prev,
          mode: eth.method === 'manual' ? 'static' : 'dhcp',
          address: eth.method === 'manual' && staticAddr ? staticAddr.split('/')[0] : prev.address,
          prefix: eth.method === 'manual' && staticAddr ? (staticAddr.split('/')[1] || '24') : prev.prefix,
          gateway: eth.method === 'manual' ? (eth.gateway || '') : prev.gateway
        }))
      }
    } catch {
      // Status display is best-effort
    }
  }

  const isCurrentInterface = (iface) => (
    (iface?.addresses || []).some(a => a.split('/')[0] === window.location.hostname)
  )

  const networkStateLabel = (state) => {
    if (!state) return ''
    if (state === 'connected') return tPages('settings.network_state_connected')
    if (state === 'disconnected') return tPages('settings.network_state_disconnected')
    if (state === 'unavailable') return tPages('settings.network_state_unavailable')
    if (state.startsWith('connecting')) return tPages('settings.network_state_connecting')
    return state
  }

  const submitEthernetConfig = async (request) => {
    const eth = networkStatus?.interfaces?.find(i => i.type === 'ethernet')
    if (eth && isCurrentInterface(eth) && !window.confirm(tPages('settings.network_apply_warning'))) {
      return
    }
    setApplyingNetwork(true)
    setNetworkMessage({ text: '', type: '' })
    try {
      const response = await request()
      const data = await response.json()
      if (response.ok) {
        setNetworkMessage({ text: data.message, type: 'success' })
      } else {
        setNetworkMessage({ text: data.error || tPages('settings.connection_failed'), type: 'error' })
      }
    } catch {
      // Likely we were connected through the reconfigured interface
      setNetworkMessage({ text: tPages('settings.network_apply_warning'), type: 'info' })
    } finally {
      setApplyingNetwork(false)
      loadNetworkStatus()
    }
  }

  const applyEthernetConfig = () => submitEthernetConfig(() => {
    const body = ethForm.mode === 'static'
      ? {
          mode: 'static',
          address: ethForm.address.trim(),
          prefix: parseInt(ethForm.prefix, 10),
          gateway: ethForm.gateway.trim(),
          dns: ethForm.dns.trim()
        }
      : { mode: 'dhcp' }
    return authFetch('/api/v1/network/ethernet', { method: 'PUT', body: JSON.stringify(body) })
  })

  const resetEthernetConfig = () => submitEthernetConfig(() => (
    authFetch('/api/v1/network/ethernet/reset', { method: 'POST' })
  ))

  const handleCancelConnect = () => {
    setSelectedNetworkIndex(null)
    setPassword('')
    setUsername('')
    setMessage({ text: '', type: '' })
  }

  const connectToNetwork = async (ssid, pwd, networkUsername = '', security = '') => {
    // Check if switching networks - warn user they'll be disconnected
    const currentNetwork = networks.find(n => n.connected)
    if (currentNetwork && currentNetwork.ssid !== ssid) {
      const confirmed = window.confirm(
        `Connecting to "${ssid}" will disconnect you from "${currentNetwork.ssid}".\n\n` +
        `You will lose access to this page and need to reconnect to the app using the new network's IP address (shown on the device display).\n\n` +
        `You must be connected to the same network as the Chimera to access the application.`
      )
      if (!confirmed) {
        setConnecting(false)
        return
      }
    }

    setConnecting(true)
    setConnectingSsid(ssid)
    setMessage({ text: '', type: '' })

    try {
      const response = await authFetch('/api/v1/wifi/connect', {
        method: 'POST',
        body: JSON.stringify({
          ssid: ssid,
          password: pwd,
          username: networkUsername,
          security: security
        })
      })

      const data = await response.json()

      if (response.ok) {
        setMessage({ text: tPages('settings.connected', { ssid }), type: 'success' })
        setSelectedNetworkIndex(null)
        setPassword('')
      } else {
        setMessage({ text: data.error || tPages('settings.connection_failed'), type: 'error' })
      }
    } catch (error) {
      // If we lose connection, the network switch likely succeeded
      toast.info(`Connecting to ${ssid}. Check the device display for the new IP address.`, 10000)
    } finally {
      setConnecting(false)
      setConnectingSsid(null)
    }
  }

  const handleConnectWithPassword = (e, network) => {
    e.preventDefault()
    const isEnterprise = network.security && network.security.includes('802.1X')
    if (network && password && (!isEnterprise || username)) {
      connectToNetwork(network.ssid, password, username, network.security)
    }
  }

  const getSignalStrength = (signal) => {
    const signalNum = parseInt(signal)
    if (isNaN(signalNum)) return tPages('settings.signal_unknown')

    // nmcli reports signal as 0-100 percent; iwlist/macOS report dBm (negative)
    if (signalNum >= 0) {
      if (signalNum >= 75) return tPages('settings.signal_excellent')
      if (signalNum >= 50) return tPages('settings.signal_good')
      if (signalNum >= 30) return tPages('settings.signal_fair')
      return tPages('settings.signal_weak')
    }

    if (signalNum >= -50) return tPages('settings.signal_excellent')
    if (signalNum >= -60) return tPages('settings.signal_good')
    if (signalNum >= -70) return tPages('settings.signal_fair')
    return tPages('settings.signal_weak')
  }

  const getSignalIcon = (signal) => {
    const signalNum = parseInt(signal)
    if (isNaN(signalNum)) return <WifiOff size={18} className="text-gray-400" />

    if (signalNum >= -50) return <WifiHigh size={18} className="text-green-500" />
    if (signalNum >= -60) return <Wifi size={18} className="text-blue-500" />
    if (signalNum >= -70) return <WifiLow size={18} className="text-amber-500" />
    return <WifiOff size={18} className="text-red-400" />
  }

  const getSignalColor = (signal) => {
    const signalNum = parseInt(signal)
    if (isNaN(signalNum)) return 'text-gray-500'
    if (signalNum >= -50) return 'text-green-600'
    if (signalNum >= -60) return 'text-blue-600'
    if (signalNum >= -70) return 'text-amber-600'
    return 'text-red-600'
  }

  const pollUpdateStatus = (triggeredAt) => {
    const startTime = Date.now()
    const TIMEOUT_MS = 180000
    const POLL_INTERVAL_MS = 3000

    setPullMessage({ text: 'Update started. Waiting for backend to restart...', type: 'info' })

    updatePollRef.current = setInterval(async () => {
      if (Date.now() - startTime > TIMEOUT_MS) {
        clearInterval(updatePollRef.current)
        updatePollRef.current = null
        setPulling(false)
        setPullMessage({
          text: 'Update timed out. The backend may still be updating. Try refreshing the page.',
          type: 'error'
        })
        return
      }

      try {
        // Plain fetch: the endpoint is unauthenticated because the update
        // restarts the backend, which may invalidate this session's JWT.
        const response = await fetch(
          `/api/v1/system/update-status?triggered_at=${encodeURIComponent(triggeredAt)}`
        )
        if (!response.ok) return

        const data = await response.json()

        if (data.status === 'in_progress') {
          setPullMessage({ text: data.message, type: 'info' })
          return
        }

        clearInterval(updatePollRef.current)
        updatePollRef.current = null
        setPulling(false)
        setPullMessage({
          text: data.message,
          type: data.status === 'success' ? 'success' : 'error'
        })
        checkForUpdates()
      } catch {
        // Network error — backend still down, keep polling
      }
    }, POLL_INTERVAL_MS)
  }

  const checkForUpdates = async () => {
    setCheckingUpdate(true)
    try {
      const response = await authFetch('/api/v1/system/update-check')
      if (response.ok) {
        setUpdateCheck(await response.json())
      } else {
        setUpdateCheck({ error: true })
      }
    } catch {
      setUpdateCheck({ error: true })
    } finally {
      setCheckingUpdate(false)
    }
  }

  const pullFromGithub = async () => {
    if (!isSystemAdmin) {
      setPullMessage({ text: 'Only admins can update software.', type: 'error' })
      return
    }

    if (runningTestsCount > 0) {
      setPullMessage({ text: 'Cannot update while tests are running. Stop all running tests first.', type: 'error' })
      return
    }

    setPulling(true)
    setPullMessage({ text: '', type: '' })

    try {
      const response = await authFetch('/api/v1/system/git-pull', {
        method: 'POST'
      })
      const data = await response.json()

      if (response.ok) {
        pollUpdateStatus(new Date().toISOString())
      } else {
        setPulling(false)
        setPullMessage({ text: data.error || 'Failed to start update', type: 'error' })
      }
    } catch (error) {
      setPulling(false)
      setPullMessage({ text: 'Error starting update: ' + error.message, type: 'error' })
    }
  }

  const fetchRunningTestsCount = async () => {
    try {
      const response = await authFetch('/api/v1/tests?status=running')
      if (!response.ok) return
      const data = await response.json()
      setRunningTestsCount(Array.isArray(data) ? data.length : 0)
    } catch (error) {
      console.error('Error fetching running tests count:', error)
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
    if (!isSystemAdmin) {
      setSerialLogMessage({ text: 'Only admins can download serial logs.', type: 'error' })
      return
    }

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
    if (!isSystemAdmin) {
      setSerialLogMessage({ text: 'Only admins can clear serial logs.', type: 'error' })
      return
    }

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

  const requestPassword = (message) => {
    return new Promise((resolve) => {
      passwordResolveRef.current = resolve
      setPasswordPrompt({
        open: true,
        message,
        password: '',
        error: '',
        loading: false
      })
    })
  }

  const resolvePasswordPrompt = (result) => {
    if (passwordResolveRef.current) {
      passwordResolveRef.current(result)
      passwordResolveRef.current = null
    }
    setPasswordPrompt({
      open: false,
      message: '',
      password: '',
      error: '',
      loading: false
    })
  }

  const verifyPassword = async () => {
    if (!passwordPrompt.password) {
      setPasswordPrompt((prev) => ({
        ...prev,
        error: tPages('settings.database_password_required')
      }))
      return
    }

    setPasswordPrompt((prev) => ({ ...prev, loading: true, error: '' }))

    try {
      const response = await authFetch('/api/v1/auth/verify-password', {
        method: 'POST',
        body: JSON.stringify({ password: passwordPrompt.password })
      })

      if (response.ok) {
        resolvePasswordPrompt(true)
      } else {
        const data = await response.json()
        setPasswordPrompt((prev) => ({
          ...prev,
          loading: false,
          error: data.error || tPages('settings.database_password_incorrect')
        }))
      }
    } catch (error) {
      setPasswordPrompt((prev) => ({
        ...prev,
        loading: false,
        error: tPages('settings.database_action_failed') + ': ' + error.message
      }))
    }
  }

  const requirePassword = async (message) => {
    const confirmed = await requestPassword(message)
    return confirmed
  }

  const handleDatabaseFileChange = (event) => {
    const file = event.target.files && event.target.files[0]
    setDatabaseFile(file || null)
  }

  const downloadDatabase = async () => {
    const confirmed = await requirePassword(tPages('settings.database_confirm_download'))
    if (!confirmed) return

    setDownloadingDb(true)
    setDatabaseMessage({ text: '', type: '' })

    try {
      const response = await authFetch('/api/v1/system/database/download')
      if (response.ok) {
        const blob = await response.blob()
        const url = window.URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = 'database.sqlite'
        document.body.appendChild(a)
        a.click()
        window.URL.revokeObjectURL(url)
        document.body.removeChild(a)
        setDatabaseMessage({ text: tPages('settings.database_download_success'), type: 'success' })
      } else {
        const data = await response.json()
        setDatabaseMessage({ text: data.error || tPages('settings.database_action_failed'), type: 'error' })
      }
    } catch (error) {
      setDatabaseMessage({ text: tPages('settings.database_action_failed') + ': ' + error.message, type: 'error' })
    } finally {
      setDownloadingDb(false)
    }
  }

  const transferDatabase = async () => {
    if (!databaseFile) {
      setDatabaseMessage({ text: tPages('settings.database_no_file'), type: 'error' })
      return
    }

    const confirmed = await requirePassword(tPages('settings.database_confirm_transfer'))
    if (!confirmed) return

    setTransferringDb(true)
    setDatabaseMessage({ text: '', type: '' })

    try {
      const formData = new FormData()
      formData.append('database', databaseFile)
      formData.append('confirm', 'TRANSFER')

      const response = await authFetch('/api/v1/system/database/transfer', {
        method: 'POST',
        body: formData
      })

      if (response.ok) {
        setDatabaseMessage({ text: tPages('settings.database_transfer_success'), type: 'success' })
        setDatabaseFile(null)
      } else {
        const data = await response.json()
        setDatabaseMessage({ text: data.error || tPages('settings.database_action_failed'), type: 'error' })
      }
    } catch (error) {
      setDatabaseMessage({ text: tPages('settings.database_action_failed') + ': ' + error.message, type: 'error' })
    } finally {
      setTransferringDb(false)
    }
  }

  const deleteDatabase = async () => {
    const confirmed = await requirePassword(tPages('settings.database_confirm_delete'))
    if (!confirmed) return

    setDeletingDb(true)
    setDatabaseMessage({ text: '', type: '' })

    try {
      const response = await authFetch('/api/v1/system/database', {
        method: 'DELETE',
        body: JSON.stringify({ confirm: 'DELETE' })
      })

      if (response.ok) {
        setDatabaseMessage({ text: tPages('settings.database_delete_success'), type: 'success' })
      } else {
        const data = await response.json()
        setDatabaseMessage({ text: data.error || tPages('settings.database_action_failed'), type: 'error' })
      }
    } catch (error) {
      setDatabaseMessage({ text: tPages('settings.database_action_failed') + ': ' + error.message, type: 'error' })
    } finally {
      setDeletingDb(false)
    }
  }

  const loadUserPreferences = async () => {
    try {
      // Get user data which includes csv_delimiter and language
      const response = await authFetch('/api/v1/users/me')
      if (response.ok) {
        const user = await response.json()
        setCsvDelimiter(user.csv_delimiter || ',')
        setLanguage(user.language || 'en')
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
        setDelimiterMessage({ text: tPages('settings.delimiter_saved'), type: 'success' })
        // Sync the cached user object so client-side CSV exports pick up
        // the new delimiter without a page reload
        refreshUser()
      } else {
        const data = await response.json()
        setDelimiterMessage({ text: data.error || tPages('settings.save_preference_failed'), type: 'error' })
      }
    } catch (error) {
      setDelimiterMessage({ text: 'Error saving preference: ' + error.message, type: 'error' })
    } finally {
      setSavingDelimiter(false)
    }
  }

  const saveLanguagePreference = async (newLanguage) => {
    setSavingLanguage(true)
    setLanguageMessage({ text: '', type: '' })

    try {
      const response = await authFetch('/api/v1/user/preferences', {
        method: 'PUT',
        body: JSON.stringify({
          language: newLanguage
        })
      })

      if (response.ok) {
        setLanguage(newLanguage)
        // Update the app language
        await changeLanguage(newLanguage)
        setLanguageMessage({ text: tPages('settings.language_saved'), type: 'success' })
      } else {
        const data = await response.json()
        setLanguageMessage({ text: data.error || tPages('settings.save_preference_failed'), type: 'error' })
      }
    } catch (error) {
      setLanguageMessage({ text: 'Error saving preference: ' + error.message, type: 'error' })
    } finally {
      setSavingLanguage(false)
    }
  }

  const handleThemeChange = (value) => {
    setThemePreference(value)
    setTheme(value)
  }

  const saveCompanyName = async () => {
    setSavingBranding(true)
    setBrandingMessage({ text: '', type: '' })

    try {
      const response = await authFetch('/api/v1/app-settings', {
        method: 'PUT',
        body: JSON.stringify({ company_name: brandingCompanyName })
      })

      if (response.ok) {
        setBrandingMessage({ text: tPages('settings.branding_saved'), type: 'success' })
        await refreshSettings()
      } else {
        const data = await response.json()
        setBrandingMessage({ text: data.error || tPages('settings.branding_save_failed'), type: 'error' })
      }
    } catch (error) {
      setBrandingMessage({ text: 'Error saving company name: ' + error.message, type: 'error' })
    } finally {
      setSavingBranding(false)
    }
  }

  const handleLogoUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Validate file size
    if (file.size > 2 * 1024 * 1024) {
      setBrandingMessage({ text: tPages('settings.branding_upload_failed') + ' - File too large (max 2 MB)', type: 'error' })
      return
    }

    setSavingBranding(true)
    setBrandingMessage({ text: '', type: '' })

    try {
      const formData = new FormData()
      formData.append('logo', file)

      const response = await authFetch('/api/v1/app-settings/logo', {
        method: 'POST',
        body: formData
      })

      if (response.ok) {
        setBrandingMessage({ text: tPages('settings.branding_logo_uploaded'), type: 'success' })
        await refreshSettings()
        // Show preview of new logo
        const fileReader = new FileReader()
        fileReader.onload = (event) => {
          setBrandingLogoPreview(event.target?.result)
        }
        fileReader.readAsDataURL(file)
      } else {
        const data = await response.json()
        setBrandingMessage({ text: data.error || tPages('settings.branding_upload_failed'), type: 'error' })
      }
    } catch (error) {
      setBrandingMessage({ text: 'Error uploading logo: ' + error.message, type: 'error' })
    } finally {
      setSavingBranding(false)
      // Reset file input
      e.target.value = ''
    }
  }

  const deleteLogo = async () => {
    setSavingBranding(true)
    setBrandingMessage({ text: '', type: '' })

    try {
      const response = await authFetch('/api/v1/app-settings/logo', {
        method: 'DELETE'
      })

      if (response.ok) {
        setBrandingMessage({ text: tPages('settings.branding_logo_removed'), type: 'success' })
        setBrandingLogoPreview(null)
        await refreshSettings()
      } else {
        const data = await response.json()
        setBrandingMessage({ text: data.error || tPages('settings.branding_remove_failed'), type: 'error' })
      }
    } catch (error) {
      setBrandingMessage({ text: 'Error removing logo: ' + error.message, type: 'error' })
    } finally {
      setSavingBranding(false)
    }
  }

  useEffect(() => {
    // Sync branding state with context
    setBrandingCompanyName(companyName)
    setBrandingLogoPreview(logoUrl)
  }, [companyName, logoUrl])

  useEffect(() => {
    // Auto-scan on component mount
    scanNetworks()
    loadUserPreferences()
    loadNetworkStatus()
  }, [])

  useEffect(() => {
    if (!isSystemAdmin) {
      setRunningTestsCount(0)
      setSerialLogInfo(null)
      return
    }

    fetchSerialLogInfo()
    fetchRunningTestsCount()
    checkForUpdates()
    const runningTestsInterval = setInterval(fetchRunningTestsCount, 10000)
    return () => clearInterval(runningTestsInterval)
  }, [isSystemAdmin])

  useEffect(() => {
    return () => {
      if (updatePollRef.current) {
        clearInterval(updatePollRef.current)
        updatePollRef.current = null
      }
    }
  }, [])

  const getMessageClasses = (type) => {
    if (type === 'success') return 'bg-green-50 text-green-700 border-green-200'
    if (type === 'info') return 'bg-blue-50 text-blue-700 border-blue-200'
    return 'bg-red-50 text-red-700 border-red-200'
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">{tPages('settings.title')}</h1>
          <p className="text-sm text-gray-500">{tPages('settings.subtitle')}</p>
        </div>

        <section className="space-y-3">
          <h2 className="text-lg font-bold text-gray-900">{tCommon('preferences')}</h2>
          <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
            <div className="grid grid-cols-1 gap-4 border-b border-gray-200 px-4 py-2.5 sm:grid-cols-[1fr_auto] sm:px-5">
              <div>
                <h3 className="text-sm font-bold text-gray-900">{tPages('settings.theme')}</h3>
                <p className="mt-0.5 text-[13px] text-gray-500">{tPages('settings.theme_help')}</p>
              </div>
              <div className="flex items-center gap-1">
                {[
                  { value: 'light', icon: Sun, label: tPages('settings.theme_light') },
                  { value: 'dark', icon: Moon, label: tPages('settings.theme_dark') },
                  { value: 'system', icon: Monitor, label: tPages('settings.theme_system') },
                ].map(({ value, icon: Icon, label }) => (
                  <button
                    key={value}
                    onClick={() => handleThemeChange(value)}
                    className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                      themePreference === value
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    <Icon size={14} />
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 border-b border-gray-200 px-4 py-2.5 sm:grid-cols-[1fr_auto] sm:px-5">
              <div>
                <h3 className="text-sm font-bold text-gray-900">{tCommon('language')}</h3>
                <p className="mt-0.5 text-[13px] text-gray-500">{tPages('settings.language_help')}</p>
              </div>
              <div className="flex items-center">
                <select
                  value={language}
                  onChange={(e) => saveLanguagePreference(e.target.value)}
                  disabled={savingLanguage}
                  className="min-w-40 rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-xs text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:bg-gray-100"
                >
                  <option value="en">{tCommon('english')}</option>
                  <option value="es">{tCommon('spanish')}</option>
                  <option value="fr">{tCommon('french')}</option>
                  <option value="de">{tCommon('german')}</option>
                  <option value="zh">{tCommon('chinese')}</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 px-4 py-2.5 sm:grid-cols-[1fr_auto] sm:px-5">
              <div>
                <h3 className="text-sm font-bold text-gray-900">{tPages('settings.csv_delimiter')}</h3>
                <p className="mt-0.5 text-[13px] text-gray-500">{tPages('settings.csv_delimiter_help')}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={csvDelimiter}
                  onChange={(e) => setCsvDelimiter(e.target.value)}
                  className="rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-xs text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value=",">{tPages('settings.comma')}</option>
                  <option value=";">{tPages('settings.semicolon')}</option>
                  {/* Must be a JS expression: value="\t" would send the
                      literal two characters \ + t, which the backend rejects */}
                  <option value={'\t'}>{tPages('settings.tab')}</option>
                </select>
                <button
                  onClick={saveDelimiterPreference}
                  disabled={savingDelimiter}
                  className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-400"
                >
                  {savingDelimiter ? tPages('settings.saving') : tCommon('save')}
                </button>
              </div>
            </div>
          </div>

          {languageMessage.text && (
            <div className={`rounded-lg border px-3 py-2 text-xs ${getMessageClasses(languageMessage.type)}`}>
              {languageMessage.text}
            </div>
          )}
          {delimiterMessage.text && (
            <div className={`rounded-lg border px-3 py-2 text-xs ${getMessageClasses(delimiterMessage.type)}`}>
              {delimiterMessage.text}
            </div>
          )}
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-bold text-gray-900">{tPages('settings.network')}</h2>
          <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
            {(networkStatus?.interfaces || []).map((iface) => (
              <div key={iface.device} className="grid grid-cols-1 gap-4 border-b border-gray-200 px-4 py-2.5 last:border-b-0 sm:grid-cols-[1fr_auto] sm:px-5">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold text-gray-900">
                      {iface.type === 'ethernet' ? tPages('settings.network_ethernet') : tPages('settings.network_wifi')}
                    </h3>
                    <span className="text-[11px] text-gray-400">{iface.device}</span>
                    {isCurrentInterface(iface) && (
                      <span className="rounded-full border border-blue-200 bg-blue-100 px-2 py-0.5 text-[11px] font-semibold text-blue-700">
                        {tPages('settings.network_this_connection')}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-[13px] text-gray-500">
                    {networkStateLabel(iface.state)}
                    {iface.method && <> • {iface.method === 'manual' ? tPages('settings.network_method_static') : tPages('settings.network_method_auto')}</>}
                    {iface.gateway && <> • {tPages('settings.network_gateway')}: {iface.gateway}</>}
                  </p>
                </div>
                <div className="flex flex-col items-start justify-center sm:items-end">
                  {(iface.addresses || []).map((addr) => (
                    <span key={addr} className="font-mono text-xs text-gray-700">{addr}</span>
                  ))}
                </div>
              </div>
            ))}
            {!networkStatus?.interfaces?.length && (
              <div className="px-5 py-4 text-sm text-gray-500">{tPages('settings.network_no_data')}</div>
            )}

            {isSystemAdmin && (
              <div className="border-t border-gray-200 bg-gray-50/60 px-4 py-3 sm:px-5">
                <h3 className="text-sm font-bold text-gray-900">{tPages('settings.network_ethernet_config')}</h3>
                <p className="mt-0.5 text-[13px] text-gray-500">
                  {tPages('settings.network_rescue_note', {
                    address: (networkStatus?.rescue_address || '169.254.50.1/16').split('/')[0]
                  })}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <select
                    value={ethForm.mode}
                    onChange={(e) => setEthForm(prev => ({ ...prev, mode: e.target.value }))}
                    className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="dhcp">{tPages('settings.network_method_auto')}</option>
                    <option value="static">{tPages('settings.network_method_static')}</option>
                  </select>
                  {ethForm.mode === 'static' && (
                    <>
                      <input
                        type="text"
                        value={ethForm.address}
                        onChange={(e) => setEthForm(prev => ({ ...prev, address: e.target.value }))}
                        placeholder={tPages('settings.network_ip_address')}
                        className="w-36 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 font-mono text-xs text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <input
                        type="number"
                        min="1"
                        max="32"
                        value={ethForm.prefix}
                        onChange={(e) => setEthForm(prev => ({ ...prev, prefix: e.target.value }))}
                        placeholder={tPages('settings.network_prefix')}
                        title={tPages('settings.network_prefix')}
                        className="w-20 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 font-mono text-xs text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <input
                        type="text"
                        value={ethForm.gateway}
                        onChange={(e) => setEthForm(prev => ({ ...prev, gateway: e.target.value }))}
                        placeholder={tPages('settings.network_gateway_optional')}
                        className="w-40 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 font-mono text-xs text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <input
                        type="text"
                        value={ethForm.dns}
                        onChange={(e) => setEthForm(prev => ({ ...prev, dns: e.target.value }))}
                        placeholder={tPages('settings.network_dns_optional')}
                        className="w-56 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 font-mono text-xs text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </>
                  )}
                  <button
                    onClick={applyEthernetConfig}
                    disabled={applyingNetwork || (ethForm.mode === 'static' && !ethForm.address.trim())}
                    className="flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-400"
                  >
                    {applyingNetwork && <Loader2 size={14} className="animate-spin" />}
                    {tPages('settings.network_apply')}
                  </button>
                  <button
                    onClick={resetEthernetConfig}
                    disabled={applyingNetwork}
                    className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:text-gray-400"
                  >
                    {tPages('settings.network_reset')}
                  </button>
                </div>
                {networkMessage.text && (
                  <div className={`mt-2 rounded-lg border px-3 py-2 text-xs ${getMessageClasses(networkMessage.type)}`}>
                    {networkMessage.text}
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-bold text-gray-900">{tPages('settings.wifi')}</h2>
          <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
            <div className="grid grid-cols-1 gap-4 border-b border-gray-200 px-4 py-2.5 sm:grid-cols-[1fr_auto] sm:px-5">
              <div>
                <h3 className="text-sm font-bold text-gray-900">{tPages('settings.available_networks')}</h3>
                <p className="mt-0.5 text-[13px] text-gray-500">{tPages('settings.scan_connect_networks')}</p>
              </div>
              <div className="flex items-center">
                <button
                  onClick={scanNetworks}
                  disabled={loading}
                  className="flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-400"
                >
                  {loading ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
                  {loading ? tPages('settings.scanning') : tPages('settings.scan_networks')}
                </button>
              </div>
            </div>

            <div className="max-h-96 overflow-y-auto">
              {loading ? (
                <div className="flex items-center gap-2 px-5 py-4 text-sm text-gray-500">
                  <Loader2 size={14} className="animate-spin" />
                  {tPages('settings.scanning_for_networks')}
                </div>
              ) : networks.length === 0 ? (
                <div className="px-5 py-4 text-sm text-gray-500">{tPages('settings.no_networks')}</div>
              ) : (
                networks.map((network, index) => {
                  const isSelected = selectedNetworkIndex === index
                  const isConnected = Boolean(network.connected)
                  const needsPassword = network.security !== 'None' && network.security !== 'Open' && network.security !== ''
                  const isEnterprise = network.security && network.security.includes('802.1X')

                  return (
                    <div key={index} className="border-b border-gray-200 last:border-b-0">
                      <div
                        className={`grid cursor-pointer grid-cols-1 gap-4 px-4 py-2.5 transition-colors sm:grid-cols-[1fr_auto] sm:px-5 ${isSelected ? 'bg-blue-50/60' : 'hover:bg-gray-50'} ${isConnected ? 'bg-green-50/40' : ''}`}
                        onClick={() => handleNetworkSelect(network, index)}
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            {getSignalIcon(network.signal)}
                            <span className="text-sm font-bold text-gray-900">{network.ssid}</span>
                            {isConnected && (
                              <span className="rounded-full border border-green-200 bg-green-100 px-2 py-0.5 text-[11px] font-semibold text-green-700">
                                {tPages('settings.connected_badge')}
                              </span>
                            )}
                            {needsPassword && <Lock size={14} className="text-gray-400" />}
                          </div>
                          <p className="mt-0.5 text-[13px] text-gray-500">
                            {tPages('settings.signal')}: <span className={getSignalColor(network.signal)}>{getSignalStrength(network.signal)}</span> ({network.signal}) • {network.security}
                          </p>
                        </div>
                        <div className="flex items-center">
                          <button
                            className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-400"
                            onClick={(e) => {
                              e.stopPropagation()
                              if (isConnected) return
                              handleNetworkSelect(network, index)
                            }}
                            disabled={isConnected || (connecting && connectingSsid === network.ssid)}
                          >
                            {isConnected
                              ? tPages('settings.connected_badge')
                              : connecting && connectingSsid === network.ssid
                                ? tPages('settings.connecting')
                                : isSelected
                                  ? tPages('settings.hide')
                                  : tPages('settings.connect')}
                          </button>
                        </div>
                      </div>

                      {isSelected && needsPassword && (
                        <div className="border-t border-blue-100 bg-blue-50/60 px-4 py-2.5 sm:px-5">
                          <form onSubmit={(e) => handleConnectWithPassword(e, network)} className="space-y-3">
                            {isEnterprise && (
                              <div>
                                <label className="mb-1 block text-sm font-medium text-gray-700">
                                  Username
                                </label>
                                <input
                                  type="text"
                                  value={username}
                                  onChange={(e) => setUsername(e.target.value)}
                                  className="w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                                  placeholder="Enter username"
                                  autoFocus
                                  required
                                  onClick={(e) => e.stopPropagation()}
                                />
                              </div>
                            )}
                            <div>
                              <label className="mb-1 block text-sm font-medium text-gray-700">
                                {tPages('settings.password')}
                              </label>
                              <input
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                                placeholder={tPages('settings.enter_password')}
                                autoFocus={!isEnterprise}
                                required
                                onClick={(e) => e.stopPropagation()}
                              />
                            </div>
                            <div className="flex flex-wrap justify-end gap-2">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleCancelConnect()
                                }}
                                className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                                disabled={connecting}
                              >
                                {tPages('settings.cancel')}
                              </button>
                              <button
                                type="submit"
                                className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-400"
                                disabled={connecting || !password || (isEnterprise && !username)}
                                onClick={(e) => e.stopPropagation()}
                              >
                                {connecting ? tPages('settings.connecting') : tPages('settings.connect')}
                              </button>
                            </div>
                          </form>
                        </div>
                      )}
                    </div>
                  )
                })
              )}
            </div>
          </div>

          {message.text && (
            <div className={`rounded-lg border px-3 py-2 text-xs ${getMessageClasses(message.type)}`}>
              {message.text}
            </div>
          )}
        </section>

        {isSystemAdmin && (
        <section className="space-y-3">
          <h2 className="text-lg font-bold text-gray-900">{tPages('settings.system_tools')}</h2>
          <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
            <div className="grid grid-cols-1 gap-4 border-b border-gray-200 px-4 py-2.5 sm:grid-cols-[1fr_auto] sm:px-5">
              <div>
                <h3 className="text-sm font-bold text-gray-900">{tPages('settings.update_software')}</h3>
                <p className="mt-0.5 text-[13px] text-gray-500">{tPages('settings.reboot_after_update')}</p>
                {checkingUpdate ? (
                  <p className="mt-1 text-[12px] text-gray-500">{tPages('settings.checking_updates')}</p>
                ) : updateCheck?.update_available === true ? (
                  <p className="mt-1 text-[12px] font-medium text-emerald-600">
                    {tPages('settings.update_available', {
                      current: updateCheck.current_commit?.slice(0, 7),
                      latest: updateCheck.remote_commit?.slice(0, 7)
                    })}
                  </p>
                ) : updateCheck?.update_available === false ? (
                  <p className="mt-1 text-[12px] text-gray-500">
                    {tPages('settings.update_up_to_date', { version: updateCheck.current_commit?.slice(0, 7) })}
                  </p>
                ) : updateCheck?.error ? (
                  <p className="mt-1 text-[12px] text-amber-600">{tPages('settings.update_check_error')}</p>
                ) : null}
                {runningTestsCount > 0 && (
                  <p className="mt-1 text-[12px] text-amber-600">
                    {tPages('settings.update_disabled_running', { count: runningTestsCount })}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={checkForUpdates}
                  disabled={checkingUpdate || pulling}
                  className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:text-gray-400"
                >
                  {checkingUpdate ? tPages('settings.checking_updates') : tPages('settings.check_updates')}
                </button>
                <button
                  onClick={pullFromGithub}
                  disabled={pulling || runningTestsCount > 0 || checkingUpdate || updateCheck?.update_available === false}
                  className="flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-gray-400"
                >
                  {pulling && <Loader2 size={14} className="animate-spin" />}
                  {pulling ? tPages('settings.updating') : tPages('settings.update')}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 border-b border-gray-200 px-4 py-2.5 sm:grid-cols-[1fr_auto] sm:px-5">
              <div>
                <h3 className="text-sm font-bold text-gray-900">{tPages('settings.serial_log')}</h3>
                <p className="mt-0.5 text-[13px] text-gray-500">
                  {tPages('settings.download_all_serial')}
                  {serialLogInfo?.exists && (
                    <span className="ml-1">({serialLogInfo.size_formatted})</span>
                  )}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={clearSerialLog}
                  disabled={clearingLog || !serialLogInfo?.exists}
                  className="flex items-center gap-2 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-gray-400"
                >
                  <Trash2 size={14} />
                  {clearingLog ? tPages('settings.clearing') : tPages('settings.clear_log')}
                </button>
                <button
                  onClick={downloadSerialLog}
                  disabled={downloadingLog || !serialLogInfo?.exists}
                  className="flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-400"
                >
                  <Download size={14} />
                  {downloadingLog ? tPages('settings.downloading') : tPages('settings.download_serial_log')}
                </button>
              </div>
            </div>

            {canPerform('manage_database') && (
              <>
                <div className="grid grid-cols-1 gap-4 border-b border-gray-200 px-4 py-2.5 sm:grid-cols-[1fr_auto] sm:px-5">
                  <div>
                    <h3 className="text-sm font-bold text-gray-900">{tPages('settings.database_download_title')}</h3>
                    <p className="mt-0.5 text-[13px] text-gray-500">{tPages('settings.database_download_help')}</p>
                  </div>
                  <div className="flex items-center">
                    <button
                      onClick={downloadDatabase}
                      disabled={downloadingDb}
                      className="flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-400"
                    >
                      <Download size={14} />
                      {downloadingDb ? tPages('settings.database_downloading') : tPages('settings.database_download_button')}
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 border-b border-gray-200 px-4 py-2.5 sm:grid-cols-[1fr_auto] sm:px-5">
                  <div>
                    <h3 className="text-sm font-bold text-gray-900">{tPages('settings.database_transfer_title')}</h3>
                    <p className="mt-0.5 text-[13px] text-gray-500">
                      {tPages('settings.database_transfer_help')}
                      {databaseFile && <span className="ml-1">({databaseFile.name})</span>}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-gray-300 bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-200">
                      <Upload size={14} />
                      {tPages('settings.database_transfer_choose')}
                      <input
                        type="file"
                        accept=".sqlite,.db"
                        onChange={handleDatabaseFileChange}
                        className="hidden"
                      />
                    </label>
                    <button
                      onClick={transferDatabase}
                      disabled={transferringDb || !databaseFile}
                      className="flex items-center gap-2 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-amber-600 disabled:cursor-not-allowed disabled:bg-gray-400"
                    >
                      {transferringDb ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                      {transferringDb ? tPages('settings.database_transferring') : tPages('settings.database_transfer_button')}
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 rounded-b-2xl border-t border-red-200 bg-red-50/30 px-4 py-2.5 sm:grid-cols-[1fr_auto] sm:px-5">
                  <div>
                    <h3 className="text-sm font-bold text-red-600">{tPages('settings.database_delete_title')}</h3>
                    <p className="mt-0.5 text-[13px] text-gray-500">{tPages('settings.database_delete_help')}</p>
                  </div>
                  <div className="flex items-center">
                    <button
                      onClick={deleteDatabase}
                      disabled={deletingDb}
                      className="flex items-center gap-2 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-gray-400"
                    >
                      <Trash2 size={14} />
                      {deletingDb ? tPages('settings.database_deleting') : tPages('settings.database_delete_button')}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>

          {pullMessage.text && (
            <div className={`rounded-lg border px-3 py-2 text-xs ${getMessageClasses(pullMessage.type)}`}>
              <pre className="whitespace-pre-wrap">{pullMessage.text}</pre>
            </div>
          )}
          {serialLogMessage.text && (
            <div className={`rounded-lg border px-3 py-2 text-xs ${getMessageClasses(serialLogMessage.type)}`}>
              {serialLogMessage.text}
            </div>
          )}
          {databaseMessage.text && (
            <div className={`rounded-lg border px-3 py-2 text-xs ${getMessageClasses(databaseMessage.type)}`}>
              {databaseMessage.text}
            </div>
          )}
        </section>
        )}

        {canPerform('system_settings') && (
          <section className="space-y-3">
            <h2 className="text-lg font-bold text-gray-900">{tPages('settings.branding_title')}</h2>
            <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
              <div className="grid grid-cols-1 gap-4 border-b border-gray-200 px-4 py-2.5 sm:grid-cols-[1fr_auto] sm:px-5">
                <div>
                  <h3 className="text-sm font-bold text-gray-900">{tPages('settings.branding_company_name')}</h3>
                  <p className="mt-0.5 text-[13px] text-gray-500">{tPages('settings.branding_company_help')}</p>
                </div>
                <div className="flex w-full max-w-sm flex-wrap items-center gap-2">
                  <input
                    type="text"
                    value={brandingCompanyName}
                    onChange={(e) => setBrandingCompanyName(e.target.value)}
                    className="min-w-56 flex-1 rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder={tPages('settings.branding_company_placeholder')}
                  />
                  <button
                    onClick={saveCompanyName}
                    disabled={savingBranding || brandingCompanyName === companyName}
                    className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-400"
                  >
                    {savingBranding ? <Loader2 size={14} className="animate-spin" /> : tPages('settings.branding_save')}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 px-4 py-2.5 sm:grid-cols-[1fr_auto] sm:px-5">
                <div>
                  <h3 className="text-sm font-bold text-gray-900">{tPages('settings.branding_logo')}</h3>
                  <p className="mt-0.5 text-[13px] text-gray-500">{tPages('settings.branding_logo_help')}</p>
                </div>
                <div className="grid w-full max-w-sm grid-cols-1 gap-3 sm:grid-cols-[1fr_auto]">
                  <div className="flex h-24 items-center justify-center rounded-lg border border-dashed border-gray-300 bg-gray-50 px-3">
                    {brandingLogoPreview ? (
                      <img
                        src={brandingLogoPreview}
                        alt="Logo preview"
                        className="max-h-16 max-w-full object-contain"
                      />
                    ) : (
                      <span className="text-sm text-gray-400">{tPages('settings.branding_no_logo')}</span>
                    )}
                  </div>
                  <div className="flex flex-col gap-2">
                    <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-400">
                      <Upload size={14} />
                      <span>{tPages('settings.branding_upload_logo')}</span>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleLogoUpload}
                        disabled={savingBranding}
                        className="hidden"
                      />
                    </label>
                    {brandingLogoPreview && (
                      <button
                        onClick={deleteLogo}
                        disabled={savingBranding}
                        className="flex items-center justify-center gap-2 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-gray-400"
                      >
                        <X size={14} />
                        <span>{tPages('settings.branding_remove_logo')}</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {brandingMessage.text && (
              <div className={`rounded-lg border px-3 py-2 text-xs ${getMessageClasses(brandingMessage.type)}`}>
                {brandingMessage.text}
              </div>
            )}
          </section>
        )}

        {passwordPrompt.open && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
              <div className="mb-4 flex items-center gap-3">
                <span className="rounded-lg bg-amber-50 p-2 text-amber-600">
                  <ShieldAlert size={20} />
                </span>
                <div>
                  <h3 className="text-base font-bold text-gray-900">
                    {tPages('settings.database_password_title')}
                  </h3>
                  <p className="mt-0.5 text-sm text-gray-500">
                    {passwordPrompt.message || tPages('settings.database_password_prompt')}
                  </p>
                </div>
              </div>
              <div>
                <input
                  type="password"
                  value={passwordPrompt.password}
                  onChange={(e) => setPasswordPrompt((prev) => ({ ...prev, password: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      verifyPassword()
                    }
                  }}
                  className="w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder={tPages('settings.password')}
                  autoFocus
                />
                {passwordPrompt.error && (
                  <p className="mt-2 text-sm text-red-600">{passwordPrompt.error}</p>
                )}
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <button
                  onClick={() => resolvePasswordPrompt(false)}
                  className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                  disabled={passwordPrompt.loading}
                >
                  {tCommon('cancel')}
                </button>
                <button
                  onClick={verifyPassword}
                  disabled={passwordPrompt.loading}
                  className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:bg-gray-400"
                >
                  {passwordPrompt.loading
                    ? tPages('settings.database_password_verifying')
                    : tPages('settings.database_password_confirm')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
  )
}

export default Settings
