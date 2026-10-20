import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '../components/AuthContext'
import { Upload, Loader2, AlertTriangle } from 'lucide-react'

const API = '/api/v1/plc'

//
// Flash new firmware onto the PLC, with the tool its platform needs - the
// backend tells the two apart when the PLC connects:
//
//   - M-Duino (avr): the board cannot update itself, so the server runs
//     avrdude against its USB port. Takes a .hex.
//   - ESP32: the PLC takes a .bin over the link it is already attached by -
//     USB, RS232 or the network - and only switches to it once it verifies.
//     The firmware bundled with this release can be flashed without an upload.
//
// Progress follows over SSE either way.
//
export default function PlcFirmware({ deviceId, deviceName, requirePassword }) {
  const { authFetch } = useAuth()

  const [check, setCheck] = useState(null)
  const [file, setFile] = useState(null)
  const [updating, setUpdating] = useState(false)
  const [progress, setProgress] = useState(null)   // { phase, percent }
  const [message, setMessage] = useState(null)      // { text, type }
  const streamRef = useRef(null)

  const isEsp32 = check?.platform === 'esp32'
  const extension = isEsp32 ? '.bin' : '.hex'

  const runCheck = useCallback(async () => {
    if (!deviceId) return
    try {
      const res = await authFetch(`${API}/${deviceId}/firmware_check`)
      setCheck(res.ok ? await res.json() : null)
    } catch { setCheck(null) }
  }, [deviceId, authFetch])

  useEffect(() => { setFile(null); setMessage(null); runCheck() }, [runCheck])

  const closeStream = () => {
    if (streamRef.current) { streamRef.current.close(); streamRef.current = null }
  }
  useEffect(() => closeStream, [])

  const onFile = (e) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    if (!f.name.toLowerCase().endsWith(extension)) {
      setMessage({
        text: isEsp32 ? 'This is an ESP32 PLC - firmware must be a .bin file'
                      : 'This is an M-Duino PLC - firmware must be a .hex file',
        type: 'error',
      })
      return
    }
    setFile(f)
    setMessage(null)
  }

  // An ESP32 PLC can take the bundled image without an upload; the M-Duino
  // always needs a chosen file here.
  const useBundled = isEsp32 && !file && check?.update_available === true
  const canStart = !updating && (file || useBundled)

  const startUpdate = async () => {
    if (!canStart || !deviceId) return

    const what = file ? file.name : 'the bundled firmware'
    const confirmed = await requirePassword(
      isEsp32
        ? `Send ${what} to ${deviceName || 'this PLC'}? Its outputs switch off while the image transfers (about two minutes), then it restarts into the new firmware.`
        : `Flash ${what} onto ${deviceName || 'this PLC'}? The machine stops while it is reprogrammed.`
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

      let res
      if (file) {
        const body = new FormData()
        body.append('firmware', file)
        res = await authFetch(`${API}/${deviceId}/firmware_update`, { method: 'POST', body })
      } else {
        res = await authFetch(`${API}/${deviceId}/firmware_update_bundled`, { method: 'POST' })
      }
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

  const avrdudeMissing = check && !isEsp32 && !check.avrdude_available
  const avrOverNetwork = check && !isEsp32 && check.transport === 'network'

  const platformLabel = !check ? null
    : isEsp32 ? `ESP32 PLC, connected over ${check.transport === 'network' ? 'WiFi' : check.transport.toUpperCase()}`
    : check.platform === 'avr' ? 'M-Duino PLC'
    : 'PLC type not identified - treated as M-Duino'

  return (
    <div className="grid grid-cols-1 gap-4 py-4 sm:grid-cols-[1fr_auto]">
      <div>
        <h3 className="text-sm font-medium text-gray-900 dark:text-white">Firmware</h3>
        <p className="mt-0.5 text-[13px] text-gray-500 dark:text-slate-400">
          {isEsp32
            ? 'Send new firmware to the PLC over its existing connection. It is checked before the PLC switches to it, so a failed transfer leaves the current firmware running.'
            : 'Reprogram the PLC over its USB connection. The machine stops for the duration and comes back once flashing completes.'}
        </p>
        {platformLabel && (
          <p className="mt-1 text-[12px] text-gray-500 dark:text-slate-400">{platformLabel}</p>
        )}

        {isEsp32 && !updating && (
          check.update_available === true ? (
            <p className="mt-1 text-[12px] text-emerald-600">
              Bundled firmware differs from the PLC's ({check.device_hash?.slice(0, 12)} → {check.bundled_hash?.slice(0, 12)}).
            </p>
          ) : check.update_available === false ? (
            <p className="mt-1 text-[12px] text-gray-500">
              Running the bundled firmware ({check.device_hash?.slice(0, 12)}).
            </p>
          ) : check.reason === 'no_bundled' ? (
            <p className="mt-1 text-[12px] text-gray-500">No ESP32 firmware is bundled with this release - upload a .bin.</p>
          ) : check.reason === 'invalid_bundle' ? (
            <p className="mt-1 text-[12px] text-amber-600">The bundled ESP32 firmware is damaged - upload a .bin.</p>
          ) : null
        )}
      </div>

      {avrdudeMissing || avrOverNetwork ? (
        <div className="flex max-w-sm items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          {avrOverNetwork ? (
            <span>An M-Duino PLC can only be flashed over USB.</span>
          ) : (
            <span>
              avrdude is not installed on the server, so firmware cannot be flashed.
              Install it (on the Pi: <code>sudo apt install avrdude</code>) and reload.
            </span>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200">
            <Upload size={14} />
            {file ? file.name : `Choose ${extension}…`}
            <input type="file" accept={extension} className="hidden" onChange={onFile} disabled={updating || !check} />
          </label>

          <button
            onClick={startUpdate}
            disabled={!canStart}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-400"
          >
            {updating && <Loader2 size={14} className="animate-spin" />}
            {useBundled ? 'Install bundled firmware' : 'Update firmware'}
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
