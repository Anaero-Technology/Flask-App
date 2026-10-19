import { useState, useMemo } from 'react'
import { LineChart, Line, YAxis, ReferenceLine, ResponsiveContainer } from 'recharts'
import {
  Droplets, ShieldAlert, ShieldCheck, FlaskConical, Download, Pencil, X, Check,
  Loader2, RotateCcw, Zap, ArrowDown, ArrowUp
} from 'lucide-react'

//
// pH control, running on the PLC as a module.
//
// One probe per reactor. Each channel has an alarm band (min/max) and two dose
// actions: LOW doses the alkaline pump to raise pH, HIGH doses the acid pump to
// lower it. A dose is "pump <ml> through valve port <n>"; ports 1-8 are plumbed
// to reactors 1-8 and the refill port draws from the reagent bottle.
//
// Automatic dosing only happens when the controller is ARMED, and only reaches
// a pump when DRY-RUN is off - both are the safe way round when the PLC boots.
//

const inputClass =
  'w-full rounded-lg border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:bg-gray-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:disabled:bg-slate-800'
const subtleButtonClass =
  'flex items-center justify-center gap-1.5 rounded-lg border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
const buttonClass =
  'flex items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-400'

const SYRINGE_ML = 25

const STATUS_STYLE = {
  done: 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300',
  refilled: 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300',
  simulated: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300',
  cancelled: 'bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-slate-300',
  skipped: 'bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-slate-300',
}

function alarmColour(alarm) {
  if (alarm === 'LOW') return 'text-orange-600 dark:text-orange-400'
  if (alarm === 'HIGH') return 'text-fuchsia-600 dark:text-fuchsia-400'
  return 'text-gray-900 dark:text-white'
}

function actionSummary(action, role) {
  if (!action?.enabled || !action.volume_ml) return 'off'
  const repeat = action.interval_s > 0 ? `, every ${action.interval_s}s` : ', once'
  return `${action.volume_ml} ml ${role} → port ${action.valve}${repeat}`
}

