import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../components/AuthContext'
import { useToast } from '../components/Toast'
import { modelsAvailable, modelById, resolveModel } from './plcLayouts'
import { Loader2 } from 'lucide-react'
import PlcMaintenance from './PlcMaintenance'
import PlcFirmware from './PlcFirmware'
import PlcCalibration from './PlcCalibration'

const API = '/api/v1/plc'

const selectClass =
  'rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-xs text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:bg-gray-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200'

//
// Changing which machine a PLC drives re-runs its personality setup and leaves
// the previous machine's timings behind, so it is kept off the PLC page and
// confirmed with a password here - the same flow the destructive database
// actions use.
//
export default function PlcSettings({ requirePassword }) {
  const { authFetch } = useAuth()
  const toast = useToast()

  const [plcs, setPlcs] = useState([])
  const [firmwareTypes, setFirmwareTypes] = useState([])
  const [deviceId, setDeviceId] = useState(null)
  const [info, setInfo] = useState(null)
  const [chosenModelId, setChosenModelId] = useState('')
  const [busy, setBusy] = useState(false)

  const selected = plcs.find((p) => p.device_id === deviceId) || null
  const modelKey = selected?.mac_address ? `plc-model:${selected.mac_address}` : null
  const current = resolveModel(
    info?.machine_type,
    info?.machine_counts?.feeders,
    modelKey ? window.localStorage.getItem(modelKey) : null,
  )

  const load = useCallback(async () => {
    try {
      const [listRes, typesRes] = await Promise.all([
        authFetch(`${API}/connected`),
        authFetch(`${API}/machine_types`),
      ])
      const list = ((await listRes.json()).plcs || []).filter((p) => p.connected)
      setPlcs(list)
      setFirmwareTypes((await typesRes.json()).machine_types || [])
      setDeviceId((cur) => cur ?? (list[0]?.device_id ?? null))
    } catch {
      toast.error('Could not load PLCs')
    }
  }, [authFetch])

  useEffect(() => { load() }, [load])

  const refreshInfo = useCallback(async (id) => {
    if (!id) return
    try {
      const res = await authFetch(`${API}/${id}/info`)
      setInfo(res.ok ? await res.json() : null)
    } catch { setInfo(null) }
  }, [authFetch])

  useEffect(() => { refreshInfo(deviceId) }, [deviceId, refreshInfo])

  const changeMachine = async () => {
    const model = modelById(chosenModelId)
    if (!model) return

    const confirmed = await requirePassword(
      `Change ${selected?.name ?? 'this PLC'} to ${model.label}? This re-runs the PLC's setup and rediscovers its sensors.`
    )
    if (!confirmed) return

    setBusy(true)
    try {
      const res = await authFetch(`${API}/${deviceId}/machine_type`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ machine_type: model.firmware }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.success !== false) {
        if (modelKey) window.localStorage.setItem(modelKey, model.id)
        toast.success(`Machine changed to ${model.label}`)
        setChosenModelId('')
        await refreshInfo(deviceId)
      } else {
        toast.error(data.message || data.error || 'Could not change machine')
      }
    } catch {
      toast.error('Could not change machine')
    } finally {
      setBusy(false)
    }
  }

  if (plcs.length === 0) {
    return (
      <p className="text-[13px] text-gray-500 dark:text-slate-400">
        No PLC is connected.
      </p>
    )
  }

  return (
    <>
    <div className="grid grid-cols-1 gap-4 py-4 sm:grid-cols-[1fr_auto]">
      <div>
        <h3 className="text-sm font-medium text-gray-900 dark:text-white">Machine type</h3>
        <p className="mt-0.5 text-[13px] text-gray-500 dark:text-slate-400">
          Currently {current?.label ?? 'not configured'}. Changing it re-runs the PLC's
          setup and leaves the previous machine's timings in place.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {/* No overlaid icon here - a native select renders its own text and
            arrow, and anything positioned on top of it collides with them. */}
        <select
          className={selectClass}
          value={deviceId ?? ''}
          onChange={(e) => setDeviceId(Number(e.target.value))}
          disabled={plcs.length < 2}
          title={plcs.length < 2 ? 'Only one PLC is connected' : 'Choose PLC'}
        >
          {plcs.map((p) => (
            <option key={p.device_id} value={p.device_id}>{p.name}</option>
          ))}
        </select>

        <select className={selectClass} value={chosenModelId}
                onChange={(e) => setChosenModelId(e.target.value)}>
          <option value="">Change to…</option>
          {modelsAvailable(firmwareTypes)
            .filter((m) => m.id !== current?.id)
            .map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>

        <button
          onClick={changeMachine}
          disabled={!chosenModelId || busy}
          className="flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-400"
        >
          {busy && <Loader2 size={14} className="animate-spin" />}
          Change machine
        </button>
      </div>
    </div>

    <div className="border-t border-gray-200 dark:border-slate-800">
      <PlcMaintenance
        deviceId={deviceId}
        deviceName={selected?.name}
        layout={current}
      />
    </div>

    <div className="border-t border-gray-200 dark:border-slate-800">
      <PlcCalibration deviceId={deviceId} deviceName={selected?.name} />
    </div>

    <div className="border-t border-gray-200 dark:border-slate-800">
      <PlcFirmware
        deviceId={deviceId}
        deviceName={selected?.name}
        requirePassword={requirePassword}
      />
    </div>
    </>
  )
}
