import { useMemo, useState } from 'react'
import { Banner } from '@astryxdesign/core/Banner'
import { Card } from '@astryxdesign/core/Card'
import { Divider } from '@astryxdesign/core/Divider'
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl'
import { Selector } from '@astryxdesign/core/Selector'
import { Slider } from '@astryxdesign/core/Slider'
import { Switch } from '@astryxdesign/core/Switch'
import { TabList, Tab } from '@astryxdesign/core/TabList'
import { useTheme } from '@astryxdesign/core/theme'

import HoldTimeChart, { MeatSwatch } from '../components/HoldTimeChart.jsx'
import { useIsDesktop } from '../useIsDesktop.js'
import { sectionLabelStyle } from '../styles.js'
import {
  FAT_BY_CUT,
  FAT_MAX,
  FAT_MIN,
  MEATS,
  axisRange,
  clampFat,
  fmtTemp,
  fmtTime,
  getHoldTime,
  meatById,
} from '../meatSafety.js'

const hintStyle = { fontSize: 'var(--text-supporting-size)', color: 'var(--color-text-secondary)' }

const CUT_GROUPS = [
  { meat: 'chicken', label: 'Chicken' },
  { meat: 'turkey', label: 'Turkey' },
  { meat: 'beef', label: 'Beef & pork' },
]

/* --- Hold-time calculator --------------------------------------------------- */

