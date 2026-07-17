import { useEffect, useMemo, useRef, useState } from 'react'
import { useTheme } from '@astryxdesign/core/theme'

import {
  MEATS,
  axisRange,
  cToF,
  fmtTime,
  fmtTimeShort,
  getHoldTime,
  meatById,
  niceTicks,
} from '../meatSafety.js'

/*
 * Hand-rolled SVG rather than a charting library: the app has no chart
 * dependency, this is one line chart, and drawing it ourselves lets every
 * colour come from a matcha token via useTheme (Astryx's documented route for
 * feeding theme values to SVG) instead of a hard-coded palette.
 *
 * Hold time spans ~9 seconds to nearly 2 hours, so the y axis is log-scaled —
 * on a linear axis the whole interesting right-hand half of every curve would
 * be flattened onto the baseline.
 */

const Y_MIN = 8
const Y_MAX = 8000
const Y_TICKS = [10, 30, 60, 300, 900, 3600, 7200]

const MARGIN = { top: 14, right: 14, bottom: 34, left: 52 }

/** A short line drawn with a series' colour + dash pattern, for legends. */
export function MeatSwatch({ meat }) {
  const { token } = useTheme()
  const m = meatById(meat)
  return (
    <svg width="22" height="8" aria-hidden="true" style={{ flexShrink: 0 }}>
      <line
        x1="0"
        y1="4"
        x2="22"
        y2="4"
        stroke={token(m.colorToken)}
        strokeWidth="2"
        strokeDasharray={m.dash ?? undefined}
        strokeLinecap="round"
      />
    </svg>
  )
}

/** Build an SVG path, breaking the pen wherever a sample has no safe time. */
function buildPath(samples, xs, ys) {
  let d = ''
  let drawing = false
  for (const [t, v] of samples) {
    if (v == null) {
      drawing = false
      continue
    }
    d += `${drawing ? 'L' : 'M'}${xs(t).toFixed(2)} ${ys(v).toFixed(2)} `
    drawing = true
  }
  return d.trim()
}

/**
 * Log-scale hold-time curve. Dragging anywhere on the plot scrubs the target
 * temperature; the page's Slider is the keyboard/screen-reader route to the
 * same value, so this stays a pointer-only enhancement.
 */
