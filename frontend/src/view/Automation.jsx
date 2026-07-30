import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../components/AuthContext'
import { useToast } from '../components/Toast'
import ConfirmDialog from '../components/ConfirmDialog'
import { formatGasName } from '../utils/gasNames'
import {
  Zap, ZapOff, Loader2, Plus, Pencil, Trash2, FlaskConical, X,
  Activity, AlertTriangle, Check, Gauge, History
} from 'lucide-react'

const API = '/api/v1/automation'

const inputClass =
  'w-full rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-xs text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:bg-gray-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:disabled:bg-slate-800'
const buttonClass =
  'flex items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-400'
const subtleButtonClass =
  'flex items-center justify-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'

// What each measurement source is called and measured in, for summaries and
// the editor's value labels.
const SOURCE_META = {
  chimera_gas: { label: 'Gas concentration (Chimera)', unit: '%' },
  blackbox_volume: { label: 'Gas production (BlackBox)', unit: 'ml' },
  plc_temperature: { label: 'Reactor temperature (PLC)', unit: '°C' },
}

// Operator tokens the backend understands, shown as symbols.
const OPERATORS = [['gt', '>'], ['gte', '≥'], ['lt', '<'], ['lte', '≤']]

// Human names for the PLC parameters a rule can drive.
const PARAM_LABELS = {
  'heater.target': 'target temperature (°C)',
  'feeder.on_for': 'feed time (s per feed)',
  'feeder.off_for_minutes': 'feed interval (min)',
  'mixer.on_for': 'mixing on-time (s)',
  'mixer.off_for': 'mixing off-time (s)',
  'agitator.pre_feed': 'pre-feed agitation (s)',
}

const paramLabel = (unitType, parameter) =>
  PARAM_LABELS[`${unitType}.${parameter}`] || `${unitType} ${parameter}`

const opSymbol = (op) => (OPERATORS.find(([token]) => token === op) || [op, op])[1]

function conditionText(rule, deviceName) {
  const meta = SOURCE_META[rule.source_type] || { unit: '' }
  const what = rule.source_type === 'chimera_gas'
    ? `${formatGasName(rule.gas_name)} on ${deviceName} ch ${rule.source_channel}`
    : rule.source_type === 'blackbox_volume'
      ? `volume from ${deviceName} ch ${rule.source_channel}`
      : `reactor ${rule.source_channel} on ${deviceName}`
  const window = rule.source_type === 'blackbox_volume'
    ? ` over ${rule.window_minutes || 60} min`
    : rule.window_minutes > 0 ? ` (avg ${rule.window_minutes} min)` : ''
  return `${what}${window} ${opSymbol(rule.operator)} ${rule.threshold}${meta.unit}`
}

function actionText(rule, deviceName) {
  const param = paramLabel(rule.unit_type, rule.parameter)
  const verb = rule.action_type === 'set'
    ? `set to ${rule.amount}`
    : `${rule.action_type} by ${rule.amount}`
  return `${verb} ${rule.unit_type} ${rule.unit_number} ${param} on ${deviceName}` +
    ` · clamped to ${rule.min_value}–${rule.max_value}`
}

const OUTCOME_STYLES = {
  fired: 'bg-green-100 text-green-800 dark:bg-green-500/10 dark:text-green-300',
  clamped: 'bg-amber-100 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300',
  failed: 'bg-red-100 text-red-800 dark:bg-red-500/10 dark:text-red-300',
}

