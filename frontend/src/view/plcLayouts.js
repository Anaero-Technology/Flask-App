//
// The machines as they are sold, and how each one is plumbed.
//
//   firmware:   the token systemset accepts
//   feeders:    [feeder number, [reactors it serves]]
//   downstream: { downstream reactor: upstream reactor }
//
// Several products share one firmware personality, because the PLC only needs
// to know how many outputs to drive. Ray and Ray-I are both "ray" - same two
// reactors, differing only in whether one feeder serves both or each has its
// own. Lobster-I runs the "max" personality. The firmware cannot tell these
// apart - it reports the same unit counts for every build - so the model is
// remembered per device, and the first one listed is the default.
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
    firmware: 'ray',
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
    firmware: 'max',
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

// Models the connected PLC can actually run, given the personalities its
// firmware reports.
export function modelsAvailable(firmwareTypes) {
  if (!firmwareTypes || firmwareTypes.length === 0) return machineModels
  return machineModels.filter((m) => firmwareTypes.includes(m.firmware))
}

export function modelById(id) {
  return machineModels.find((m) => m.id === id) || null
}

//
// Work out which model is running. The PLC only reports its personality, so an
// explicit choice wins, then the model whose feeder count matches, then the
// first product using that personality.
//
export function resolveModel(firmwareType, feederCount, preferredId) {
  if (!firmwareType) return null
  const candidates = machineModels.filter((m) => m.firmware === firmwareType)
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
