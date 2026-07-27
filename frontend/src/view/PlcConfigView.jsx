import { useEffect } from 'react'
import { X, Copy, Check } from 'lucide-react'
import { useState } from 'react'
import { feederForReactor } from './plcLayouts'

//
// Every setting on one screen. The tree is for working on one unit at a time;
// this is for reading the machine as a whole - checking a setup before a run,
// or comparing against a written procedure - so it is deliberately a plain,
// dense table rather than anything interactive.
//
export default function PlcConfigView({ open, onClose, machineLabel, deviceName, layout, status, sensors }) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  useEffect(() => { if (open) setCopied(false) }, [open])

  if (!open || !status) return null

  const heaters = status.heaters || []
  const mixers = status.mixers || []
  // A Ray reports two feeder relays but only has one wired, so show only the
  // feeders the model defines.
  const modelFeeders = layout ? new Set(layout.feeders.map(([n]) => n)) : null
  const feeders = (status.feeders || []).filter((f) => !modelFeeders || modelFeeders.has(f.number))
  const agitators = status.agitators || []

  const reactorNumbers = [...new Set([
    ...heaters.map((u) => u.number),
    ...mixers.map((u) => u.number),
    ...agitators.map((u) => u.number),
  ])].sort((a, b) => a - b)

  const find = (list, n) => list.find((u) => u.number === n)
  const mixerText = (m) => {
    if (!m) return '—'
    if (m.mode === 0) return 'off'
    if (m.mode === 1) return 'always on'
    return `${m.on_for}s on / ${m.off_for}s off`
  }

  // Plain text so a configuration can be pasted into a run sheet or an email.
  const asText = () => {
    const lines = [
      `${deviceName || 'PLC'} — ${machineLabel}`,
      `Sensors: ${sensors ? `${sensors.count} (${sensors.bus})` : 'unknown'}`,
      `Maintenance mode: ${status.maintenance_mode ? 'on' : 'off'}`,
      '',
      'Reactor  Feeder  Heater      Mixer                 Agitator',
    ]
    for (const n of reactorNumbers) {
      const fed = feederForReactor(layout, n)
      const h = find(heaters, n)
      const a = find(agitators, n)
      lines.push(
        String(n).padEnd(9) +
        String(fed ? fed.number : '—').padEnd(8) +
        String(h ? (h.enabled ? `${h.target}°C` : 'disabled') : '—').padEnd(12) +
        mixerText(find(mixers, n)).padEnd(22) +
        (a ? (a.enabled ? `${a.pre_feed}s pre-feed` : 'paused') : '—')
      )
    }
    lines.push('', 'Feeder   Setting')
    for (const f of feeders) {
      lines.push(String(f.number).padEnd(9) +
        (f.enabled ? `${f.on_for}s every ${f.off_for_minutes} min` : 'paused'))
    }
    return lines.join('\n')
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(asText())
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* clipboard unavailable, the table is still on screen */ }
  }

  const cell = 'px-3 py-1.5 text-xs text-gray-700 dark:text-slate-300'
  const head = 'px-3 py-2 text-left text-xs font-semibold text-gray-500 dark:text-slate-400'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Full PLC configuration"
    >
      <div
        className="max-h-full w-full max-w-3xl overflow-hidden rounded-xl bg-white shadow-xl dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 px-4 py-3 dark:border-slate-700">
          <div>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
              {deviceName} — {machineLabel}
            </h3>
            <p className="text-xs text-gray-500 dark:text-slate-400">
              {sensors ? `${sensors.count} sensor${sensors.count === 1 ? '' : 's'} (${sensors.bus})` : 'sensors unknown'}
              {status.maintenance_mode ? ' · maintenance mode' : ''}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={copy}
                    className="flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700">
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? 'Copied' : 'Copy as text'}
            </button>
            <button onClick={onClose} aria-label="Close"
                    className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 dark:text-slate-400 dark:hover:bg-slate-800">
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="max-h-[70vh] overflow-y-auto p-4">
          <table className="w-full border-collapse">
            <thead className="border-b border-gray-200 dark:border-slate-700">
              <tr>
                <th className={head}>Reactor</th>
                <th className={head}>Fed by</th>
                <th className={head}>Heater</th>
                <th className={head}>Mixer</th>
                <th className={head}>Agitator</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
              {reactorNumbers.map((n) => {
                const fed = feederForReactor(layout, n)
                const h = find(heaters, n)
                const m = find(mixers, n)
                const a = find(agitators, n)
                return (
                  <tr key={n}>
                    <td className={`${cell} font-medium text-gray-900 dark:text-slate-100`}>{n}</td>
                    <td className={cell}>
                      {fed ? (fed.viaReactor ? `via reactor ${fed.viaReactor}` : `feeder ${fed.number}`) : '—'}
                    </td>
                    <td className={cell}>
                      {h ? (h.enabled
                        ? <span>{h.target}°C <span className="text-gray-400">({h.actual.toFixed(1)}° now)</span></span>
                        : <span className="text-gray-400">disabled</span>) : '—'}
                    </td>
                    <td className={cell}>{m ? mixerText(m) : '—'}</td>
                    <td className={cell}>
                      {a ? (a.enabled ? `${a.pre_feed}s pre-feed` : <span className="text-gray-400">paused</span>) : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          {feeders.length > 0 && (
            <table className="mt-5 w-full border-collapse">
              <thead className="border-b border-gray-200 dark:border-slate-700">
                <tr>
                  <th className={head}>Feeder</th>
                  <th className={head}>Serves</th>
                  <th className={head}>Setting</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                {feeders.map((f) => {
                  const served = layout?.feeders.find(([n]) => n === f.number)?.[1] || []
                  return (
                    <tr key={f.number}>
                      <td className={`${cell} font-medium text-gray-900 dark:text-slate-100`}>{f.number}</td>
                      <td className={cell}>{served.length ? `reactor ${served.join(', ')}` : '—'}</td>
                      <td className={cell}>
                        {f.enabled
                          ? `${f.on_for}s every ${f.off_for_minutes} min`
                          : <span className="text-gray-400">paused</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