function HoldTimeSection({ meat, setMeat, fat, setFat, cut, setCut, unit, target, setTarget, compare, setCompare }) {
  const isDesktop = useIsDesktop()
  const active = meatById(meat)
  const [tMin, tMax] = useMemo(() => axisRange(meat, compare), [meat, compare])
  // The plotted range moves with the meat (and with compare), so the stored
  // target can fall outside it — clamp for display rather than resetting it,
  // so flipping between meats keeps roughly the temperature you were on.
  const clampedTarget = Math.min(tMax, Math.max(tMin, target))

  const heldSec = getHoldTime(meat, clampedTarget, fat)
  const cuts = FAT_BY_CUT[meat]
  const selectedCut = cuts.find((c) => c.cut === cut)

  // Fat only moves poultry times — FSIS uses a single 6.5-log table for
  // beef/pork — but comparing draws the poultry curves too, so the slider
  // still matters there.
  const fatApplies = active.poultry || compare

  const pickCut = (name) => {
    setCut(name ?? null)
    const picked = cuts.find((c) => c.cut === name)
    // Land on the fattiest end of the cut's range: more fat means a longer
    // hold, so the top of the range is the safe end to default to.
    if (picked) setFat(clampFat(picked.max))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-4)' }}>
      <SegmentedControl
        label="Meat"
        layout="fill"
        value={meat}
        onChange={(v) => { setMeat(v); setCut(null) }}
      >
        {MEATS.map((m) => (
          <SegmentedControlItem key={m.id} value={m.id} label={m.label} />
        ))}
      </SegmentedControl>

      <Card padding={4}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-4)' }}>
          <div>
            <Selector
              label="Cut"
              placeholder="Pick a cut to set the fat…"
              hasClear
              options={cuts.map((c) => ({ value: c.cut, label: `${c.cut} · ${c.min}–${c.max}%` }))}
              value={cut ?? undefined}
              onChange={pickCut}
            />
            {selectedCut && fatApplies && (
              <div style={{ ...hintStyle, marginTop: 'var(--spacing-1-5)' }}>
                Typically {selectedCut.min}–{selectedCut.max}% fat — using {clampFat(selectedCut.max)}%
                {selectedCut.max > FAT_MAX && ' (the table stops at 12%)'}.
              </div>
            )}
          </div>

          {fatApplies ? (
            <Slider
              label="Fat content"
              min={FAT_MIN}
              max={FAT_MAX}
              step={1}
              value={fat}
              onChange={(v) => { setFat(v); setCut(null) }}
              valueDisplay="text"
              formatValue={(v) => `${v}%`}
              description="Fat shields bacteria, so fattier poultry needs longer."
            />
          ) : (
            <div style={hintStyle}>
              Fat doesn’t change beef or pork times — FSIS uses one 6.5-log table for all of it.
            </div>
          )}

          <Divider />

          <Slider
            label="Hold at"
            min={tMin}
            max={tMax}
            step={0.1}
            value={clampedTarget}
            onChange={setTarget}
            valueDisplay="text"
            formatValue={(v) => fmtTemp(v, unit)}
          />

          {compare ? (
            // Comparing turns the hero number into a per-meat readout, which
            // doubles as the chart's legend — the curves for chicken and turkey
            // run close enough together that direct labels would collide.
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-2)' }}>
              <div style={sectionLabelStyle}>Minimum hold at {fmtTemp(clampedTarget, unit)}</div>
              {MEATS.map((m) => (
                <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-2)' }}>
                  <MeatSwatch meat={m.id} />
                  <span style={{ flex: 1, fontSize: 'var(--text-body-size)', color: 'var(--color-text-primary)' }}>
                    {m.label}
                  </span>
                  <span style={{ fontSize: 'var(--text-large-size)', fontWeight: 'var(--font-weight-semibold)', color: 'var(--color-text-primary)' }}>
                    {fmtTime(getHoldTime(m.id, clampedTarget, fat))}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div>
              <div style={sectionLabelStyle}>Minimum hold time</div>
              <div
                style={{
                  marginTop: 'var(--spacing-1)',
                  fontSize: isDesktop ? 'var(--font-size-5xl)' : 'var(--font-size-4xl)',
                  fontWeight: 'var(--font-weight-semibold)',
                  color: heldSec == null ? 'var(--color-text-secondary)' : 'var(--color-text-primary)',
                  lineHeight: 1.05,
                }}
              >
                {fmtTime(heldSec)}
              </div>
              <div style={{ ...hintStyle, marginTop: 'var(--spacing-2)' }}>
                once the <strong style={{ color: 'var(--color-text-primary)', fontWeight: 'var(--font-weight-medium)' }}>coldest part</strong> of
                the meat reaches {fmtTemp(clampedTarget, unit)} and stays there
              </div>
            </div>
          )}
        </div>
      </Card>

      <Switch label={`Compare all three at ${fat}% fat`} value={compare} onChange={setCompare} />

      <Card padding={3}>
        <HoldTimeChart
          meat={meat}
          fat={fat}
          unit={unit}
          compare={compare}
          target={clampedTarget}
          onTargetChange={setTarget}
          height={isDesktop ? 340 : 280}
        />
        <div style={{ ...hintStyle, textAlign: 'center', marginTop: 'var(--spacing-1)' }}>
          Drag across the chart to scrub the temperature.
        </div>
      </Card>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-2)', ...hintStyle, lineHeight: 1.5 }}>
        <p style={{ margin: 0 }}>
          Time counts <strong style={{ fontWeight: 'var(--font-weight-medium)' }}>after</strong> the thickest, coldest
          part of the meat reaches the target — not from when it goes in the oven. Below the lowest listed temperature
          there is no validated safe time, so the curve simply stops.
        </p>
        <p style={{ margin: 0 }}>
          Data: US FSIS Appendix A (<em>Salmonella</em> lethality), 7-log reduction for poultry and 6.5-log for
          beef and pork. A reference tool — not a substitute for a calibrated thermometer and your own judgement.
        </p>
      </div>
    </div>
  )
}

/* --- Fat-by-cut reference --------------------------------------------------- */

function CutRow({ entry, meat, onUse }) {
  const { token } = useTheme()
  const [hover, setHover] = useState(false)
  return (
    <button
      type="button"
      onClick={() => onUse(meat, entry)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--spacing-3)',
        width: '100%',
        padding: 'var(--spacing-3) var(--spacing-4)',
        background: hover ? token('--color-overlay-hover') : 'transparent',
        border: 'none',
        font: 'inherit',
        textAlign: 'left',
        cursor: 'pointer',
      }}
    >
      <span style={{ flex: 1, fontSize: 'var(--text-body-size)', color: 'var(--color-text-primary)' }}>
        {entry.cut}
      </span>
      <span style={{ fontSize: 'var(--text-body-size)', fontWeight: 'var(--font-weight-medium)', color: 'var(--color-text-secondary)' }}>
        {entry.min}–{entry.max}%
      </span>
    </button>
  )
}

