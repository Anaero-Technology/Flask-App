import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../components/AuthContext'
import { useToast } from '../components/Toast'
import { modelsAvailable, modelById, resolveModel, feederForReactor } from './plcLayouts'
import PlcTree from './PlcTree'
import PlcConfigView from './PlcConfigView'
import {
  Cpu, Loader2, RefreshCw, Wrench, AlertTriangle, Check, MousePointerClick, Unplug,
  Save, FolderOpen, Trash2, Table2, ArrowLeft
} from 'lucide-react'

const API = '/api/v1/plc'

const inputClass =
  'w-full rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-xs text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:bg-gray-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:disabled:bg-slate-800'
const buttonClass =
  'flex items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-400'
const subtleButtonClass =
  'flex items-center justify-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'

// Heading for the panels that live inside the shaded control column - no card
// chrome and no icons, so the column reads as plain labelled settings.
function ControlSection({ title, children }) {
  return (
    <div>
      <h5 className="mb-2 text-sm font-semibold text-gray-900 dark:text-white">
        {title}
      </h5>
      {children}
    </div>
  )
}

function Card({ title, icon: Icon, children, actions }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
          {Icon && <Icon size={16} className="text-blue-600 dark:text-blue-400" />}
          {title}
        </h3>
        {actions}
      </div>
      {children}
    </div>
  )
}

// Sits inline with the page title, so it is kept to one line with the rest on
// hover rather than wrapping and pushing the machine down the page.
function SensorWarning({ sensors }) {
  if (!sensors || sensors.heating_available) return null
  return (
    <div
      className="inline-flex max-w-full items-center gap-2 truncate rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200"
      title="Mixers, feeders and agitators still run, but heater control stays inhibited until sensors are connected."
    >
      <AlertTriangle size={14} className="shrink-0" />
      <span className="truncate">No temperature sensors — heating inhibited</span>
    </div>
  )
}

