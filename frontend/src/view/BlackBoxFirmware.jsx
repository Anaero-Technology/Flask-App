import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../components/AuthContext'
import { Upload, Loader2 } from 'lucide-react'

const API = '/api/v1/black_box'

//
// Flash new firmware onto a black box logger's ESP32 over the serial link.
// Mirrors the chimera flow rather than the PLC one: the logger updates itself
// (no avrdude), and a bundled image ships with the app, so this offers both a
// one-click "update to the bundled build" and an explicit .bin upload.
//
// The device must be running firmware that implements startUpdate/firmwareHash;
// older builds report no hash, which surfaces as the "unknown version" note.
//
export default function BlackBoxFirmware({ requirePassword }) {
  const { t: tPages } = useTranslation('pages')
  const { authFetch } = useAuth()

  const [devices, setDevices] = useState([])
  const [deviceId, setDeviceId] = useState(null)
  const [check, setCheck] = useState(null)
  const [checking, setChecking] = useState(false)
  const [file, setFile] = useState(null)
  const [updating, setUpdating] = useState(false)
  const [progress, setProgress] = useState(null)   // { phase, percent, sent, total }
  const [message, setMessage] = useState(null)     // { text, type }
  const streamRef = useRef(null)

  const loadDevices = useCallback(async () => {
    try {
      const res = await authFetch(`${API}/connected`)
      if (!res.ok) return
      const list = await res.json()
      setDevices(list)
      setDeviceId(prev =>
        list.some(d => d.device_id === prev) ? prev : (list[0]?.device_id ?? null)
      )
    } catch {
      // Ignore - the section just shows "no loggers connected"
    }
  }, [authFetch])

  useEffect(() => { loadDevices() }, [loadDevices])

  const runCheck = useCallback(async (id) => {
    if (!id) {
      setCheck(null)
      return
    }
    setChecking(true)
    try {
      const res = await authFetch(`${API}/${id}/firmware_check`)
      setCheck(res.ok ? await res.json() : null)
    } catch {
      setCheck(null)
    } finally {
      setChecking(false)
    }
  }, [authFetch])

  useEffect(() => { runCheck(deviceId) }, [deviceId, runCheck])

  const closeStream = () => {
    if (streamRef.current) { streamRef.current.close(); streamRef.current = null }
  }
  useEffect(() => closeStream, [])

  const onFile = (e) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    if (!f.name.toLowerCase().endsWith('.bin')) {
      setMessage({ text: tPages('settings.firmware_invalid_file'), type: 'error' })
      return
    }
    setFile(f)
    setMessage(null)
  }

  const selected = devices.find(d => d.device_id === deviceId)

  const startUpdate = async () => {
    // A manually chosen .bin takes priority; otherwise flash the bundled image
    // when the check says a newer one is available.
    const useBundled = !file && check?.update_available === true
    if ((!file && !useBundled) || !deviceId || updating) return

    const confirmed = await requirePassword(
      tPages('settings.blackbox_firmware_confirm', {
        name: selected?.name || tPages('settings.blackbox_firmware_this_logger')
      })
    )
    if (!confirmed) return

    setUpdating(true)
    setProgress({
      percent: 0,
      sent: 0,
      total: file?.size ?? check?.bundled_size ?? 0,
      phase: 'transferring'
    })
    setMessage(null)

    try {
      // Open the SSE stream before starting so no progress events are missed.
      // EventSource cannot send Authorization headers, hence the ?token=.
      let url = `${API}/${deviceId}/stream`
      try {
        const t = await authFetch('/api/v1/auth/stream-token')
        if (t.ok) url += `?token=${encodeURIComponent((await t.json()).stream_token)}`
      } catch { /* stream still works without the token attempt */ }

      const es = new EventSource(url)
      streamRef.current = es

      es.addEventListener('black_box_firmware_progress', (ev) => {
        const d = JSON.parse(ev.data)
        if (d.device_id === deviceId) {
          setProgress({ percent: d.percent, sent: d.sent, total: d.total, phase: d.phase })
        }
      })
      es.addEventListener('black_box_firmware_complete', (ev) => {
        const d = JSON.parse(ev.data)
        if (d.device_id !== deviceId) return
        closeStream()
        setUpdating(false)
        setProgress(null)
        setMessage({ text: d.message, type: d.success ? 'success' : 'error' })
        if (d.success) setFile(null)
        // Re-check so the banner flips to "up to date" (or reveals a failed flash)
        runCheck(deviceId)
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
        setMessage({ text: err.error || tPages('settings.firmware_update_failed'), type: 'error' })
      }
    } catch (e) {
      closeStream()
      setUpdating(false)
      setProgress(null)
      setMessage({ text: tPages('settings.firmware_update_failed'), type: 'error' })
    }
  }

  return (
    <div className="grid grid-cols-1 gap-4 py-4 sm:grid-cols-[1fr_auto]">
      <div>
        <h3 className="text-sm font-medium text-gray-900 dark:text-white">
          {tPages('settings.blackbox_firmware_title')}
        </h3>
        <p className="mt-0.5 text-[13px] text-gray-500 dark:text-slate-400">
          {tPages('settings.blackbox_firmware_help')}
          {file && <span className="ml-1">({file.name})</span>}
        </p>

        {devices.length === 0 && (
          <p className="mt-1 text-[12px] text-gray-500">{tPages('settings.blackbox_firmware_no_devices')}</p>
        )}

        {deviceId && !updating && (
          checking ? (
            <p className="mt-1 text-[12px] text-gray-500">{tPages('settings.firmware_check_checking')}</p>
          ) : check?.update_available === true ? (
            <p className="mt-1 text-[12px] text-emerald-600">
              {tPages('settings.firmware_check_available', {
                device: check.device_hash?.slice(0, 12),
                bundled: check.bundled_hash?.slice(0, 12)
              })}
            </p>
          ) : check?.update_available === false ? (
            <p className="mt-1 text-[12px] text-gray-500">
              {tPages('settings.firmware_check_up_to_date', { hash: check.device_hash?.slice(0, 12) })}
            </p>
          ) : check?.reason === 'device_unknown' ? (
            <p className="mt-1 text-[12px] text-amber-600">{tPages('settings.firmware_check_unknown_device')}</p>
          ) : check?.reason === 'invalid_bundle' ? (
            <p className="mt-1 text-[12px] text-amber-600">{tPages('settings.firmware_check_invalid')}</p>
          ) : check?.reason === 'no_bundled' ? (
            <p className="mt-1 text-[12px] text-gray-500">{tPages('settings.firmware_check_none_bundled')}</p>
          ) : null
        )}

        {progress && (
          <>
            <div className="mt-2 flex items-center gap-2">
              <div className="h-1.5 w-40 overflow-hidden rounded-full bg-gray-200 dark:bg-slate-700">
                <div
                  className="h-full rounded-full bg-emerald-600 transition-all"
                  style={{ width: `${progress.percent ?? 0}%` }}
                />
              </div>
              <span className="text-[12px] text-gray-500">
                {progress.percent ?? 0}%
                {' '}({Math.round((progress.sent ?? 0) / 1024)} / {Math.round((progress.total ?? 0) / 1024)} KB)
              </span>
            </div>
            {progress.phase === 'verifying' ? (
              <p className="mt-1 flex items-center gap-1.5 text-[12px] text-blue-600">
                <Loader2 size={12} className="animate-spin" />
                {tPages('settings.firmware_verifying')}
              </p>
            ) : (
              <p className="mt-1 text-[12px] text-amber-600">{tPages('settings.firmware_update_warning')}</p>
            )}
          </>
        )}

        {message && (
          <p className={`mt-1 text-[12px] ${message.type === 'success' ? 'text-emerald-600' : 'text-red-600'}`}>
            {message.text}
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {devices.length > 0 && (
          <select
            value={deviceId ?? ''}
            onChange={(e) => setDeviceId(Number(e.target.value))}
            disabled={updating}
            className="rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-xs font-medium text-gray-700 disabled:cursor-not-allowed disabled:text-gray-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
          >
            {devices.map((d) => (
              <option key={d.device_id} value={d.device_id} disabled={!!d.active_test_id}>
                {d.name}{d.active_test_id ? ` (${tPages('settings.firmware_device_in_test')})` : ''}
              </option>
            ))}
          </select>
        )}

        <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200">
          <Upload size={14} />
          {tPages('settings.firmware_choose_file')}
          <input type="file" accept=".bin" className="hidden" onChange={onFile} disabled={updating} />
        </label>

        <button
          onClick={startUpdate}
          disabled={updating || !deviceId || (!file && check?.update_available !== true)}
          className="flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-400"
        >
          {updating && <Loader2 size={14} className="animate-spin" />}
          {updating ? tPages('settings.firmware_updating') : tPages('settings.firmware_update_button')}
        </button>
      </div>
    </div>
  )
}
