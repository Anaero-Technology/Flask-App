import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '../components/AuthContext'
import { Upload, Loader2, AlertTriangle } from 'lucide-react'

const API = '/api/v1/plc'

//
// Flash new firmware onto the PLC. The board cannot update itself, so the
// server runs avrdude against its serial port; this uploads a .hex and follows
// progress over SSE. Upload only - the bundled firmware is not offered here.
//
export default function PlcFirmware({ deviceId, deviceName, requirePassword }) {
  const { authFetch } = useAuth()

  const [check, setCheck] = useState(null)
  const [file, setFile] = useState(null)
  const [updating, setUpdating] = useState(false)
  const [progress, setProgress] = useState(null)   // { phase, percent }
  const [message, setMessage] = useState(null)      // { text, type }
  const streamRef = useRef(null)

  const runCheck = useCallback(async () => {
    if (!deviceId) return
    try {
      const res = await authFetch(`${API}/${deviceId}/firmware_check`)
      setCheck(res.ok ? await res.json() : null)
    } catch { setCheck(null) }
  }, [deviceId, authFetch])

  useEffect(() => { runCheck() }, [runCheck])

  const closeStream = () => {
    if (streamRef.current) { streamRef.current.close(); streamRef.current = null }
  }
  useEffect(() => closeStream, [])

  const onFile = (e) => {
    const f = e.target.files?.[0]
    if (!f) return
    if (!f.name.toLowerCase().endsWith('.hex')) {
      setMessage({ text: 'Firmware must be a .hex file', type: 'error' })
      return
    }
    setFile(f)
    setMessage(null)
  }

  const startUpdate = async () => {
    if (updating || !deviceId || !file) return

    const confirmed = await requirePassword(
      `Flash ${file.name} onto ${deviceName || 'this PLC'}? The machine stops while it is reprogrammed.`
    )
    if (!confirmed) return

    setUpdating(true)
    setProgress({ phase: 'starting', percent: 0 })
    setMessage(null)

    try {
      // Open the SSE stream before starting so no events are missed. It authes
      // with a short-lived ?token= since EventSource can't send headers.
      let url = `${API}/${deviceId}/stream`
      try {
        const t = await authFetch('/api/v1/auth/stream-token')
        if (t.ok) url += `?token=${encodeURIComponent((await t.json()).stream_token)}`
      } catch { /* stream still works without the token attempt */ }

      const es = new EventSource(url)
      streamRef.current = es

      es.addEventListener('plc_firmware_progress', (ev) => {
        const d = JSON.parse(ev.data)
        if (d.device_id === deviceId) setProgress({ phase: d.phase, percent: d.percent })
      })
      es.addEventListener('plc_firmware_complete', (ev) => {
        const d = JSON.parse(ev.data)
        if (d.device_id !== deviceId) return
        closeStream()
        setUpdating(false)
        setProgress(null)
        setMessage({
          text: d.success && !d.reconnected ? `${d.message}. Reconnecting…` : d.message,
          type: d.success ? 'success' : 'error',
        })
        if (d.success) setFile(null)
        runCheck()
      })

      const body = new FormData()
      body.append('firmware', file)
      const res = await authFetch(`${API}/${deviceId}/firmware_update`, { method: 'POST', body })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        closeStream()
        setUpdating(false)
        setProgress(null)
        setMessage({ text: err.error || 'Could not start the update', type: 'error' })
      }
    } catch (e) {
      closeStream()
      setUpdating(false)
      setProgress(null)
      setMessage({ text: `Could not start the update: ${e.message}`, type: 'error' })
    }
  }

  const avrdudeMissing = check && !check.avrdude_available

  return (
    <div className="grid grid-cols-1 gap-4 py-4 sm:grid-cols-[1fr_auto]">
      <div>
        <h3 className="text-sm font-medium text-gray-900 dark:text-white">Firmware</h3>
        <p className="mt-0.5 text-[13px] text-gray-500 dark:text-slate-400">
          Reprogram the PLC over its serial connection. The machine stops for the
          duration and comes back once flashing completes.
        </p>
      </div>

      {avrdudeMissing ? (
        <div className="flex max-w-sm items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>
            avrdude is not installed on the server, so firmware cannot be flashed.
            Install it (on the Pi: <code>sudo apt install avrdude</code>) and reload.
          </span>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200">
            <Upload size={14} />
            {file ? file.name : 'Choose .hex…'}
            <input type="file" accept=".hex" className="hidden" onChange={onFile} disabled={updating} />
          </label>

          <button
            onClick={startUpdate}
            disabled={updating || !file}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-400"
          >
            {updating && <Loader2 size={14} className="animate-spin" />}
            Update firmware
          </button>
        </div>
      )}

      {progress && (
        <div className="sm:col-span-2">
          <div className="mb-1 flex justify-between text-xs text-gray-500 dark:text-slate-400">
            <span className="capitalize">{progress.phase}…</span>
            <span>{progress.percent}%</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-slate-700">
            <div className="h-full bg-blue-500 transition-all" style={{ width: `${progress.percent}%` }} />
          </div>
          <p className="mt-1 text-xs text-gray-400 dark:text-slate-500">
            Don't disconnect the PLC while it is being flashed.
          </p>
        </div>
      )}

      {message && (
        <div className={`sm:col-span-2 rounded-lg border px-3 py-2 text-xs ${
          message.type === 'success'
            ? 'border-green-300 bg-green-50 text-green-800 dark:border-green-700 dark:bg-green-950 dark:text-green-200'
            : 'border-red-300 bg-red-50 text-red-800 dark:border-red-700 dark:bg-red-950 dark:text-red-200'
        }`}>
          {message.text}
        </div>
      )}
    </div>
  )
}
