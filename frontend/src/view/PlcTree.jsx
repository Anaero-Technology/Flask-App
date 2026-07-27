import { useEffect, useMemo } from 'react'
import { hierarchy, tree as d3tree } from 'd3-hierarchy'

//
// The machine as a feed tree: the PLC drives feeders, each feeder serves a set
// of reactors, and each reactor carries its own heater, mixer and agitator.
// The top-down view shows where things sit; this shows what depends on what,
// which is the relationship that actually matters when scheduling a feed.
//
// Laid out with d3-hierarchy's tidy tree algorithm, drawn as plain SVG so it
// keeps the app's theming and stays clickable.
//

const NODE_W = 146
const NODE_H = 50
const H_GAP = 76          // horizontal gap between depths
const V_GAP = 12          // vertical gap between siblings

function buildTree(machineType, layout, status) {
  const findUnit = (list, n) => (list || []).find((u) => u.number === n)

  const reactorNumbers = [...new Set([
    ...(status.heaters || []).map((u) => u.number),
    ...(status.mixers || []).map((u) => u.number),
    ...(status.agitators || []).map((u) => u.number),
  ])].sort((a, b) => a - b)

  // A reactor that overflows into another carries it as a child, so a two stage
  // machine reads feeder -> stage 1 -> stage 2 down one branch.
  const downstreamOf = (n) => Object.entries(layout?.downstream || {})
    .filter(([, upstream]) => Number(upstream) === n)
    .map(([child]) => Number(child))
    .filter((child) => reactorNumbers.includes(child))
    .sort((a, b) => a - b)

  const isDownstream = new Set(
    Object.keys(layout?.downstream || {}).map(Number).filter((n) => reactorNumbers.includes(n))
  )

  const reactorNode = (n) => {
    const kids = downstreamOf(n)
    return {
      kind: 'reactor',
      number: n,
      stage: isDownstream.has(n) ? 2 : (kids.length > 0 ? 1 : null),
      heater: findUnit(status.heaters, n),
      mixer: findUnit(status.mixers, n),
      agitator: findUnit(status.agitators, n),
      children: kids.map(reactorNode),
    }
  }

  const claimed = new Set(isDownstream)
  const children = []

  // The firmware drives a fixed number of feeder relays regardless of the
  // model - a Ray reports two but only has one wired - so when the model
  // defines which feeders exist, only those are drawn. Without a layout, fall
  // back to whatever the device reports.
  const modelFeeders = layout ? new Set(layout.feeders.map(([n]) => n)) : null
  const feeders = (status.feeders || []).filter(
    (f) => !modelFeeders || modelFeeders.has(f.number)
  )

  for (const feeder of feeders) {
    const served = layout?.feeders.find(([n]) => n === feeder.number)?.[1] || []
    const kids = served.filter((n) => reactorNumbers.includes(n))
    kids.forEach((n) => claimed.add(n))
    children.push({
      kind: 'feeder',
      number: feeder.number,
      feeder,
      children: kids.map(reactorNode),
    })
  }

  // Anything no feeder claims still belongs on the tree, hung off the machine.
  for (const n of reactorNumbers.filter((n) => !claimed.has(n))) {
    children.push(reactorNode(n))
  }

  return { kind: 'machine', label: machineType, children }
}

