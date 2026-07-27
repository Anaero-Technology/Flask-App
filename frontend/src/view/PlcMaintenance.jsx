import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '../components/AuthContext'
import { useToast } from '../components/Toast'
import { AlertTriangle, Loader2, Power, PowerOff } from 'lucide-react'

const API = '/api/v1/plc'

//
// Manual control of every output, with the machine's automatic schedules
// suspended. This is a commissioning and servicing tool: press a unit, walk to
// the machine, confirm the right thing moved. Entering the mode drives every
// output off first, so nothing can switch on by itself while someone is working
// on it.
//
// Units are grouped by the feeder that serves them, the same structure the tree
// on the PLC page draws, so what you see here matches how the machine is
// plumbed rather than being a flat list of relays.
//

function UnitButton({ label, on, disabled, onClick }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={[
        'rounded-md border px-2 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        on
          ? 'border-green-400 bg-green-100 text-green-900 hover:bg-green-200 dark:border-green-700 dark:bg-green-950 dark:text-green-200'
          : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700',
      ].join(' ')}
      title={`${label} is ${on ? 'on' : 'off'} — click to turn ${on ? 'off' : 'on'}`}
    >
      {label}
    </button>
  )
}

export default function PlcMaintenance({ deviceId, deviceName, layout }) {
  const { authFetch } = useAuth()
  const toast = useToast()

  const [status, setStatus] = useState(null)
  const [busy, setBusy] = useState(false)
  const active = Boolean(status?.maintenance_mode)
  const activeRef = useRef(active)
  activeRef.current = active

  const refresh = useCallback(async () => {
    if (!deviceId) return
    try {
      const res = await authFetch(`${API}/${deviceId}/status`)
      if (res.ok) setStatus(await res.json())
    } catch { /* keep the last good state rather than blanking the controls */ }
  }, [deviceId, authFetch])

  useEffect(() => { refresh() }, [refresh])

  // While outputs are under manual control the displayed state has to track the
  // machine closely, otherwise a button can lie about what is actually running.
  useEffect(() => {
    if (!active) return
    const timer = setInterval(refresh, 2000)
    return () => clearInterval(timer)
  }, [active, refresh])

  const unit = (list) => (status?.[list] || [])

  const toggleMode = async () => {
    if (!active) {
      // A quick confirmation, not a password: this is a routine servicing step,
      // and it is reversible - unlike changing the machine type.
      const confirmed = window.confirm(
        `Enter maintenance mode on ${deviceName || 'this PLC'}? All outputs switch off ` +
        `and its schedules stop until you leave.`
      )
      if (!confirmed) return
    }
    setBusy(true)
    try {
      const res = await authFetch(`${API}/${deviceId}/maintenance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enable: !active }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.success !== false) {
        toast.success(active ? 'Left maintenance mode' : 'Maintenance mode on — outputs are manual')
        await refresh()
      } else {
        toast.error(data.message || data.error || 'Could not change maintenance mode')
      }
    } finally { setBusy(false) }
  }

  const drive = async (unitType, number, state) => {
    setBusy(true)
    try {
      const res = await authFetch(`${API}/${deviceId}/maintenance/unit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unit_type: unitType, number, state }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.success === false) {
        toast.error(data.message || data.error || 'Could not drive that output')
      }
      await refresh()
    } finally { setBusy(false) }
  }

  // number 0 means every unit of that kind, which the firmware handles directly.
  const allOutputs = async (state) => {
    setBusy(true)
    try {
      for (const t of ['heater', 'mixer', 'agitator', 'feeder']) {
        await authFetch(`${API}/${deviceId}/maintenance/unit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ unit_type: t, number: 0, state }),
        })
      }
      await refresh()
    } finally { setBusy(false) }
  }

  if (!deviceId) return null

  const reactorNumbers = [...new Set([
    ...unit('heaters').map((u) => u.number),
    ...unit('mixers').map((u) => u.number),
    ...unit('agitators').map((u) => u.number),
  ])].sort((a, b) => a - b)

  const find = (list, n) => unit(list).find((u) => u.number === n)

  // Reactors under the feeder that serves them, anything unclaimed after.
  const groups = []
  const claimed = new Set()
  // A Ray reports two feeder relays but only has one wired, so show only the
  // feeders the model defines when it has a layout.
  const modelFeeders = layout ? new Set(layout.feeders.map(([n]) => n)) : null
  const visibleFeeders = unit('feeders').filter((f) => !modelFeeders || modelFeeders.has(f.number))
  for (const feeder of visibleFeeders) {
    const served = (layout?.feeders.find(([n]) => n === feeder.number)?.[1] || [])
      .filter((n) => reactorNumbers.includes(n))
    served.forEach((n) => claimed.add(n))
    groups.push({ feeder, reactors: served })
  }
  const orphans = reactorNumbers.filter((n) => !claimed.has(n))
  if (orphans.length) groups.push({ feeder: null, reactors: orphans })

  const ReactorRow = ({ n }) => {
    const heater = find('heaters', n)
    const mixer = find('mixers', n)
    const agitator = find('agitators', n)
    return (
      <div className="flex flex-wrap items-center gap-2 py-1">
        <span className="w-24 shrink-0 text-xs text-gray-600 dark:text-slate-400">Reactor {n}</span>
        {heater && <UnitButton label="Heater" on={heater.on} disabled={busy}
                               onClick={() => drive('heater', n, !heater.on)} />}
        {mixer && <UnitButton label="Mixer" on={mixer.on} disabled={busy}
                              onClick={() => drive('mixer', n, !mixer.on)} />}
        {agitator && <UnitButton label="Agitator" on={agitator.on} disabled={busy}
                                 onClick={() => drive('agitator', n, !agitator.on)} />}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 gap-4 py-4 sm:grid-cols-[1fr_auto]">
      <div>
        <h3 className="text-sm font-medium text-gray-900 dark:text-white">Maintenance mode</h3>
        <p className="mt-0.5 text-[13px] text-gray-500 dark:text-slate-400">
          Drive each output by hand to check wiring, prime a feeder or run a mixer for
          cleaning. Entering it switches everything off and suspends the machine's
          schedules, so nothing starts on its own while you work.
        </p>
      </div>

      <div className="flex items-start">
        <button
          onClick={toggleMode}
          disabled={busy || !status}
          className={[
            'flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium text-white transition-colors disabled:cursor-not-allowed disabled:bg-gray-400',
            active ? 'bg-gray-700 hover:bg-gray-800' : 'bg-amber-600 hover:bg-amber-700',
          ].join(' ')}
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <AlertTriangle size={14} />}
          {active ? 'Leave maintenance mode' : 'Enter maintenance mode'}
        </button>
      </div>

      {active && (
        <div className="sm:col-span-2">
          <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span>
              Outputs are under manual control and this machine is not running its
              schedules. Leaving maintenance mode does not restore what was running
              before — the machine resumes from everything off.
            </span>
          </div>

          <div className="mb-3 flex flex-wrap gap-2">
            <button onClick={() => allOutputs(true)} disabled={busy}
                    className="flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200">
              <Power size={14} /> All on
            </button>
            <button onClick={() => allOutputs(false)} disabled={busy}
                    className="flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:bg-gray-400">
              <PowerOff size={14} /> All off
            </button>
          </div>

          <div className="space-y-3">
            {groups.map((group, i) => (
              <div key={group.feeder?.number ?? `orphans-${i}`}
                   className="rounded-lg border border-gray-200 p-3 dark:border-slate-700">
                {group.feeder && (
                  <div className="mb-2 flex flex-wrap items-center gap-2 border-b border-gray-100 pb-2 dark:border-slate-800">
                    <span className="w-24 shrink-0 text-xs font-medium text-gray-700 dark:text-slate-300">
                      Feeder {group.feeder.number}
                    </span>
                    <UnitButton label="Feeder" on={group.feeder.on} disabled={busy}
                                onClick={() => drive('feeder', group.feeder.number, !group.feeder.on)} />
                    <span className="text-xs text-gray-400 dark:text-slate-500">
                      {group.reactors.length > 0
                        ? `serves reactor ${group.reactors.join(', ')}`
                        : 'serves no reactor on this machine'}
                    </span>
                  </div>
                )}
                {group.reactors.map((n) => <ReactorRow key={n} n={n} />)}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
