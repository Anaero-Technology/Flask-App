//
// The machines as they are sold, and how each one is plumbed.
//
//   firmware:       the token systemset accepts
//   legacyFirmware: tokens older firmware used for this same machine
//   feeders:        [feeder number, [reactors it serves]]
//   downstream:     { downstream reactor: upstream reactor }
//
// Every model now has its own firmware personality, so a connected PLC
// identifies itself exactly. That was not always so: before ray-i was added
// the firmware had one "ray" covering both builds, and Lobster-I ran a
// personality called "max". A PLC that has not been reflashed still reports
// those older tokens, which is what legacyFirmware is for - and on that
// firmware Ray and Ray-I are genuinely indistinguishable, so the remembered
// per-device choice still decides between them.
//
export const machineModels = [
  {
    id: 'ray',
    label: 'Ray',
    firmware: 'ray',
    feeders: [[1, [1, 2]]],
  },
  {
    id: 'ray-i',
    label: 'Ray-I',
    firmware: 'ray-i',
    legacyFirmware: ['ray'],
    feeders: [[1, [1]], [2, [2]]],
  },
  {
    id: 'caterpillar',
    label: 'Caterpillar',
    firmware: 'caterpillar',
    feeders: [[1, [1, 2, 3, 4, 5]]],
  },
  {
    id: 'lobster',
    label: 'Lobster',
    firmware: 'lobster',
    feeders: [[1, [1, 2, 3]], [2, [4, 5, 6]]],
  },
  {
    id: 'lobster-i',
    label: 'Lobster-I',
    firmware: 'lobster-i',
    legacyFirmware: ['max'],
    feeders: [[1, [1]], [2, [2]], [3, [3]], [4, [4]]],
  },
  {
    id: 'blackswan',
    label: 'Black Swan',
    firmware: 'blackswan',
    //
    // Two stage machine: four first stage reactors, each fed by its own feeder
    // and each overflowing into one second stage reactor. Only stage one is fed
    // directly.
    //
    feeders: [[1, [1]], [2, [2]], [3, [3]], [4, [4]]],
    downstream: { 5: 1, 6: 2, 7: 3, 8: 4 },
  },
  {
    id: 'medusa',
    label: 'Medusa',
    firmware: 'medusa',
    feeders: [[1, [1, 2, 3, 4, 5]], [2, [6, 7, 8, 9, 10]]],
  },
]

// Every model that answers to a firmware token, current spelling first so it
// wins when both match.
function candidatesFor(firmwareType) {
  const exact = machineModels.filter((m) => m.firmware === firmwareType)
  const legacy = machineModels.filter(
    (m) => m.legacyFirmware?.includes(firmwareType) && !exact.includes(m))
  return [...exact, ...legacy]
}

// Models the connected PLC can actually run, given the personalities its
// firmware reports. Older firmware is matched through legacyFirmware, so a
// unit that has not been reflashed still offers the machine it really is.
export function modelsAvailable(firmwareTypes) {
  if (!firmwareTypes || firmwareTypes.length === 0) return machineModels
  return machineModels.filter((m) =>
    firmwareTypes.includes(m.firmware) ||
    m.legacyFirmware?.some((token) => firmwareTypes.includes(token)))
}

export function modelById(id) {
  return machineModels.find((m) => m.id === id) || null
}

//
// Work out which model is running. Current firmware names the machine exactly,
// so this is usually a single candidate. Pre-rename firmware is ambiguous for
// Ray and Ray-I, which both reported "ray"; there an explicit choice wins and
// the current spelling is the fallback.
//
export function resolveModel(firmwareType, feederCount, preferredId) {
  if (!firmwareType) return null
  const candidates = candidatesFor(firmwareType)
  if (candidates.length === 0) return null

  if (preferredId) {
    const chosen = candidates.find((m) => m.id === preferredId)
    if (chosen) return chosen
  }
  return candidates[0]
}

// Which feeder serves a reactor, following overflow back to the fed reactor if
// this one is downstream. Returns { number, viaReactor } or null.
export function feederForReactor(model, reactorNumber) {
  if (!model) return null
  const upstream = model.downstream?.[reactorNumber]
  const target = upstream ?? reactorNumber
  for (const [number, reactors] of model.feeders) {
    if (reactors.includes(target)) {
      return { number, viaReactor: upstream ? target : null }
    }
  }
  return null
}