function NodeBox({ node, selection, onSelect }) {
  const d = node.data
  const x = node.y            // d3 lays out top-down; swapped for a left-to-right tree
  const y = node.x

  const selected =
    (d.kind === 'reactor' && selection?.type === 'reactor' && selection.number === d.number) ||
    (d.kind === 'feeder' && selection?.type === 'feeder' && selection.number === d.number)

  if (d.kind === 'machine') {
    return (
      <g transform={`translate(${x - NODE_W / 2}, ${y - NODE_H / 2})`}>
        <rect width={NODE_W} height={NODE_H} rx="10"
              className="fill-blue-50 stroke-blue-300 dark:fill-blue-950/60 dark:stroke-blue-800" strokeWidth="2" />
        <foreignObject width={NODE_W} height={NODE_H}>
          <div className="flex h-full items-center justify-center px-2 text-center text-xs font-semibold leading-tight text-blue-900 dark:text-blue-200">
            {d.label}
          </div>
        </foreignObject>
      </g>
    )
  }

  if (d.kind === 'feeder') {
    const active = Boolean(d.feeder?.on)
    const paused = d.feeder && !d.feeder.enabled
    return (
      <g transform={`translate(${x - NODE_W / 2}, ${y - NODE_H / 2})`}
         onClick={() => onSelect({ type: 'feeder', number: d.number })}
         className="cursor-pointer">
        <rect width={NODE_W} height={NODE_H} rx="10" strokeWidth="2"
              className={[
                active ? 'fill-green-50 dark:fill-green-950/50' : 'fill-gray-50 dark:fill-slate-800',
                selected ? 'stroke-blue-500' : 'stroke-gray-200 dark:stroke-slate-700',
              ].join(' ')} />
        <foreignObject width={NODE_W} height={NODE_H}>
          <div className="flex h-full flex-col items-center justify-center leading-tight">
            <span className="text-xs font-medium text-gray-900 dark:text-slate-200">
              Feeder {d.number}
            </span>
            <span className="text-[10px] text-gray-500 dark:text-slate-400">
              {paused ? 'paused' : `${d.feeder.on_for}s / ${d.feeder.off_for_minutes}min`}
            </span>
          </div>
        </foreignObject>
      </g>
    )
  }

  const heating = Boolean(d.heater?.on)
  const mixing = Boolean(d.mixer?.on)
  const agitating = Boolean(d.agitator?.on)

  return (
    <g transform={`translate(${x - NODE_W / 2}, ${y - NODE_H / 2})`}
       onClick={() => onSelect({ type: 'reactor', number: d.number })}
       className="cursor-pointer">
      <rect width={NODE_W} height={NODE_H} rx="10" strokeWidth="2"
            className={[
              heating ? 'fill-amber-50 dark:fill-amber-950/40' : 'fill-gray-50 dark:fill-slate-800',
              selected ? 'stroke-blue-500' : 'stroke-gray-200 dark:stroke-slate-700',
            ].join(' ')} />
      <foreignObject width={NODE_W} height={NODE_H}>
        <div className="flex h-full flex-col items-center justify-center leading-tight">
          {d.stage && (
            <span className="text-[9px] uppercase tracking-wide text-gray-400 dark:text-slate-500">
              stage {d.stage}
            </span>
          )}
          <span className="text-xs font-semibold text-gray-900 dark:text-slate-200">
            Reactor {d.number}
            {d.heater && (
              <span className={`ml-1 font-normal tabular-nums ${heating ? 'text-amber-700 dark:text-amber-300' : 'text-gray-500 dark:text-slate-400'}`}>
                {d.heater.actual.toFixed(1)}°
              </span>
            )}
          </span>
          <span className="mt-0.5 flex items-center gap-1.5 text-[10px] leading-none">
            {heating && <span className="text-amber-600 dark:text-amber-400">heating</span>}
            {mixing && <span className="text-blue-600 dark:text-blue-400">mixing</span>}
            {agitating && <span className="text-teal-600 dark:text-teal-400">agitating</span>}
            {!heating && !mixing && !agitating && (
              <span className="text-gray-400 dark:text-slate-500">idle</span>
            )}
          </span>
        </div>
      </foreignObject>
    </g>
  )
}

export default function PlcTree({ machineType, layout, status, selection, onSelect, onMeasure }) {
  const { nodes, links, width, height } = useMemo(() => {
    const root = hierarchy(buildTree(machineType, layout, status))

    // nodeSize is [siblingSpacing, depthSpacing]; the axes get swapped when
    // drawing so the tree reads left to right.
    const layoutTree = d3tree().nodeSize([NODE_H + V_GAP, NODE_W + H_GAP])
    layoutTree(root)

    const all = root.descendants()
    const xs = all.map((n) => n.x)
    const ys = all.map((n) => n.y)
    const minX = Math.min(...xs), maxX = Math.max(...xs)
    const minY = Math.min(...ys), maxY = Math.max(...ys)

    // Shift so nothing is clipped, allowing half a node plus a small margin.
    const padX = NODE_W / 2 + 8
    const padY = NODE_H / 2 + 8
    all.forEach((n) => { n.x -= minX - padY; n.y -= minY - padX })

    return {
      nodes: all,
      links: root.links(),
      width: (maxY - minY) + NODE_W + 16,
      height: (maxX - minX) + NODE_H + 16,
    }
  }, [machineType, layout, status])

  // The panel sizes itself to whatever this machine needs - Medusa's ten
  // reactors are far taller than a Ray's two.
  useEffect(() => {
    if (onMeasure) onMeasure(height)
  }, [height, onMeasure])

  // Elbow connector: out from the parent, across, then in to the child.
  const linkPath = (l) => {
    const x1 = l.source.y, y1 = l.source.x
    const x2 = l.target.y, y2 = l.target.x
    const mid = x1 + (x2 - x1) / 2
    return `M${x1 + NODE_W / 2},${y1} H${mid} V${y2} H${x2 - NODE_W / 2}`
  }

  return (
    <div className="m-auto overflow-x-auto">
      <svg width={width} height={height} className="mx-auto block" role="img"
           aria-label={`${machineType} feed tree`}>
        <g>
          {links.map((l, i) => (
            <path key={i} d={linkPath(l)} fill="none" strokeWidth="1.5"
                  className="stroke-gray-300 dark:stroke-slate-600" />
          ))}
          {nodes.map((n, i) => (
            <NodeBox key={i} node={n} selection={selection} onSelect={onSelect} />
          ))}
        </g>
      </svg>
    </div>
  )
}