function OutcomeBadge({ outcome }) {
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${OUTCOME_STYLES[outcome] || 'bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-slate-300'}`}>
      {outcome}
    </span>
  )
}

function Field({ label, children }) {
  return (
    <div>
      <label className="mb-1 block text-xs text-gray-500 dark:text-slate-400">{label}</label>
      {children}
    </div>
  )
}

const EMPTY_RULE = {
  name: '',
  source_type: 'chimera_gas',
  source_device_id: '',
  source_channel: 1,
  gas_name: '',
  window_minutes: 0,
  operator: 'gt',
  threshold: '',
  target_device_id: '',
  unit_type: 'feeder',
  unit_number: 1,
  parameter: 'on_for',
  action_type: 'increase',
  amount: '',
  min_value: '',
  max_value: '',
  cooldown_minutes: 60,
}

// ----------------------------------------------------------------------
// Rule editor overlay (PlcConfigView pattern: backdrop click + Escape close)
// ----------------------------------------------------------------------
function RuleEditor({ open, onClose, onSaved, rule, options }) {
  const { authFetch } = useAuth()
  const toast = useToast()
  const [form, setForm] = useState(EMPTY_RULE)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  useEffect(() => {
    if (!open) return
    if (rule) {
      setForm({ ...rule, cooldown_minutes: Math.round(rule.cooldown_seconds / 60) })
    } else {
      const firstPlc = options?.plcs?.[0]
      const firstChimera = options?.chimeras?.[0]
      setForm({
        ...EMPTY_RULE,
        source_device_id: firstChimera?.device_id ?? '',
        gas_name: firstChimera?.gas_names?.[0] ?? '',
        target_device_id: firstPlc?.device_id ?? '',
      })
    }
  }, [open, rule, options])

  if (!open) return null

  const set = (field) => (value) => setForm((f) => ({ ...f, [field]: value }))

  const sourceDevices = form.source_type === 'chimera_gas' ? options?.chimeras
    : form.source_type === 'blackbox_volume' ? options?.black_boxes
      : options?.plcs
  const sourceChimera = options?.chimeras?.find(
    (c) => c.device_id === Number(form.source_device_id))
  const targetPlc = options?.plcs?.find(
    (p) => p.device_id === Number(form.target_device_id))
  const unitCount = targetPlc?.machine_counts?.[`${form.unit_type}s`] ?? 0
  const parameters = options?.unit_parameters?.[form.unit_type] || []
  const meta = SOURCE_META[form.source_type]

  const changeSourceType = (type) => {
    const devices = type === 'chimera_gas' ? options?.chimeras
      : type === 'blackbox_volume' ? options?.black_boxes : options?.plcs
    setForm((f) => ({
      ...f,
      source_type: type,
      source_device_id: devices?.[0]?.device_id ?? '',
      window_minutes: type === 'blackbox_volume' ? 60 : 0,
    }))
  }

  const changeUnitType = (type) => {
    setForm((f) => ({
      ...f,
      unit_type: type,
      parameter: (options?.unit_parameters?.[type] || [])[0] || '',
      unit_number: 1,
    }))
  }

  const save = async () => {
    setSaving(true)
    try {
      const payload = {
        name: form.name,
        source_type: form.source_type,
        source_device_id: Number(form.source_device_id),
        source_channel: Number(form.source_channel),
        gas_name: form.source_type === 'chimera_gas' ? form.gas_name : null,
        window_minutes: Number(form.window_minutes) || 0,
        operator: form.operator,
        threshold: Number(form.threshold),
        target_device_id: Number(form.target_device_id),
        unit_type: form.unit_type,
        unit_number: Number(form.unit_number),
        parameter: form.parameter,
        action_type: form.action_type,
        amount: Number(form.amount),
        min_value: Number(form.min_value),
        max_value: Number(form.max_value),
        cooldown_seconds: Math.max(60, Number(form.cooldown_minutes) * 60),
      }
      const res = await authFetch(
        rule ? `${API}/rules/${rule.id}` : `${API}/rules`,
        {
          method: rule ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'Could not save the rule')
        return
      }
      toast.success(rule ? 'Rule updated' : 'Rule created')
      onSaved()
      onClose()
    } catch {
      toast.error('Could not save the rule')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose} role="dialog" aria-modal="true" aria-label="Automation rule editor"
    >
      <div
        className="max-h-full w-full max-w-2xl overflow-y-auto rounded-xl bg-white shadow-xl dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-slate-700">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
            {rule ? `Edit rule — ${rule.name}` : 'New automation rule'}
          </h3>
          <button onClick={onClose} aria-label="Close"
                  className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 dark:text-slate-400 dark:hover:bg-slate-800">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-5 p-4">
          <Field label="Rule name">
            <input className={inputClass} value={form.name} placeholder="e.g. Feed more when methane is high"
                   onChange={(e) => set('name')(e.target.value)} />
          </Field>

          {/* When: the measurement and threshold */}
          <div>
            <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
              <Gauge size={13} /> When
            </h4>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Field label="Measurement">
                <select className={inputClass} value={form.source_type}
                        onChange={(e) => changeSourceType(e.target.value)}>
                  {Object.entries(SOURCE_META).map(([v, m]) => (
                    <option key={v} value={v}>{m.label}</option>
                  ))}
                </select>
              </Field>
              <Field label="Device">
                <select className={inputClass} value={form.source_device_id}
                        onChange={(e) => set('source_device_id')(e.target.value)}>
                  {(sourceDevices || []).map((d) => (
                    <option key={d.device_id} value={d.device_id}>{d.name}</option>
                  ))}
                </select>
              </Field>
              <Field label={form.source_type === 'plc_temperature' ? 'Reactor' : 'Channel'}>
                <input type="number" min={1} max={15} className={inputClass}
                       value={form.source_channel}
                       onChange={(e) => set('source_channel')(e.target.value)} />
              </Field>
              {form.source_type === 'chimera_gas' && (
                <Field label="Gas">
                  <input className={inputClass} value={form.gas_name} list="automation-gas-names"
                         placeholder="CH4" onChange={(e) => set('gas_name')(e.target.value)} />
                  <datalist id="automation-gas-names">
                    {(sourceChimera?.gas_names || []).map((g) => <option key={g} value={g} />)}
                  </datalist>
                </Field>
              )}
              {form.source_type !== 'plc_temperature' && (
                <Field label={form.source_type === 'blackbox_volume'
                  ? 'Window (min)' : 'Average over (min, 0 = latest)'}>
                  <input type="number" min={0} className={inputClass} value={form.window_minutes}
                         onChange={(e) => set('window_minutes')(e.target.value)} />
                </Field>
              )}
              <Field label="Condition">
                <div className="flex gap-2">
                  <select className={`${inputClass} w-16`} value={form.operator}
                          onChange={(e) => set('operator')(e.target.value)}>
                    {OPERATORS.map(([v, s]) => <option key={v} value={v}>{s}</option>)}
                  </select>
                  <input type="number" step="any" className={inputClass} value={form.threshold}
                         placeholder={meta.unit} onChange={(e) => set('threshold')(e.target.value)} />
                </div>
              </Field>
            </div>
          </div>

          {/* Then: the PLC adjustment */}
          <div>
            <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
              <Zap size={13} /> Then
            </h4>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Field label="PLC">
                <select className={inputClass} value={form.target_device_id}
                        onChange={(e) => set('target_device_id')(e.target.value)}>
                  {(options?.plcs || []).map((p) => (
                    <option key={p.device_id} value={p.device_id}>
                      {p.name}{p.machine_type ? ` (${p.machine_type})` : ''}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Unit">
                <select className={inputClass} value={form.unit_type}
                        onChange={(e) => changeUnitType(e.target.value)}>
                  {Object.keys(options?.unit_parameters || {}).map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </Field>
              <Field label={`Number${unitCount ? ` (1–${unitCount})` : ''}`}>
                <input type="number" min={1} max={unitCount || 15} className={inputClass}
                       value={form.unit_number}
                       onChange={(e) => set('unit_number')(e.target.value)} />
              </Field>
              <Field label="Setting to change">
                <select className={inputClass} value={form.parameter}
                        onChange={(e) => set('parameter')(e.target.value)}>
                  {parameters.map((p) => (
                    <option key={p} value={p}>{paramLabel(form.unit_type, p)}</option>
                  ))}
                </select>
              </Field>
              <Field label="Adjustment">
                <div className="flex gap-2">
                  <select className={`${inputClass} w-28`} value={form.action_type}
                          onChange={(e) => set('action_type')(e.target.value)}>
                    <option value="increase">increase by</option>
                    <option value="decrease">decrease by</option>
                    <option value="set">set to</option>
                  </select>
                  <input type="number" step="any" className={inputClass} value={form.amount}
                         onChange={(e) => set('amount')(e.target.value)} />
                </div>
              </Field>
              <Field label="Cooldown (min)">
                <input type="number" min={1} className={inputClass} value={form.cooldown_minutes}
                       onChange={(e) => set('cooldown_minutes')(e.target.value)} />
              </Field>
            </div>
          </div>

          {/* Safety clamps: the range the rule may never leave */}
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950">
            <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-amber-800 dark:text-amber-200">
              <AlertTriangle size={13} /> Safety limits
            </h4>
            <p className="mb-2 text-xs text-amber-700 dark:text-amber-300">
              The rule can never move the setting outside this range, no matter how often it fires.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Never below">
                <input type="number" step="any" className={inputClass} value={form.min_value}
                       onChange={(e) => set('min_value')(e.target.value)} />
              </Field>
              <Field label="Never above">
                <input type="number" step="any" className={inputClass} value={form.max_value}
                       onChange={(e) => set('max_value')(e.target.value)} />
              </Field>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-gray-200 px-4 py-3 dark:border-slate-700">
          <button className={subtleButtonClass} onClick={onClose}>Cancel</button>
          <button className={buttonClass} onClick={save} disabled={saving}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            {rule ? 'Save changes' : 'Create rule'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ----------------------------------------------------------------------
// Page
// ----------------------------------------------------------------------
export default function Automation() {
  const { authFetch, canPerform } = useAuth()
  const toast = useToast()
  const canWrite = canPerform('modify_test')

  const [rules, setRules] = useState(null)
  const [events, setEvents] = useState([])
  const [options, setOptions] = useState(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingRule, setEditingRule] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const [dryRun, setDryRun] = useState({})   // rule id -> result

  const load = useCallback(async () => {
    try {
      const [rulesRes, eventsRes] = await Promise.all([
        authFetch(`${API}/rules`),
        authFetch(`${API}/events?limit=50`),
      ])
      if (rulesRes.ok) setRules((await rulesRes.json()).rules)
      if (eventsRes.ok) setEvents((await eventsRes.json()).events)
    } catch { /* next poll retries */ }
  }, [authFetch])

  const loadOptions = useCallback(async () => {
    try {
      const res = await authFetch(`${API}/options`)
      if (res.ok) setOptions(await res.json())
    } catch { /* next poll retries */ }
  }, [authFetch])

  useEffect(() => {
    load()
    loadOptions()
    const timer = setInterval(load, 10000)
    const optionsTimer = setInterval(loadOptions, 30000)
    return () => { clearInterval(timer); clearInterval(optionsTimer) }
  }, [load, loadOptions])

  // Names for every device the rules reference, connected or not.
  const deviceName = (id) => {
    for (const list of [options?.chimeras, options?.black_boxes, options?.plcs]) {
      const d = (list || []).find((x) => x.device_id === id)
      if (d) return d.name
    }
    return `device ${id}`
  }

  const ruleEvents = (ruleId) => events.filter((e) => e.rule_id === ruleId)

  const toggleRule = async (rule) => {
    try {
      const res = await authFetch(`${API}/rules/${rule.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !rule.enabled }),
      })
      if (res.ok) {
        toast.success(rule.enabled ? `'${rule.name}' paused` : `'${rule.name}' enabled`)
        load()
      } else {
        toast.error((await res.json()).error || 'Could not update the rule')
      }
    } catch {
      toast.error('Could not update the rule')
    }
  }

  const deleteRule = async () => {
    const rule = deleting
    setDeleting(null)
    try {
      const res = await authFetch(`${API}/rules/${rule.id}`, { method: 'DELETE' })
      if (res.ok) {
        toast.success(`Deleted '${rule.name}'`)
        load()
      } else {
        toast.error((await res.json()).error || 'Could not delete the rule')
      }
    } catch {
      toast.error('Could not delete the rule')
    }
  }

  const runDry = async (rule) => {
    setDryRun((d) => ({ ...d, [rule.id]: { loading: true } }))
    try {
      const res = await authFetch(`${API}/rules/${rule.id}/dry_run`, { method: 'POST' })
      const data = await res.json()
      setDryRun((d) => ({ ...d, [rule.id]: res.ok ? data : { message: data.error } }))
    } catch {
      setDryRun((d) => ({ ...d, [rule.id]: { message: 'Dry run failed' } }))
    }
  }

  if (rules === null) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-blue-600 dark:text-blue-300" />
      </div>
    )
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold text-gray-900 dark:text-white">
            <Zap size={20} className="text-blue-600 dark:text-blue-400" /> Automation
          </h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">
            Rules that watch live measurements and adjust the machine — dynamic experiments
            that run themselves. Changes land on a running test's configuration timeline
            like any hand edit.
          </p>
        </div>
        {canWrite && (
          <button className={buttonClass}
                  onClick={() => { setEditingRule(null); setEditorOpen(true) }}
                  disabled={!options?.plcs?.length}
                  title={options?.plcs?.length ? undefined : 'Connect a PLC to create rules'}>
            <Plus size={14} /> New rule
          </button>
        )}
      </div>

      {rules.length === 0 && (
        <div className="rounded-xl border border-dashed border-gray-300 p-10 text-center dark:border-slate-700">
          <Activity size={28} className="mx-auto mb-3 text-gray-400 dark:text-slate-500" />
          <p className="text-sm text-gray-600 dark:text-slate-300">
            No automation rules yet.
          </p>
          <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
            Example: when CH₄ on the Chimera stays above 55%, increase the feeder's
            feed time by 5 seconds — but never beyond 60.
          </p>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {rules.map((rule) => {
          const dry = dryRun[rule.id]
          const recent = ruleEvents(rule.id)
          return (
            <div key={rule.id}
                 className={`rounded-xl border bg-white p-4 dark:bg-slate-900 ${rule.enabled
                   ? 'border-gray-200 dark:border-slate-700'
                   : 'border-gray-200 opacity-60 dark:border-slate-700'}`}>
              <div className="mb-2 flex items-start justify-between gap-2">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
                  {rule.enabled
                    ? <Zap size={15} className="shrink-0 text-green-600 dark:text-green-400" />
                    : <ZapOff size={15} className="shrink-0 text-gray-400 dark:text-slate-500" />}
                  {rule.name}
                </h3>
                {canWrite && (
                  <div className="flex shrink-0 items-center gap-1">
                    <button className={subtleButtonClass} onClick={() => toggleRule(rule)}>
                      {rule.enabled ? 'Pause' : 'Enable'}
                    </button>
                    <button aria-label="Edit rule"
                            className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 dark:text-slate-400 dark:hover:bg-slate-800"
                            onClick={() => { setEditingRule(rule); setEditorOpen(true) }}>
                      <Pencil size={14} />
                    </button>
                    <button aria-label="Delete rule"
                            className="rounded-lg p-1.5 text-gray-500 hover:bg-red-50 hover:text-red-600 dark:text-slate-400 dark:hover:bg-red-500/10"
                            onClick={() => setDeleting(rule)}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                )}
              </div>

              <div className="space-y-1 text-xs text-gray-600 dark:text-slate-300">
                <p><span className="font-medium text-gray-500 dark:text-slate-400">When</span>{' '}
                  {conditionText(rule, deviceName(rule.source_device_id))}</p>
                <p><span className="font-medium text-gray-500 dark:text-slate-400">Then</span>{' '}
                  {actionText(rule, deviceName(rule.target_device_id))}</p>
                <p className="text-gray-500 dark:text-slate-400">
                  Cooldown {Math.round(rule.cooldown_seconds / 60)} min
                  {rule.last_triggered_at &&
                    ` · last acted ${new Date(rule.last_triggered_at + 'Z').toLocaleString()}`}
                </p>
              </div>

              {canWrite && (
                <div className="mt-3 flex items-center gap-2">
                  <button className={subtleButtonClass} onClick={() => runDry(rule)}>
                    {dry?.loading
                      ? <Loader2 size={13} className="animate-spin" />
                      : <FlaskConical size={13} />}
                    Dry run
                  </button>
                  {dry && !dry.loading && (
                    <span className="text-xs text-gray-600 dark:text-slate-300">
                      {dry.outcome === 'would_fire' && '⚡ '}{dry.message}
                    </span>
                  )}
                </div>
              )}

              {recent.length > 0 && (
                <div className="mt-3 border-t border-gray-100 pt-2 dark:border-slate-800">
                  {recent.slice(0, 3).map((e) => (
                    <div key={e.id} className="flex items-baseline gap-2 py-0.5 text-xs">
                      <OutcomeBadge outcome={e.outcome} />
                      <span className="truncate text-gray-500 dark:text-slate-400" title={e.message}>
                        {e.message}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Full activity log */}
      {events.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-900">
          <h3 className="flex items-center gap-2 border-b border-gray-200 px-4 py-3 text-sm font-semibold text-gray-900 dark:border-slate-700 dark:text-white">
            <History size={15} className="text-blue-600 dark:text-blue-400" /> Recent activity
          </h3>
          <div className="max-h-80 overflow-y-auto">
            <table className="w-full border-collapse">
              <thead className="border-b border-gray-200 dark:border-slate-700">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 dark:text-slate-400">Time</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 dark:text-slate-400">Rule</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 dark:text-slate-400">Outcome</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 dark:text-slate-400">Detail</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                {events.map((e) => {
                  const rule = rules.find((r) => r.id === e.rule_id)
                  return (
                    <tr key={e.id}>
                      <td className="whitespace-nowrap px-4 py-1.5 text-xs text-gray-500 dark:text-slate-400">
                        {new Date(e.created_at + 'Z').toLocaleString()}
                      </td>
                      <td className="px-4 py-1.5 text-xs font-medium text-gray-900 dark:text-slate-100">
                        {rule?.name || `rule ${e.rule_id}`}
                      </td>
                      <td className="px-4 py-1.5"><OutcomeBadge outcome={e.outcome} /></td>
                      <td className="px-4 py-1.5 text-xs text-gray-600 dark:text-slate-300">{e.message}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <RuleEditor
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        onSaved={load}
        rule={editingRule}
        options={options}
      />

      <ConfirmDialog
        isOpen={!!deleting}
        title="Delete automation rule"
        message={`Delete '${deleting?.name}'? Its activity history is kept, but the rule stops acting immediately.`}
        confirmText="Delete"
        danger
        onConfirm={deleteRule}
        onCancel={() => setDeleting(null)}
      />
    </div>
  )
}
