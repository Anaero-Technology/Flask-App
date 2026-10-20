import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../components/AuthContext'
import { useToast } from '../components/Toast'
import { Loader2, Wifi, WifiOff } from 'lucide-react'

const API = '/api/v1/plc'

const inputClass =
  'rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-xs text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200'
const buttonClass =
  'flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50'

const WIFI_LABEL = { off: 'Off', connecting: 'Joining…', connected: 'Connected' }
const LINK_LABEL = { off: 'Not set up', down: 'Waiting to connect', connecting: 'Connecting…', up: 'Connected' }

//
// Remote control of an ESP32 PLC. Given a WiFi network and this server's
// address, the PLC calls in to the server's PLC listener and is then controlled
// over WiFi exactly as over USB - it shows up as a connected PLC on its own.
//
// "Use this Pi's WiFi" hands the PLC the network the server is on, password
// included, read on the server - it never passes through the browser.
//
export default function PlcNetwork({ deviceId, deviceName, requirePassword }) {
  const { authFetch } = useAuth()
  const toast = useToast()

  const [state, setState] = useState(null)
  const [busy, setBusy] = useState(false)
  const [manual, setManual] = useState(false)
  const [ssid, setSsid] = useState('')
  const [password, setPassword] = useState('')

  const load = useCallback(async () => {
    if (!deviceId) return
    try {
      const res = await authFetch(`${API}/${deviceId}/network`)
      setState(res.ok ? await res.json() : null)
    } catch { setState(null) }
  }, [deviceId, authFetch])

  // Polled, so a PLC joining the network can be watched coming up
  useEffect(() => {
    load()
    const timer = setInterval(load, 5000)
    return () => clearInterval(timer)
  }, [load])

  const overNetwork = state?.transport === 'network'
  const dropWarning = overNetwork
    ? ' This PLC is controlled over WiFi right now, so it will drop off until it reaches the new network.'
    : ''

  const configure = async (body, description) => {
    const confirmed = await requirePassword(
      `Put ${deviceName || 'this PLC'} on ${description}?${dropWarning}`
    )
    if (!confirmed) return

    setBusy(true)
    try {
      const res = await authFetch(`${API}/${deviceId}/network`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.success !== false) {
        toast.success(data.message || 'Network settings sent')
        setManual(false)
        setPassword('')
      } else {
        toast.error(data.message || data.error || 'Could not set the network')
      }
    } catch {
      toast.error('Could not set the network')
    } finally {
      setBusy(false)
      load()
    }
  }

  const forget = async () => {
    const confirmed = await requirePassword(
      `Remove the WiFi settings from ${deviceName || 'this PLC'}?${dropWarning}`
    )
    if (!confirmed) return

    setBusy(true)
    try {
      const res = await authFetch(`${API}/${deviceId}/network`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.success !== false) toast.success('Network settings removed')
      else toast.error(data.message || data.error || 'Could not remove the network settings')
    } catch {
      toast.error('Could not remove the network settings')
    } finally {
      setBusy(false)
      load()
    }
  }

  if (!state) return null

  if (!state.supported) {
    return (
      <div className="py-4">
        <h3 className="text-sm font-medium text-gray-900 dark:text-white">Remote control</h3>
        <p className="mt-0.5 text-[13px] text-gray-500 dark:text-slate-400">
          {state.platform === 'avr'
            ? 'M-Duino PLCs have no WiFi - remote control needs the ESP32 PLC.'
            : 'This PLC did not identify itself, so network support is not offered.'}
        </p>
      </div>
    )
  }

  const net = state.network
  const linkUp = net?.link === 'up'

  return (
    <div className="grid grid-cols-1 gap-4 py-4 sm:grid-cols-[1fr_auto]">
      <div>
        <h3 className="text-sm font-medium text-gray-900 dark:text-white">Remote control</h3>
        <p className="mt-0.5 text-[13px] text-gray-500 dark:text-slate-400">
          Put the PLC on WiFi so this server can control it without a cable. It
          connects to this server by itself and keeps doing so after restarts.
        </p>

        {net ? (
          <div className="mt-2 space-y-0.5 text-[12px] text-gray-600 dark:text-slate-300">
            <p className="flex items-center gap-1.5">
              {net.wifi === 'connected'
                ? <Wifi size={13} className="text-emerald-600" />
                : <WifiOff size={13} className="text-gray-400" />}
              WiFi: {WIFI_LABEL[net.wifi] ?? net.wifi}
              {net.ssid && <> on <span className="font-medium">{net.ssid}</span></>}
              {net.ip && <> as {net.ip} ({net.rssi} dBm)</>}
            </p>
            <p className={linkUp ? 'text-emerald-600' : ''}>
              Link to server: {LINK_LABEL[net.link] ?? net.link}
              {net.host && <> ({net.host}:{net.port})</>}
            </p>
            {overNetwork && (
              <p className="text-gray-500 dark:text-slate-400">You are controlling this PLC over WiFi.</p>
            )}
          </div>
        ) : (
          <p className="mt-2 text-[12px] text-amber-600">Could not read the PLC's network state.</p>
        )}

        {manual && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input className={inputClass} placeholder="Network name" value={ssid}
                   onChange={(e) => setSsid(e.target.value)} maxLength={32} autoComplete="off" />
            <input className={inputClass} placeholder="Password" type="password" value={password}
                   onChange={(e) => setPassword(e.target.value)} maxLength={63} autoComplete="new-password" />
            <button
              onClick={() => configure({ ssid: ssid.trim(), password }, ssid.trim())}
              disabled={busy || !ssid.trim()}
              className={`${buttonClass} bg-blue-600 text-white hover:bg-blue-700`}
            >
              Join
            </button>
            <p className="w-full text-[11px] text-gray-400 dark:text-slate-500">
              Names and passwords cannot contain spaces. The PLC must be able to reach this server on that network.
            </p>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-start gap-2">
        <button
          onClick={() => configure({ use_pi_wifi: true }, state.pi_wifi ? `this server's WiFi (${state.pi_wifi})` : "this server's WiFi")}
          disabled={busy || !state.pi_wifi}
          title={state.pi_wifi ? '' : 'This server is not on WiFi'}
          className={`${buttonClass} bg-blue-600 text-white hover:bg-blue-700`}
        >
          {busy && <Loader2 size={14} className="animate-spin" />}
          Use this Pi's WiFi
        </button>
        <button
          onClick={() => setManual((m) => !m)}
          disabled={busy}
          className={`${buttonClass} border border-gray-300 bg-white text-gray-700 hover:bg-gray-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200`}
        >
          Other network…
        </button>
        {net && net.wifi !== 'off' && (
          <button
            onClick={forget}
            disabled={busy}
            className={`${buttonClass} border border-red-300 bg-white text-red-700 hover:bg-red-50 dark:border-red-800 dark:bg-slate-800 dark:text-red-300`}
          >
            Forget network
          </button>
        )}
      </div>
    </div>
  )
}