function Toggle({ on, onClick, disabled, onLabel, offLabel, onClass, icon: Icon, title }) {
  return (
    <button onClick={onClick} disabled={disabled} title={title}
            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
              on ? onClass : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
            }`}>
      {Icon && <Icon size={14} />}
      {on ? onLabel : offLabel}
    </button>
  )
}

function Sparkline({ data, min, max }) {
  if (!data || data.length < 2) {
    return <div className="flex h-14 items-center justify-center text-[10px] text-gray-400 dark:text-slate-500">collecting…</div>
  }
  const values = data.map((d) => d.v)
  const lo = Math.min(min, ...values) - 0.15
  const hi = Math.max(max, ...values) + 0.15
  return (
    <div className="h-14">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 2, bottom: 2, left: 2 }}>
          <YAxis domain={[lo, hi]} hide />
          <ReferenceLine y={min} stroke="#fb923c" strokeDasharray="3 3" />
          <ReferenceLine y={max} stroke="#e879f9" strokeDasharray="3 3" />
          <Line type="monotone" dataKey="v" stroke="#7c3aed" strokeWidth={1.75} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

function ActionFields({ label, value, onChange, refillValves }) {
  const set = (field, v) => onChange({ ...value, [field]: v })
  return (
    <fieldset className="rounded-lg border border-gray-200 p-2 dark:border-slate-700">
      <legend className="px-1 text-[11px] font-medium text-gray-600 dark:text-slate-300">{label}</legend>
      <label className="mb-1.5 flex items-center gap-1.5 text-xs text-gray-700 dark:text-slate-300">
        <input type="checkbox" checked={Boolean(value.enabled)} onChange={(e) => set('enabled', e.target.checked)} />
        Enabled
      </label>
      <div className="grid grid-cols-3 gap-1.5">
        <div>
          <span className="text-[10px] text-gray-500 dark:text-slate-400">ml</span>
          <input type="number" min={0} max={24} step={0.1} className={inputClass} value={value.volume_ml}
                 onChange={(e) => set('volume_ml', e.target.value)} />
        </div>
        <div>
          <span className="text-[10px] text-gray-500 dark:text-slate-400">Port</span>
          <select className={inputClass} value={value.valve} onChange={(e) => set('valve', Number(e.target.value))}>
            {Array.from({ length: 15 }, (_, i) => i + 1).map((v) => (
              <option key={v} value={v} disabled={refillValves.includes(v)}>
                {v}{refillValves.includes(v) ? ' (refill)' : ''}
              </option>
            ))}
          </select>
        </div>
        <div>
          <span className="text-[10px] text-gray-500 dark:text-slate-400">Repeat s</span>
          <input type="number" min={0} step={10} className={inputClass} value={value.interval_s}
                 onChange={(e) => set('interval_s', e.target.value)} />
        </div>
      </div>
      <p className="mt-1 text-[10px] text-gray-400 dark:text-slate-500">Repeat 0 doses once per excursion.</p>
    </fieldset>
  )
}

function ChannelCard({ channel, history, canWrite, onSave, refillValves, simulated, onDisturb }) {
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)

  const startEdit = () => {
    setForm({ min: channel.min, max: channel.max, low: { ...channel.low }, high: { ...channel.high } })
    setEditing(true)
  }

  const save = async () => {
    setSaving(true)
    const num = (a) => ({ ...a, volume_ml: Number(a.volume_ml) || 0, interval_s: Number(a.interval_s) || 0 })
    const ok = await onSave({
      number: channel.number, min: Number(form.min), max: Number(form.max),
      low: num(form.low), high: num(form.high),
    })
    setSaving(false)
    if (ok) setEditing(false)
  }

  return (
    <div className={`rounded-xl border bg-white p-3 dark:bg-slate-900 ${
      channel.alarm ? 'border-red-300 dark:border-red-800' : 'border-gray-200 dark:border-slate-700'
    }`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-wide text-gray-500 dark:text-slate-400">
            Reactor {channel.number}
          </div>
          <div className={`text-2xl font-semibold tabular-nums ${alarmColour(channel.alarm)}`}>
            {channel.ph != null ? channel.ph.toFixed(2) : '—'}
            <span className="ml-1 text-xs font-normal text-gray-400 dark:text-slate-500">pH</span>
          </div>
        </div>
        <div className="text-right">
          {channel.alarm ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-700 dark:bg-red-950 dark:text-red-300">
              {channel.alarm === 'LOW' ? <ArrowDown size={10} /> : <ArrowUp size={10} />}{channel.alarm}
            </span>
          ) : (
            <span className="inline-flex rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-700 dark:bg-green-950 dark:text-green-300">
              in range
            </span>
          )}
          <div className="mt-1 text-[11px] tabular-nums text-gray-500 dark:text-slate-400">
            {channel.min} – {channel.max}
          </div>
        </div>
      </div>

      <Sparkline data={history} min={channel.min} max={channel.max} />

      {!editing ? (
        <>
          <dl className="mt-1 space-y-0.5 text-[11px]">
            <div className="flex gap-1">
              <dt className="w-10 shrink-0 text-orange-600 dark:text-orange-400">LOW</dt>
              <dd className="truncate text-gray-600 dark:text-slate-300">{actionSummary(channel.low, 'alkaline')}</dd>
            </div>
            <div className="flex gap-1">
              <dt className="w-10 shrink-0 text-fuchsia-600 dark:text-fuchsia-400">HIGH</dt>
              <dd className="truncate text-gray-600 dark:text-slate-300">{actionSummary(channel.high, 'acid')}</dd>
            </div>
          </dl>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {canWrite && (
              <button className={subtleButtonClass} onClick={startEdit}><Pencil size={12} /> Edit</button>
            )}
            {simulated && canWrite && (
              <span className="ml-auto flex items-center gap-1" title="Simulator only: knock this reactor's pH">
                <Zap size={12} className="text-violet-500" />
                <button className={`${subtleButtonClass} px-1.5`} onClick={() => onDisturb(channel.number, -0.6)}
                        title="Acid shock, as after an overfeed">−0.6</button>
                <button className={`${subtleButtonClass} px-1.5`} onClick={() => onDisturb(channel.number, 0.6)}
                        title="Alkaline shock">+0.6</button>
              </span>
            )}
          </div>
        </>
      ) : (
        <div className="mt-2 space-y-2">
          <div className="grid grid-cols-2 gap-1.5">
            <div>
              <span className="text-[10px] text-gray-500 dark:text-slate-400">Min pH</span>
              <input type="number" step={0.1} min={0} max={14} className={inputClass} value={form.min}
                     onChange={(e) => setForm({ ...form, min: e.target.value })} />
            </div>
            <div>
              <span className="text-[10px] text-gray-500 dark:text-slate-400">Max pH</span>
              <input type="number" step={0.1} min={0} max={14} className={inputClass} value={form.max}
                     onChange={(e) => setForm({ ...form, max: e.target.value })} />
            </div>
          </div>
          <ActionFields label="LOW → alkaline pump" value={form.low} refillValves={refillValves}
                        onChange={(low) => setForm({ ...form, low })} />
          <ActionFields label="HIGH → acid pump" value={form.high} refillValves={refillValves}
                        onChange={(high) => setForm({ ...form, high })} />
          <div className="flex justify-end gap-1.5">
            <button className={subtleButtonClass} onClick={() => setEditing(false)} disabled={saving}>
              <X size={12} /> Cancel
            </button>
            <button className={buttonClass} onClick={save} disabled={saving}>
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Save
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function PumpCard({ role, pump, canWrite, onRefill, onDose }) {
  const [valve, setValve] = useState(1)
  const [volume, setVolume] = useState(1)
  const fill = Math.max(0, Math.min(1, pump.syringe_ml / SYRINGE_ML))
  const colour = role === 'acid' ? 'bg-fuchsia-500' : 'bg-orange-500'
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-gray-900 dark:text-white">
          <FlaskConical size={14} className={role === 'acid' ? 'text-fuchsia-500' : 'text-orange-500'} />
          {role === 'acid' ? 'Acid pump' : 'Alkaline pump'}
        </span>
        {pump.busy
          ? <span className="flex items-center gap-1 text-[11px] text-blue-600 dark:text-blue-400"><Loader2 size={11} className="animate-spin" /> pumping</span>
          : <span className="text-[11px] text-gray-500 dark:text-slate-400">idle</span>}
      </div>
      <div className="h-3 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-slate-800">
        <div className={`h-full ${colour} transition-all duration-700`} style={{ width: `${fill * 100}%` }} />
      </div>
      <div className="mt-1 flex justify-between text-[11px] tabular-nums text-gray-500 dark:text-slate-400">
        <span>{pump.syringe_ml.toFixed(1)} / {SYRINGE_ML} ml in syringe</span>
        <span>{pump.dosed_ml.toFixed(1)} ml dosed</span>
      </div>
      <p className="mt-1 text-[11px] text-gray-500 dark:text-slate-400">
        Refills automatically from port {pump.refill_valve} when a dose needs more than is left.
      </p>
      {canWrite && (
        <div className="mt-2 flex flex-wrap items-end gap-1.5">
          <div className="w-16">
            <span className="text-[10px] text-gray-500 dark:text-slate-400">Port</span>
            <select className={inputClass} value={valve} onChange={(e) => setValve(Number(e.target.value))}>
              {Array.from({ length: 14 }, (_, i) => i + 1).filter((v) => v !== pump.refill_valve)
                .map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
          <div className="w-16">
            <span className="text-[10px] text-gray-500 dark:text-slate-400">ml</span>
            <input type="number" min={0.1} max={24} step={0.1} className={inputClass} value={volume}
                   onChange={(e) => setVolume(e.target.value)} />
          </div>
          <button className={subtleButtonClass} disabled={pump.busy}
                  onClick={() => onDose(role, valve, Number(volume))}>
            <Droplets size={12} /> Dose
          </button>
          <button className={subtleButtonClass} disabled={pump.busy} onClick={() => onRefill(role)}>
            <RotateCcw size={12} /> Refill
          </button>
        </div>
      )}
    </div>
  )
}

export default function PlcPh({ deviceId, ph, authFetch, toast, canWrite, onChanged }) {
  const [busy, setBusy] = useState('')

  // One series per channel from the telemetry the backend has buffered.
  const series = useMemo(() => {
    const out = {}
    for (const point of ph?.history || []) {
      for (const [n, v] of Object.entries(point.values)) {
        (out[n] ||= []).push({ t: point.t, v })
      }
    }
    return out
  }, [ph?.history])

  const refillValves = useMemo(
    () => Object.values(ph?.pumps || {}).map((p) => p.refill_valve),
    [ph?.pumps])

  const call = async (path, body, label) => {
    setBusy(label)
    try {
      const res = await authFetch(`/api/v1/plc/${deviceId}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.success !== false) {
        toast.success(data.message || `${label} done`)
        onChanged?.()
        return true
      }
      toast.error(data.message || data.error || `${label} failed`)
      return false
    } catch {
      toast.error(`${label} failed`)
      return false
    } finally {
      setBusy('')
    }
  }

  const setArmed = (armed) => {
    if (armed && !ph.dry_run &&
        !window.confirm('Arm automatic dosing? Pumps will dose reagent into the reactors whenever a channel leaves its range.')) return
    call('/ph/controller', { armed }, armed ? 'Arm' : 'Disarm')
  }
  const setDryRun = (dryRun) => {
    if (!dryRun && ph.armed &&
        !window.confirm('Switch to live dosing? The controller is armed, so pumps will start running.')) return
    call('/ph/controller', { dry_run: dryRun }, dryRun ? 'Dry run' : 'Live dosing')
  }

  const downloadLog = async () => {
    const res = await authFetch(`/api/v1/plc/${deviceId}/ph/log.csv`)
    if (!res.ok) { toast.error('Could not download the dose log'); return }
    const url = URL.createObjectURL(await res.blob())
    const a = document.createElement('a')
    a.href = url
    a.download = 'ph_dose_log.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  if (!ph?.available) return null

  const events = [...(ph.events || [])].reverse().slice(0, 14)
  const mode = !ph.armed ? 'Monitoring only' : ph.dry_run ? 'Armed · dry run (no pumping)' : 'Armed · live dosing'

  return (
    <div className="rounded-xl border border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-900">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 px-4 py-3 dark:border-slate-700">
        <div className="flex flex-wrap items-baseline gap-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
            <Droplets size={16} className="text-violet-600 dark:text-violet-400" /> pH control
          </h3>
          <span className="text-xs text-gray-500 dark:text-slate-400">{mode}</span>
          {ph.queue_depth > 0 && (
            <span className="text-xs text-blue-600 dark:text-blue-400">{ph.queue_depth} dose{ph.queue_depth === 1 ? '' : 's'} queued</span>
          )}
          {ph.simulated && (
            <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-medium text-violet-700 dark:bg-violet-950 dark:text-violet-300"
                  title="Running against the PLC simulator - process time is accelerated">
              simulated ×{ph.sim_speed}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Toggle on={ph.armed} disabled={!canWrite || busy !== ''} onClick={() => setArmed(!ph.armed)}
                  onLabel="Armed" offLabel="Disarmed" icon={ph.armed ? ShieldAlert : ShieldCheck}
                  onClass="border-red-300 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-800 dark:bg-red-950 dark:text-red-300"
                  title="When armed, out-of-range channels queue their dose actions" />
          <Toggle on={ph.dry_run} disabled={!canWrite || busy !== ''} onClick={() => setDryRun(!ph.dry_run)}
                  onLabel="Dry run" offLabel="Live" icon={FlaskConical}
                  onClass="border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300"
                  title="In dry run, doses are logged but no pump moves" />
          <button className={subtleButtonClass} onClick={downloadLog}><Download size={12} /> Dose log</button>
        </div>
      </div>

      <div className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="grid content-start gap-3 sm:grid-cols-2 2xl:grid-cols-4">
          {ph.channels.map((c) => (
            <ChannelCard key={c.number} channel={c} history={series[c.number]} canWrite={canWrite}
                         refillValves={refillValves} simulated={ph.simulated}
                         onSave={(body) => call('/ph/channel', body, `Reactor ${c.number} pH`)}
                         onDisturb={(number, delta) => call('/ph/disturb', { number, delta }, 'Disturbance')} />
          ))}
        </div>

        <div className="space-y-3">
          {['alkaline', 'acid'].map((role) => ph.pumps[role] && (
            <PumpCard key={role} role={role} pump={ph.pumps[role]} canWrite={canWrite}
                      onRefill={(r) => call('/ph/refill', { role: r }, 'Refill')}
                      onDose={(r, valve, volume_ml) => call('/ph/dose', { role: r, valve, volume_ml }, 'Dose')} />
          ))}

          <div className="rounded-xl border border-gray-200 p-3 dark:border-slate-700">
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
              Recent doses
            </h4>
            {events.length === 0 ? (
              <p className="text-xs text-gray-500 dark:text-slate-400">
                No doses yet. Arm the controller and enable a LOW or HIGH action.
              </p>
            ) : (
              <ul className="space-y-1">
                {events.map((e, i) => (
                  <li key={`${e.ts}-${i}`} className="flex items-center gap-2 text-[11px] text-gray-600 dark:text-slate-300">
                    <span className="w-14 shrink-0 tabular-nums text-gray-400 dark:text-slate-500">{e.time}</span>
                    <span className="min-w-0 flex-1 truncate">
                      {e.channel > 0 ? `R${e.channel} ${e.edge}` : 'manual'} · {e.volume_ml} ml {e.role} → {e.valve}
                    </span>
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS_STYLE[e.status] || 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300'}`}>
                      {e.status}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