export default function HoldTimeChart({ meat, fat, unit, compare, target, onTargetChange, height = 300 }) {
  const { token } = useTheme()
  const wrapRef = useRef(null)
  const svgRef = useRef(null)
  const [width, setWidth] = useState(0)

  // Track the container width so the SVG can be laid out in real pixels —
  // scaling a fixed viewBox would shrink the axis text on narrow phones.
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const [tMin, tMax] = useMemo(() => axisRange(meat, compare), [meat, compare])

  const plotW = Math.max(0, width - MARGIN.left - MARGIN.right)
  const plotH = Math.max(0, height - MARGIN.top - MARGIN.bottom)

  const xs = (t) => MARGIN.left + ((t - tMin) / (tMax - tMin)) * plotW
  const ys = (v) => {
    const clamped = Math.min(Y_MAX, Math.max(Y_MIN, v))
    const f = (Math.log10(Y_MAX) - Math.log10(clamped)) / (Math.log10(Y_MAX) - Math.log10(Y_MIN))
    return MARGIN.top + f * plotH
  }
  const xToTemp = (px) => tMin + ((px - MARGIN.left) / plotW) * (tMax - tMin)

  // Dense samples so the curve reads as a curve, not a polyline of table rows.
  const series = useMemo(() => {
    const ids = compare ? MEATS.map((m) => m.id) : [meat]
    return ids.map((id) => {
      const samples = []
      for (let t = tMin; t <= tMax + 1e-6; t += 0.1) {
        const tc = Math.round(t * 10) / 10
        samples.push([tc, getHoldTime(id, tc, fat)])
      }
      return { id, samples }
    })
  }, [meat, fat, compare, tMin, tMax])

  const xTicks = useMemo(() => {
    const lo = unit === 'F' ? cToF(tMin) : tMin
    const hi = unit === 'F' ? cToF(tMax) : tMax
    return niceTicks(lo, hi, 5).map((v) => ({ label: `${v}°`, tempC: unit === 'F' ? ((v - 32) * 5) / 9 : v }))
  }, [tMin, tMax, unit])

  /* --- scrubbing ---------------------------------------------------------- */
  const dragging = useRef(false)
  const scrubTo = (clientX) => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect || !plotW) return
    const t = xToTemp(clientX - rect.left)
    onTargetChange(Math.min(tMax, Math.max(tMin, Math.round(t * 10) / 10)))
  }

  const gridColor = token('--color-border')
  const axisColor = token('--color-text-secondary')
  const crosshair = token('--color-border-emphasized')
  const surface = token('--color-background-card')

  const activeColor = token(meatById(meat).colorToken)
  const targetSec = getHoldTime(meat, target, fat)

  const summary = compare
    ? `Hold time against internal temperature for chicken, turkey and beef or pork at ${fat}% fat, on a logarithmic time axis.`
    : `Hold time against internal temperature for ${meatById(meat).label} at ${fat}% fat, on a logarithmic time axis. At ${
        Math.round(target * 10) / 10
      }°C the minimum hold is ${fmtTime(targetSec)}.`

  return (
    <div ref={wrapRef} style={{ width: '100%' }}>
      {width > 0 && (
        <svg
          ref={svgRef}
          width={width}
          height={height}
          role="img"
          aria-label={summary}
          style={{ display: 'block', touchAction: 'pan-y', cursor: 'ew-resize' }}
          onPointerDown={(e) => {
            dragging.current = true
            e.currentTarget.setPointerCapture?.(e.pointerId)
            scrubTo(e.clientX)
          }}
          onPointerMove={(e) => dragging.current && scrubTo(e.clientX)}
          onPointerUp={() => { dragging.current = false }}
          onPointerCancel={() => { dragging.current = false }}
        >
          {/* horizontal grid + time ticks */}
          {Y_TICKS.map((v) => (
            <g key={v}>
              <line x1={MARGIN.left} y1={ys(v)} x2={width - MARGIN.right} y2={ys(v)} stroke={gridColor} strokeWidth="1" />
              <text
                x={MARGIN.left - 8}
                y={ys(v)}
                textAnchor="end"
                dominantBaseline="middle"
                fill={axisColor}
                fontSize="11"
              >
                {fmtTimeShort(v)}
              </text>
            </g>
          ))}

          {/* temperature ticks */}
          {xTicks.map((tick) => (
            <text
              key={tick.label}
              x={xs(tick.tempC)}
              y={height - MARGIN.bottom + 16}
              textAnchor="middle"
              fill={axisColor}
              fontSize="11"
            >
              {tick.label}
            </text>
          ))}
          <text
            x={MARGIN.left + plotW / 2}
            y={height - 4}
            textAnchor="middle"
            fill={axisColor}
            fontSize="11"
          >
            Internal temperature (°{unit})
          </text>

          {/* target crosshair, behind the curves so it never hides them */}
          {target >= tMin && target <= tMax && (
            <line
              x1={xs(target)}
              y1={MARGIN.top}
              x2={xs(target)}
              y2={MARGIN.top + plotH}
              stroke={crosshair}
              strokeWidth="1"
              strokeDasharray="4 4"
            />
          )}

          {series.map(({ id, samples }) => {
            const m = meatById(id)
            return (
              <path
                key={id}
                d={buildPath(samples, xs, ys)}
                fill="none"
                stroke={token(m.colorToken)}
                strokeWidth="2"
                strokeDasharray={compare ? (m.dash ?? undefined) : undefined}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )
          })}

          {/* marker on the active curve — 2px surface ring keeps it legible
              where it sits on top of a line or a grid rule */}
          {!compare && targetSec != null && (
            <circle
              cx={xs(target)}
              cy={ys(targetSec)}
              r="5"
              fill={activeColor}
              stroke={surface}
              strokeWidth="2"
            />
          )}
        </svg>
      )}
    </div>
  )
}
