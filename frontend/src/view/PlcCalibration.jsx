import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '../components/AuthContext'
import { useToast } from '../components/Toast'
import { RotateCcw, Check, Loader2, Thermometer, X } from 'lucide-react'

const API = '/api/v1/plc'

//
// Heater calibration, opened as an overlay from Settings so it stays out of the
// way until needed. The firmware reports the sensor's raw reading, which can sit
// a degree or two off a real thermometer; the operator checks each reactor with
// an external probe, types what it actually reads, and the backend stores the
// difference so the temperature the app shows matches.
//
export default function PlcCalibration({ deviceId, deviceName }) {
  const { authFetch } = useAuth()
  const toast = useToast()

  const [open, setOpen] = useState(false)
  const [heaters, setHeaters] = useState(null)
  const [measured, setMeasured] = useState({})   // reactor number -> input string
  const [busy, setBusy] = useState(null)          // reactor being saved
  const measuredRef = useRef(measured)
  measuredRef.current = measured

  const refresh = useCallback(async () => {
    if (!deviceId) return
    try {
      const res = await authFetch(`${API}/${deviceId}/status`)
      setHeaters(res.ok ? (await res.json()).heaters || [] : [])
    } catch { /* keep the last reading */ }
  }, [deviceId, authFetch])

  // Only read temperatures while the overlay is open.
  useEffect(() => {
    if (!open) return
    refresh()
    const t = setInterval(refresh, 4000)
    return () => clearInterval(t)
  }, [open, refresh])

  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const calibrate = async (number) => {
    const value = measuredRef.current[number]
    if (value === undefined || value === '') return
    setBusy(number)
    try {
      const res = await authFetch(`${API}/${deviceId}/calibration`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ number, measured: Number(value) }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.success !== false) {
        toast.success(`Reactor ${number} calibrated (offset ${data.offset >= 0 ? '+' : ''}${data.offset.toFixed(2)}°C)`)
        setMeasured((m) => ({ ...m, [number]: '' }))
        await refresh()
      } else {
        toast.error(data.error || data.message || 'Could not calibrate')
      }
    } finally { setBusy(null) }
  }

  const resetOne = async (number) => {
    setBusy(number)
    try {
      const res = await authFetch(`${API}/${deviceId}/calibration`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ number, offset: 0 }),
      })
      if (res.ok) { toast.success(`Reactor ${number} calibration cleared`); await refresh() }
      else toast.error('Could not clear calibration')
    } finally { setBusy(null) }
  }

  return (
    <div className="grid grid-cols-1 gap-4 py-4 sm:grid-cols-[1fr_auto]">
      <div>
        <h3 className="text-sm font-medium text-gray-900 dark:text-white">Heater calibration</h3>
        <p className="mt-0.5 text-[13px] text-gray-500 dark:text-slate-400">
          Correct each reactor's temperature reading against an external thermometer.
        </p>
      </div>

      <div className="flex items-start">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
        >
          <Thermometer size={14} /> Calibrate heaters
        </button>
      </div>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Heater calibration"
        >
          <div
            className="max-h-full w-full max-w-2xl overflow-hidden rounded-xl bg-white shadow-xl dark:bg-slate-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2 border-b border-gray-200 px-4 py-3 dark:border-slate-700">
              <div>
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Heater calibration</h3>
                <p className="text-xs text-gray-500 dark:text-slate-400">
                  {deviceName ? `${deviceName} · ` : ''}enter what an external thermometer reads for each reactor
                </p>
              </div>
              <button onClick={() => setOpen(false)} aria-label="Close"
                      className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 dark:text-slate-400 dark:hover:bg-slate-800">
                <X size={16} />
              </button>
            </div>

            <div className="max-h-[70vh] overflow-y-auto p-4">
              {heaters === null ? (
                <div className="flex items-center gap-2 py-4 text-xs text-gray-500 dark:text-slate-400">
                  <Loader2 size={14} className="animate-spin" /> Reading temperatures…
                </div>
              ) : heaters.length === 0 ? (
                <p className="py-4 text-[13px] text-gray-500 dark:text-slate-400">
                  This machine has no heaters to calibrate.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {heaters.map((h) => {
                    const offset = h.offset ?? 0
                    return (
                      <div key={h.number}
                           className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-gray-200 px-3 py-1.5 dark:border-slate-700">
                        <Thermometer size={13} className="shrink-0 text-amber-500" />
                        <span className="w-20 shrink-0 text-sm font-medium text-gray-900 dark:text-slate-100">
                          Reactor {h.number}
                        </span>
                        <span className="whitespace-nowrap text-xs text-gray-500 dark:text-slate-400">
                          reads <span className="text-gray-700 dark:text-slate-200">{h.actual.toFixed(1)}°C</span>
                          {' · '}sensor {(h.actual_raw ?? 0).toFixed(1)}°C
                          {offset !== 0 && <> · offset {offset >= 0 ? '+' : ''}{offset.toFixed(2)}°C</>}
                        </span>

                        <div className="ml-auto flex items-center gap-2">
                          <input
                            type="number" step="0.1" placeholder="measured °C"
                            className="w-28 rounded-lg border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
                            value={measured[h.number] ?? ''}
                            onChange={(e) => setMeasured((m) => ({ ...m, [h.number]: e.target.value }))}
                            onKeyDown={(e) => e.key === 'Enter' && calibrate(h.number)}
                          />
                          <button
                            onClick={() => calibrate(h.number)}
                            disabled={busy === h.number || (measured[h.number] ?? '') === ''}
                            className="flex items-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-400"
                          >
                            {busy === h.number ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                            Calibrate
                          </button>
                          <button
                            onClick={() => resetOne(h.number)}
                            disabled={busy === h.number || offset === 0}
                            title="Clear this reactor's offset"
                            className="rounded-lg p-1 text-gray-400 hover:text-gray-700 disabled:opacity-40 dark:hover:text-slate-200"
                          >
                            <RotateCcw size={14} />
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