function Field({ label, value, onChange, min, max, type = 'number', options, disabled }) {
  return (
    <div className="w-28">
      <label className="mb-1 block text-xs text-gray-500 dark:text-slate-400">{label}</label>
      {type === 'select' ? (
        <select className={inputClass} value={value} disabled={disabled}
                onChange={(e) => onChange(e.target.value)}>
          {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      ) : (
        <input type="number" min={min} max={max} className={inputClass} value={value}
               disabled={disabled} onChange={(e) => onChange(e.target.value)} />
      )}
    </div>
  )
}

// Everything attached to one reactor in one place - closer to how the machine
// is operated than four separate lists.
function ReactorPanel({ number, status, layout, sensors, onStage, draft }) {
  const heater = (status.heaters || []).find((u) => u.number === number)
  const mixer = (status.mixers || []).find((u) => u.number === number)
  const agitator = (status.agitators || []).find((u) => u.number === number)
  const fed = feederForReactor(layout, number)

  const [target, setTarget] = useState(heater?.target ?? 0)
  const [mode, setMode] = useState(mixer?.mode ?? 0)
  const [onFor, setOnFor] = useState(mixer?.on_for ?? 0)
  const [offFor, setOffFor] = useState(mixer?.off_for ?? 0)
  const [preFeed, setPreFeed] = useState(agitator?.pre_feed ?? 0)

  // An unsent edit wins over the machine's value, so switching away from a
  // reactor and back does not silently drop what was typed.
  const staged = (unitType, field, fallback) =>
    draft?.[`${unitType}:${number}`]?.[field] ?? fallback

  useEffect(() => {
    setTarget(staged('heater', 'target', heater?.target ?? 0))
    setMode(staged('mixer', 'mode', mixer?.mode ?? 0))
    setOnFor(staged('mixer', 'on_for', mixer?.on_for ?? 0))
    setOffFor(staged('mixer', 'off_for', mixer?.off_for ?? 0))
    setPreFeed(staged('agitator', 'pre_feed', agitator?.pre_feed ?? 0))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [number, heater?.target, mixer?.mode, mixer?.on_for, mixer?.off_for, agitator?.pre_feed])

  const heatingBlocked = !sensors?.heating_available

  return (
    <ControlSection title={`Reactor ${number}`}>
      {fed && (
        <p className="mb-3 text-xs text-gray-500 dark:text-slate-400">
          {fed.viaReactor
            ? `Fed from reactor ${fed.viaReactor} (feeder ${fed.number}).`
            : `Fed by feeder ${fed.number}.`}
        </p>
      )}

      <div className="space-y-3">
        {heater ? (
          <div>
            <div className="mb-1 flex flex-wrap items-center gap-2 text-xs font-medium text-gray-700 dark:text-slate-300">
              Heater
              <span className="font-normal text-gray-500 dark:text-slate-400">
                {heater.actual.toFixed(1)}°C now · {heater.on ? 'heating' : 'idle'}
              </span>
            </div>
            {heatingBlocked && (
              <p className="mb-1 text-xs text-amber-700 dark:text-amber-300">
                Inhibited while no sensors are connected.
              </p>
            )}
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Target °C" value={target} min={0} max={120} disabled={heatingBlocked}
                     onChange={(v) => { setTarget(v); onStage('heater', number, { target: Number(v) }) }} />
              <span className="text-xs text-gray-500 dark:text-slate-400">0 disables</span>
            </div>
          </div>
        ) : (
          <p className="text-xs text-gray-500 dark:text-slate-400">No heater on this reactor.</p>
        )}

        {mixer && (
          <div className="border-t border-gray-100 pt-3 dark:border-slate-800">
            <div className="mb-1 flex flex-wrap items-center gap-2 text-xs font-medium text-gray-700 dark:text-slate-300">
              Mixer
              <span className="font-normal text-gray-500 dark:text-slate-400">
                {['always off', 'always on', 'timed'][mixer.mode] ?? `mode ${mixer.mode}`}
                {mixer.on ? ' · running' : ''}
              </span>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Mode" type="select" value={mode}
                     options={[[0, 'Always off'], [1, 'Always on'], [2, 'Timed']]}
                     onChange={(v) => { setMode(v); onStage('mixer', number, {
                       mode: Number(v), on_for: Number(onFor), off_for: Number(offFor) }) }} />
              <Field label="On (s)" value={onFor} min={0} disabled={Number(mode) !== 2}
                     onChange={(v) => { setOnFor(v); onStage('mixer', number, {
                       mode: Number(mode), on_for: Number(v), off_for: Number(offFor) }) }} />
              <Field label="Off (s)" value={offFor} min={0} disabled={Number(mode) !== 2}
                     onChange={(v) => { setOffFor(v); onStage('mixer', number, {
                       mode: Number(mode), on_for: Number(onFor), off_for: Number(v) }) }} />
            </div>
          </div>
        )}

        {agitator && (
          <div className="border-t border-gray-100 pt-3 dark:border-slate-800">
            <div className="mb-1 flex flex-wrap items-center gap-2 text-xs font-medium text-gray-700 dark:text-slate-300">
              Agitator
              <span className="font-normal text-gray-500 dark:text-slate-400">
                {agitator.enabled ? `${agitator.pre_feed}s before feed` : 'paused'}
                {agitator.on ? ' · running' : ''}
              </span>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Pre-feed (s)" value={preFeed} min={0}
                     onChange={(v) => { setPreFeed(v); onStage('agitator', number, { pre_feed: Number(v) }) }} />
              <span className="text-xs text-gray-500 dark:text-slate-400">0 pauses</span>
            </div>
          </div>
        )}
      </div>
    </ControlSection>
  )
}

function FeederPanel({ number, status, layout, onStage, draft }) {
  const feeder = (status.feeders || []).find((u) => u.number === number)
  const served = layout?.feeders.find(([n]) => n === number)?.[1] || []

  const [onFor, setOnFor] = useState(feeder?.on_for ?? 0)
  const [every, setEvery] = useState(feeder?.off_for_minutes ?? 0)

  const stagedFeeder = draft?.[`feeder:${number}`]

  useEffect(() => {
    setOnFor(stagedFeeder?.on_for ?? feeder?.on_for ?? 0)
    setEvery(stagedFeeder?.off_for_minutes ?? feeder?.off_for_minutes ?? 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [number, feeder?.on_for, feeder?.off_for_minutes])

  if (!feeder) return null

  return (
    <ControlSection title={`Feeder ${number}`}>
      <p className="mb-2 text-xs text-gray-500 dark:text-slate-400">
        {served.length > 0 && <>Serves reactor {served.join(', ')}. </>}
        {feeder.enabled ? `Currently ${feeder.on_for}s every ${feeder.off_for_minutes} min.` : 'Currently paused.'}
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="On (s)" value={onFor} min={0}
               onChange={(v) => { setOnFor(v); onStage('feeder', number, {
                 on_for: Number(v), off_for_minutes: Number(every) }) }} />
        <Field label="Every (min)" value={every} min={0}
               onChange={(v) => { setEvery(v); onStage('feeder', number, {
                 on_for: Number(onFor), off_for_minutes: Number(v) }) }} />
      </div>
      <p className="mt-2 text-xs text-gray-500 dark:text-slate-400">
        An on time below 5 s, or an interval of 0, pauses the feeder.
      </p>
    </ControlSection>
  )
}

export default function PLC({ initialParams }) {
  const { authFetch } = useAuth()
  const toast = useToast()

  const [plcs, setPlcs] = useState([])
  const [selectedId, setSelectedId] = useState(initialParams?.deviceId ?? null)
  const [info, setInfo] = useState(null)
  const [status, setStatus] = useState(null)
  const [sensors, setSensors] = useState(null)
  const [firmwareTypes, setFirmwareTypes] = useState([])
  const [chosenModelId, setChosenModelId] = useState('')
  const [selection, setSelection] = useState(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState('')
  const [savedModelId, setSavedModelId] = useState(null)
  const [treeHeight, setTreeHeight] = useState(360)
  const [profiles, setProfiles] = useState([])
  const [chosenProfileId, setChosenProfileId] = useState('')
  const [showFullConfig, setShowFullConfig] = useState(false)
  const [pending, setPending] = useState(null)
  // Edits waiting to be applied, keyed "heater:1". Held here rather than in the
  // panels so a batch can span several reactors before it is sent.
  const [draft, setDraft] = useState({})

  // Only a connected PLC can be driven, so nothing else is offered.
  const connectedPlcs = plcs.filter((p) => p.connected)
  const selected = plcs.find((p) => p.device_id === selectedId) || null
  const connected = Boolean(selected?.connected)
  const machineType = info?.machine_type || null

  // Products that share a firmware personality (Ray / Ray-I) are
  // indistinguishable to the PLC, so which one is installed is remembered per
  // device rather than read back from it.
  // Sized to the drawn tree, but never shorter than a reactor's controls need:
  // heater, mixer and agitator blocks, the no-sensor warning, and the pinned
  // Apply bar all have to fit a small machine like a Ray without cramping. Fixed
  // per machine, so choosing a reactor swaps the controls without resizing.
  const panelHeight = Math.min(Math.max(treeHeight + 48, 560), 800)

  const modelKey = selected?.mac_address ? `plc-model:${selected.mac_address}` : null
  const modelOptions = modelsAvailable(firmwareTypes)
  const layout = resolveModel(machineType, info?.machine_counts?.feeders, savedModelId)

  useEffect(() => {
    if (!modelKey) return
    setSavedModelId(window.localStorage.getItem(modelKey) || null)
  }, [modelKey, machineType])

  useEffect(() => {
    setChosenModelId(layout?.id || '')
  }, [layout?.id])

  const loadList = useCallback(async () => {
    try {
      const res = await authFetch(`${API}/connected`)
      const data = await res.json()
      const list = data.plcs || []

      // If we arrived for a specific device that is momentarily not connected
      // (e.g. from a device card while it reconnects), give it one nudge before
      // filtering it out.
      const targetId = initialParams?.deviceId
      const target = targetId && list.find((p) => p.device_id === targetId)
      let effective = list
      if (target && !target.connected) {
        await authFetch(`${API}/${targetId}/connect`, { method: 'POST' }).catch(() => {})
        effective = (await (await authFetch(`${API}/connected`)).json()).plcs || list
      }

      // The list only ever holds PLCs that are actually plugged in - stale
      // records for unplugged devices are dropped rather than shown.
      const connectedList = effective.filter((p) => p.connected)
      setPlcs(connectedList)

      setSelectedId((cur) => {
        if (cur && connectedList.some((p) => p.device_id === cur)) return cur  // keep a valid choice
        return targetId ?? connectedList[0]?.device_id ?? null
      })
    } catch {
      toast.error('Could not load PLC list')
    }
  }, [authFetch, initialParams?.deviceId])

  // The API lists firmware personalities; the picker offers the products built
  // on them, so a personality the firmware drops disappears from the list too.
  const loadPending = useCallback(async (id) => {
    if (!id) return
    try {
      const res = await authFetch(`${API}/${id}/pending`)
      if (res.ok) setPending(await res.json())
    } catch { /* leave the last known state */ }
  }, [authFetch])

  const loadProfiles = useCallback(async () => {
    try {
      const res = await authFetch(`${API}/profiles`)
      setProfiles((await res.json()).profiles || [])
    } catch { /* list stays empty */ }
  }, [authFetch])

  const loadMachineTypes = useCallback(async () => {
    try {
      const res = await authFetch(`${API}/machine_types`)
      setFirmwareTypes((await res.json()).machine_types || [])
    } catch { /* picker falls back to every known model */ }
  }, [authFetch])

  //
  // background: a periodic refresh rather than a first load. A refresh must not
  // clear what is already on screen - a single request that times out because
  // the serial line was momentarily busy would otherwise blank the machine and
  // bring it back a few seconds later, which reads as the page flickering. The
  // spinner is likewise only for the first load.
  //
  const loadDetail = useCallback(async (id, { background = false } = {}) => {
    if (!id) return
    if (!background) setLoading(true)
    try {
      const infoRes = await authFetch(`${API}/${id}/info`)
      if (!infoRes.ok) {
        if (!background) { setInfo(null); setStatus(null); setSensors(null) }
        return
      }
      const infoData = await infoRes.json()
      setInfo(infoData)

      // Both only mean anything once a machine type is set: the firmware rejects
      // statusget before that, and sensor discovery does not run until systemset.
      if (!infoData.machine_type) {
        setStatus(null); setSensors(null)
        return
      }

      const [statusRes, sensorRes] = await Promise.all([
        authFetch(`${API}/${id}/status`),
        authFetch(`${API}/${id}/sensors`),
      ])
      loadPending(id)
      if (statusRes.ok) setStatus(await statusRes.json())
      else if (!background) setStatus(null)

      if (sensorRes.ok) setSensors(await sensorRes.json())
      else if (!background) setSensors(null)
    } catch {
      if (!background) { setInfo(null); setStatus(null); setSensors(null) }
    } finally {
      if (!background) setLoading(false)
    }
  }, [authFetch, loadPending])

  // A PLC that has been power cycled comes back with no machine set. If this
  // browser knows which one it is, put it back automatically - the backend then
  // reloads that machine's saved settings from the PLC's own SD card.
  useEffect(() => {
    if (!connected || !info || info.machine_type || !savedModelId) return
    if (busy !== '' || loading) return
    applyModel(savedModelId)
    // applyModel is stable enough for this guarded, one-shot restore
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, info?.machine_type, savedModelId])

  useEffect(() => { loadList(); loadMachineTypes(); loadProfiles() }, [loadList, loadMachineTypes, loadProfiles])

  // The device list is cheap (no serial traffic), so it is polled often enough
  // that unplugging the USB or RS232 lead clears the page promptly. Live state
  // costs a few serial round trips, so it refreshes more slowly.
  useEffect(() => {
    const listTimer = setInterval(() => { loadList() }, 5000)
    return () => clearInterval(listTimer)
  }, [loadList])

  useEffect(() => {
    if (!selectedId || !connected) return
    const detailTimer = setInterval(() => { loadDetail(selectedId, { background: true }) }, 10000)
    return () => clearInterval(detailTimer)
  }, [selectedId, connected, loadDetail])
  useEffect(() => {
    if (selectedId && connected) loadDetail(selectedId)
    else { setInfo(null); setStatus(null); setSensors(null); setSelection(null) }
  }, [selectedId, connected, loadDetail])

  const post = async (path, body, label) => {
    setBusy(label)
    try {
      const res = await authFetch(`${API}/${selectedId}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.success !== false) {
        toast.success(data.message || `${label} done`)
        return true
      }
      toast.error(data.message || data.error || `${label} failed`)
      return false
    } catch {
      toast.error(`${label} failed`); return false
    } finally { setBusy('') }
  }

  const applyAndRefresh = async (path, body, label) => {
    if (await post(path, body, label)) await loadDetail(selectedId)
  }

  // Several products map to one firmware personality, so the model is recorded
  // locally before the PLC is told which personality to run.
  const applyModel = async (modelId) => {
    const model = modelById(modelId)
    if (!model) return
    if (modelKey) window.localStorage.setItem(modelKey, model.id)
    setSavedModelId(model.id)
    setSelection(null)
    await applyAndRefresh('/machine_type', { machine_type: model.firmware }, 'Set machine')
  }

  const draftKey = (unitType, number) => `${unitType}:${number}`

  const stageChange = (unitType, number, values) => {
    setDraft((d) => ({ ...d, [draftKey(unitType, number)]: { unit_type: unitType, number, ...values } }))
  }

  const clearDraft = () => setDraft({})

  const draftCount = Object.keys(draft).length

  const applyDraft = async () => {
    if (draftCount === 0) return
    setBusy('Apply changes')
    try {
      const res = await authFetch(`${API}/${selectedId}/configuration`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ changes: Object.values(draft) }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.success !== false) {
        toast.success(data.message || 'Changes applied')
        clearDraft()
        await loadDetail(selectedId)
      } else {
        toast.error(data.message || data.error || 'Could not apply changes')
      }
    } finally { setBusy('') }
  }

  const saveProfile = async () => {
    const name = window.prompt('Save the current settings as a profile named:')
    if (!name) return
    const res = await authFetch(`${API}/${selectedId}/profiles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, model_id: layout?.id }),
    })
    const data = await res.json().catch(() => ({}))
    if (res.status === 409) {
      if (!window.confirm(`${data.error}. Overwrite it?`)) return
      const again = await authFetch(`${API}/${selectedId}/profiles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, model_id: layout?.id, overwrite: true }),
      })
      if (!again.ok) { toast.error('Could not save profile'); return }
    } else if (!res.ok) {
      toast.error(data.error || 'Could not save profile'); return
    }
    toast.success(`Saved profile '${name}'`)
    loadProfiles()
  }

  const applyProfile = async () => {
    if (!chosenProfileId) return
    const profile = profiles.find((p) => String(p.id) === String(chosenProfileId))
    if (!window.confirm(`Apply '${profile?.name}' to this PLC? Current settings will be replaced.`)) return
    setBusy('Apply profile')
    try {
      const res = await authFetch(`${API}/${selectedId}/profiles/${chosenProfileId}/apply`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.success !== false) {
        if (data.model_id && modelKey) window.localStorage.setItem(modelKey, data.model_id)
        // Remembered so a test started later can record which profile was used,
        // even if the backend has been restarted since.
        if (data.profile_name && selected?.mac_address) {
          window.localStorage.setItem(`plc-profile:${selected.mac_address}`, data.profile_name)
        }
        toast.success(data.message || 'Profile applied')
        await loadDetail(selectedId)
      } else {
        toast.error(data.message || data.error || 'Could not apply profile')
      }
    } finally { setBusy('') }
  }

  const deleteProfile = async () => {
    if (!chosenProfileId) return
    const profile = profiles.find((p) => String(p.id) === String(chosenProfileId))
    if (!window.confirm(`Delete profile '${profile?.name}'? This cannot be undone.`)) return
    const res = await authFetch(`${API}/profiles/${chosenProfileId}`, { method: 'DELETE' })
    if (res.ok) {
      toast.success(`Deleted '${profile?.name}'`)
      setChosenProfileId('')
      loadProfiles()
    } else {
      toast.error('Could not delete profile')
    }
  }

  return (
    <div className="space-y-4 p-4 sm:p-6">
      {/* Title, device picker, sensor notice and refresh all share one row so the
          notice does not push the machine down the page. */}
      <div className="flex flex-wrap items-center gap-3">
        {initialParams?.returnView && (
          <button
            onClick={() => window.dispatchEvent(new CustomEvent('app:navigate', {
              detail: { view: initialParams.returnView },
            }))}
            className={`${subtleButtonClass} shrink-0`}
          >
            <ArrowLeft size={14} /> Back
          </button>
        )}
        <h1 className="shrink-0 text-xl font-semibold text-gray-900 dark:text-white">PLC</h1>

        {selected && (
          <select
            className="shrink-0 rounded-lg border border-gray-300 bg-white px-2 py-1 text-sm text-gray-700 focus:border-blue-500 focus:outline-none disabled:cursor-default dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
            value={selectedId ?? ''}
            onChange={(e) => { setSelectedId(Number(e.target.value)); setSelection(null); clearDraft() }}
            disabled={connectedPlcs.length < 2}
            title={connectedPlcs.length < 2 ? 'Only one PLC is connected' : 'Switch PLC'}
          >
            {(connectedPlcs.length ? connectedPlcs : [selected]).map((p) => (
              <option key={p.device_id} value={p.device_id}>
                {p.device_id === selectedId ? (info?.device_name ?? p.name) : p.name}
              </option>
            ))}
          </select>
        )}

        <div className="min-w-0 flex-1"><SensorWarning sensors={sensors} /></div>

        <button className={`${subtleButtonClass} shrink-0`}
                onClick={() => { loadList(); if (selectedId && connected) loadDetail(selectedId) }}>
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {connectedPlcs.length === 0 && !selected && (
        <p className="text-xs text-gray-500 dark:text-slate-400">
          No PLC is connected. Plug one in over USB and it will be detected automatically.
        </p>
      )}

      {selected && !connected && (
        <div className="flex items-start gap-2 rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-xs text-gray-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
          <Unplug size={14} className="mt-0.5 shrink-0" />
          <span>
            {selected.name} is not connected. Check the USB or RS232 lead — it will be
            picked up again automatically.
          </span>
        </div>
      )}

      {connected && (
        <>
          {machineType && pending?.active_test_id && (
            <div className="rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-xs text-green-800 dark:border-green-700 dark:bg-green-950 dark:text-green-200">
              Logging to <span className="font-medium">{pending.active_test_name || `test ${pending.active_test_id}`}</span>.
              Changes take effect immediately and are recorded in the test's configuration history.
            </div>
          )}

          {!machineType && (
            <Card title="Set up this PLC" icon={Wrench}>
              <p className="mb-2 text-xs text-gray-500 dark:text-slate-400">
                Choose which machine this PLC drives. It is remembered from then on —
                changing it later is done from Settings.
              </p>
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-48 flex-1">
                  <select className={inputClass} value={chosenModelId}
                          onChange={(e) => setChosenModelId(e.target.value)}>
                    <option value="">Select…</option>
                    {modelOptions.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                  </select>
                </div>
                <button className={buttonClass} disabled={!chosenModelId || busy !== ''}
                        onClick={() => applyModel(chosenModelId)}>
                  {busy === 'Set machine' ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                  Apply
                </button>
              </div>
            </Card>
          )}

          {loading && (
            <div className="flex justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-blue-600 dark:text-blue-400" />
            </div>
          )}

          {machineType && status && (
            <>
              {/* One panel: the machine on the left, a shaded control column on
                  the right so selecting something never pushes its settings
                  below the fold. */}
              <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-900">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 px-4 py-3 dark:border-slate-700">
                  <h3 className="flex flex-wrap items-baseline gap-2 text-sm font-semibold text-gray-900 dark:text-white">
                    {layout ? layout.label : machineType}
                    <button
                      onClick={() => setShowFullConfig(true)}
                      className="flex items-center gap-1 rounded-md border border-gray-300 px-2 py-0.5 text-xs font-normal text-gray-600 transition-colors hover:bg-gray-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
                    >
                      <Table2 size={12} /> Full configuration
                    </button>
                    {info?.machine_counts && (
                      <span className="text-xs font-normal text-gray-500 dark:text-slate-400">
                        {info.machine_counts.heaters} heaters · {info.machine_counts.mixers} mixers ·{' '}
                        {info.machine_counts.agitators} agitators · {info.machine_counts.feeders} feeders
                      </span>
                    )}
                  </h3>
                  <div className="flex flex-wrap items-center gap-2">
                    {/* Profiles: reusable machine settings, saved from this PLC
                        and replayable onto any PLC running the same machine. */}
                    <select
                      className="rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-700 focus:border-blue-500 focus:outline-none dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
                      value={chosenProfileId}
                      onChange={(e) => setChosenProfileId(e.target.value)}
                    >
                      <option value="">Profile…</option>
                      {profiles.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}{p.machine_type !== machineType ? ` (${p.machine_type})` : ''}
                        </option>
                      ))}
                    </select>
                    <button className={subtleButtonClass} disabled={!chosenProfileId || busy !== ''}
                            onClick={applyProfile}>
                      {busy === 'Apply profile' ? <Loader2 size={14} className="animate-spin" /> : <FolderOpen size={14} />}
                      Load
                    </button>
                    <button className={subtleButtonClass} disabled={busy !== ''} onClick={saveProfile}>
                      <Save size={14} /> Save as…
                    </button>
                    <button className={`${subtleButtonClass} text-red-600 dark:text-red-400`}
                            disabled={!chosenProfileId || busy !== ''} onClick={deleteProfile}>
                      <Trash2 size={14} /> Delete
                    </button>

                  </div>
                </div>

                {status.maintenance_mode && (
                  <p className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
                    This machine is in maintenance mode: outputs are under manual control and
                    its schedules are not running. Leave it from Settings → PLC.
                  </p>
                )}

                <div className="grid items-stretch xl:grid-cols-[minmax(0,1fr)_360px]">
                  <div className="flex items-center justify-center overflow-auto p-4" style={{ height: `${panelHeight}px` }}>
                    <PlcTree machineType={layout?.label || machineType} layout={layout}
                             status={status} selection={selection} onSelect={setSelection}
                             onMeasure={setTreeHeight} />
                  </div>

                  {/* A column that scrolls its contents but keeps the Apply bar
                      pinned to the bottom, so a tall reactor panel never pushes
                      it out of reach. */}
                  <div className="flex flex-col border-t border-gray-200 bg-gray-50 dark:border-slate-700 dark:bg-slate-800/50 xl:border-l xl:border-t-0"
                       style={{ height: `${panelHeight}px` }}>
                    <div className="min-h-0 flex-1 overflow-y-auto p-4">
                      <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                        Controls
                      </h4>
                      {selection?.type === 'reactor' && (
                        <ReactorPanel number={selection.number} status={status} layout={layout}
                                      sensors={sensors} onStage={stageChange} draft={draft} />
                      )}
                      {selection?.type === 'feeder' && (
                        <FeederPanel number={selection.number} status={status} layout={layout}
                                     onStage={stageChange} draft={draft} />
                      )}
                      {!selection && (
                        <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
                          <MousePointerClick size={20} className="text-gray-400 dark:text-slate-500" />
                          <p className="text-xs text-gray-500 dark:text-slate-400">
                            Select a reactor or feeder to configure it.
                          </p>
                        </div>
                      )}
                    </div>

                    {draftCount > 0 && (
                      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-amber-300 bg-amber-50 px-4 py-3 dark:border-amber-700 dark:bg-amber-950">
                        <span className="text-xs text-amber-800 dark:text-amber-200">
                          {draftCount} unapplied change{draftCount === 1 ? '' : 's'}
                        </span>
                        <div className="flex gap-2">
                          <button className={subtleButtonClass} disabled={busy !== ''} onClick={clearDraft}>
                            Discard
                          </button>
                          <button className={buttonClass} disabled={busy !== ''} onClick={applyDraft}>
                            {busy === 'Apply changes'
                              ? <Loader2 size={14} className="animate-spin" />
                              : <Check size={14} />}
                            Apply all
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}

          {machineType && !status && !loading && (
            <p className="text-xs text-gray-500 dark:text-slate-400">The PLC did not return a status.</p>
          )}

          <PlcConfigView
            open={showFullConfig}
            onClose={() => setShowFullConfig(false)}
            machineLabel={layout?.label || machineType}
            deviceName={info?.device_name ?? selected?.name}
            layout={layout}
            status={status}
            sensors={sensors}
          />
        </>
      )}
    </div>
  )
}