function FatReferenceSection({ onUse }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-5)' }}>
      <Banner
        status="info"
        title="Typical fat content of raw cuts"
        description="Approximate ranges for meat trimmed as sold — breed, feed and butchery all move them. Pick a row to load it into the hold-time calculator at the fattiest (safest) end of its range."
      />

      {CUT_GROUPS.map((group) => (
        <div key={group.meat}>
          <div style={{ ...sectionLabelStyle, marginBottom: 'var(--spacing-2)' }}>{group.label}</div>
          <Card padding={0} style={{ overflow: 'hidden' }}>
            {FAT_BY_CUT[group.meat].map((entry, i) => (
              <div key={entry.cut}>
                {i > 0 && <Divider />}
                <CutRow entry={entry} meat={group.meat} onUse={onUse} />
              </div>
            ))}
          </Card>
          {group.meat === 'beef' && (
            <div style={{ ...hintStyle, marginTop: 'var(--spacing-2)' }}>
              Listed for reference only — fat doesn’t change the hold time for beef or pork.
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

/* --- Page ------------------------------------------------------------------- */

/**
 * Meat temperatures: how long a cut has to hold a given internal temperature
 * to be safe (USDA FSIS Appendix A), plus the fat reference that feeds it.
 *
 * All static data — no API calls. Unit and meat live here rather than in the
 * tab sections so switching tabs doesn't reset them.
 */
export default function MeatTempsPage() {
  const isDesktop = useIsDesktop()
  const [tab, setTab] = useState('hold')
  const [meat, setMeat] = useState('chicken')
  const [fat, setFat] = useState(4)
  const [cut, setCut] = useState(null)
  const [target, setTarget] = useState(60)
  const [compare, setCompare] = useState(false)
  const [unit, setUnit] = useState(() => localStorage.getItem('scran.tempUnit') || 'C')

  const selectUnit = (u) => {
    setUnit(u)
    localStorage.setItem('scran.tempUnit', u)
  }

  // Picking a cut from the reference tab jumps back to the calculator with it
  // loaded, so the reference is a way in rather than a dead-end table.
  const useCut = (cutMeat, entry) => {
    setMeat(cutMeat)
    setCut(entry.cut)
    setFat(clampFat(entry.max))
    setTab('hold')
  }

  const tabs = [
    { value: 'hold', label: 'Hold time' },
    { value: 'fat', label: 'Fat by cut' },
  ]

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div
        style={{
          padding: isDesktop ? 'var(--spacing-4) var(--spacing-6) 0' : 'var(--spacing-4) var(--spacing-4) 0',
          flexShrink: 0,
          background: 'var(--color-background-surface)',
          borderBottom: '1px solid var(--color-border)',
        }}
      >
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--spacing-3)' }}>
            <div>
              <h1 style={{ margin: 0, fontSize: 'var(--text-heading-1-size)', fontWeight: 'var(--text-heading-1-weight)', color: 'var(--color-text-primary)' }}>
                Meat temps
              </h1>
              <p style={{ margin: 'var(--spacing-1) 0 0', ...hintStyle }}>
                How long to hold a temperature to make meat safe.
              </p>
            </div>
            <SegmentedControl label="Temperature unit" size="sm" value={unit} onChange={selectUnit}>
              <SegmentedControlItem value="C" label="°C" />
              <SegmentedControlItem value="F" label="°F" />
            </SegmentedControl>
          </div>
          <div style={{ overflowX: 'auto', marginTop: 'var(--spacing-3)' }}>
            <TabList value={tab} onChange={setTab}>
              {tabs.map((t) => (
                <Tab key={t.value} value={t.value} label={t.label} />
              ))}
            </TabList>
          </div>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: isDesktop ? 'var(--spacing-6)' : 'var(--spacing-4)' }}>
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          {tab === 'hold' ? (
            <HoldTimeSection
              meat={meat}
              setMeat={setMeat}
              fat={fat}
              setFat={setFat}
              cut={cut}
              setCut={setCut}
              unit={unit}
              target={target}
              setTarget={setTarget}
              compare={compare}
              setCompare={setCompare}
            />
          ) : (
            <FatReferenceSection onUse={useCut} />
          )}
        </div>
      </div>
    </div>
  )
}
