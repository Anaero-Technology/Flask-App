// Formatting helpers for the per-user time display preference
// (user.time_display: 'local' | 'utc').
//
// All backend timestamps are UTC: DateTime columns serialize as naive ISO
// strings (no timezone offset) and device data arrives as epoch seconds.
// The 'YYYY-MM-DD HH:MM:SS' output format matches the backend's CSV exports
// so on-screen values and downloaded files always agree.

const pad = (n) => String(n).padStart(2, '0')

// Accepts epoch seconds, an ISO string from the backend, or a Date.
export function toUtcDate(value) {
  if (value === null || value === undefined || value === '') return null
  if (value instanceof Date) return value
  if (typeof value === 'number') return new Date(value * 1000)
  // Naive ISO datetimes from the backend are UTC; mark them explicitly so
  // the browser doesn't parse them as local time
  if (typeof value === 'string' && value.includes('T') && !/(Z|[+-]\d{2}:?\d{2})$/.test(value)) {
    return new Date(value + 'Z')
  }
  return new Date(value)
}

const dateParts = (date, utc) => utc
  ? [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()]
  : [date.getFullYear(), date.getMonth() + 1, date.getDate()]

const timeParts = (date, utc) => utc
  ? [date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds()]
  : [date.getHours(), date.getMinutes(), date.getSeconds()]

// 'YYYY-MM-DD HH:MM:SS', suffixed with ' UTC' when the preference is 'utc'
export function formatDateTime(value, timeDisplay = 'local') {
  const date = toUtcDate(value)
  if (!date || isNaN(date.getTime())) return '-'
  const utc = timeDisplay === 'utc'
  const [y, mo, d] = dateParts(date, utc)
  const [h, mi, s] = timeParts(date, utc)
  return `${y}-${pad(mo)}-${pad(d)} ${pad(h)}:${pad(mi)}:${pad(s)}${utc ? ' UTC' : ''}`
}

// 'YYYY-MM-DD', suffixed with ' UTC' when the preference is 'utc'
export function formatDate(value, timeDisplay = 'local') {
  const date = toUtcDate(value)
  if (!date || isNaN(date.getTime())) return '-'
  const utc = timeDisplay === 'utc'
  const [y, mo, d] = dateParts(date, utc)
  return `${y}-${pad(mo)}-${pad(d)}${utc ? ' UTC' : ''}`
}

// 'HH:MM:SS', suffixed with ' UTC' when the preference is 'utc'
export function formatTime(value, timeDisplay = 'local') {
  const date = toUtcDate(value)
  if (!date || isNaN(date.getTime())) return '-'
  const utc = timeDisplay === 'utc'
  const [h, mi, s] = timeParts(date, utc)
  return `${pad(h)}:${pad(mi)}:${pad(s)}${utc ? ' UTC' : ''}`
}

// Query-string fragment for server-side CSV exports: the server cannot know
// the browser timezone, so 'local' passes the IANA zone as ?tz=... while
// 'utc' needs no parameter.
export function tzQueryParam(timeDisplay, separator = '?') {
  if (timeDisplay === 'utc') return ''
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  return zone ? `${separator}tz=${encodeURIComponent(zone)}` : ''
}
