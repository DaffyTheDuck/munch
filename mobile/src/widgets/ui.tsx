import React from 'react'
import { FlexWidget, SvgWidget, TextWidget } from 'react-native-android-widget'
import type { WidgetRepresentation } from 'react-native-android-widget'
import { palettes, type Theme } from '@/theme'
import type { Macro, WidgetData } from './data'

type Hex = `#${string}`
const hex = (c: string) => c as Hex
const fmt = (n: number) => Math.round(n).toLocaleString('en-US')

// Widgets are drawn from simple native-backed blocks (not normal React Native views), so these layouts are
// deliberately plain: text, flex boxes, one SVG ring. Each widget is rendered twice, light and dark,
// and Android picks the one that matches the phone's theme.

function ring(progress: number, size: number, t: Theme) {
  const r = 40
  const c = 2 * Math.PI * r
  const p = Math.min(1, Math.max(0, progress))
  const over = progress > 1
  const stroke = over ? t.over : t.accent
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">
    <circle cx="50" cy="50" r="${r}" fill="none" stroke="${t.card2}" stroke-width="11"/>
    ${p > 0 ? `<circle cx="50" cy="50" r="${r}" fill="none" stroke="${stroke}" stroke-width="11" stroke-linecap="round" stroke-dasharray="${(p * c).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 50 50)"/>` : ''}
  </svg>`
}

function Bar({ value, goal, color, t }: Macro & { color: string; t: Theme }) {
  const pct = goal > 0 ? Math.min(100, Math.round((value / goal) * 100)) : 0
  return (
    <FlexWidget style={{ width: 'match_parent', height: 7, flexDirection: 'row', backgroundColor: hex(t.card2), borderRadius: 4 }}>
      {pct > 0 ? <FlexWidget style={{ flex: pct, height: 7, backgroundColor: hex(color), borderRadius: 4 }} /> : null}
      {pct < 100 ? <FlexWidget style={{ flex: 100 - pct, height: 7 }} /> : null}
    </FlexWidget>
  )
}

function MacroRow({ label, m, color, t }: { label: string; m: Macro; color: string; t: Theme }) {
  return (
    <FlexWidget style={{ width: 'match_parent', flexDirection: 'column' }}>
      <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', justifyContent: 'space-between' }}>
        <TextWidget text={label} style={{ fontSize: 11, color: hex(t.muted) }} />
        <TextWidget text={`${fmt(m.value)} / ${fmt(m.goal)} g`} style={{ fontSize: 11, color: hex(t.muted) }} />
      </FlexWidget>
      <Bar {...m} color={color} t={t} />
    </FlexWidget>
  )
}

const shell = (t: Theme) => ({ height: 'match_parent' as const, width: 'match_parent' as const, backgroundColor: hex(t.card), borderRadius: 22, padding: 14, borderWidth: 1, borderColor: hex(t.line) })

/** 2x2: calories left today and a progress bar. */
function Calories({ d, t }: { d: WidgetData; t: Theme }) {
  const over = d.remaining < 0
  return (
    <FlexWidget clickAction="OPEN_APP" accessibilityLabel="Open Munch" style={{ ...shell(t), flexDirection: 'column', justifyContent: 'space-between' }}>
      <TextWidget text="Munch" style={{ fontSize: 12, fontWeight: '600', color: hex(t.accentStrong) }} />
      <FlexWidget style={{ flexDirection: 'column' }}>
        <TextWidget text={fmt(Math.abs(d.remaining))} style={{ fontSize: 34, fontWeight: '700', color: hex(over ? t.over : t.text) }} />
        <TextWidget text={over ? 'kcal over today' : 'kcal left today'} style={{ fontSize: 12, color: hex(t.muted) }} />
      </FlexWidget>
      <FlexWidget style={{ width: 'match_parent', flexDirection: 'column' }}>
        <FlexWidget style={{ width: 'match_parent', height: 8, flexDirection: 'row', backgroundColor: hex(t.card2), borderRadius: 4 }}>
          {d.progress > 0 ? <FlexWidget style={{ flex: Math.min(100, Math.round(d.progress * 100)), height: 8, backgroundColor: hex(over ? t.over : t.accent), borderRadius: 4 }} /> : null}
          {d.progress < 1 ? <FlexWidget style={{ flex: 100 - Math.round(d.progress * 100), height: 8 }} /> : null}
        </FlexWidget>
        <TextWidget text={`${fmt(d.eaten - d.burned)} of ${fmt(d.goal)}`} style={{ fontSize: 11, color: hex(t.muted) }} />
      </FlexWidget>
    </FlexWidget>
  )
}

/** 4x2: ring, calories left, and protein / carbs / fat bars. */
function Today({ d, t }: { d: WidgetData; t: Theme }) {
  const over = d.remaining < 0
  return (
    <FlexWidget clickAction="OPEN_APP" accessibilityLabel="Open Munch" style={{ ...shell(t), flexDirection: 'row', alignItems: 'center' }}>
      <FlexWidget style={{ flexDirection: 'column', alignItems: 'center', marginRight: 14 }}>
        <SvgWidget svg={ring(d.progress, 84, t)} style={{ width: 84, height: 84 }} />
        <TextWidget text={fmt(Math.abs(d.remaining))} style={{ fontSize: 20, fontWeight: '700', color: hex(over ? t.over : t.text) }} />
        <TextWidget text={over ? 'kcal over' : 'kcal left'} style={{ fontSize: 11, color: hex(t.muted) }} />
      </FlexWidget>
      <FlexWidget style={{ flex: 1, flexDirection: 'column', justifyContent: 'center' }}>
        <MacroRow label="Protein" m={d.protein} color={t.protein} t={t} />
        <FlexWidget style={{ height: 8 }} />
        <MacroRow label="Carbs" m={d.carbs} color={t.carbs} t={t} />
        <FlexWidget style={{ height: 8 }} />
        <MacroRow label="Fat" m={d.fat} color={t.fat} t={t} />
      </FlexWidget>
    </FlexWidget>
  )
}

/** 4x1: a bar that opens the app straight into the "what did you eat?" box. */
function QuickLog({ d, t }: { d: WidgetData; t: Theme }) {
  return (
    <FlexWidget
      clickAction="OPEN_URI"
      clickActionData={{ uri: 'journable:///?focus=1' }}
      accessibilityLabel="Log food"
      style={{ ...shell(t), padding: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: 28 }}
    >
      <FlexWidget style={{ flexDirection: 'column', marginLeft: 10 }}>
        <TextWidget text="What did you eat?" style={{ fontSize: 15, fontWeight: '600', color: hex(t.text) }} />
        <TextWidget text={`${d.mealLabel} · ${fmt(Math.max(0, d.remaining))} kcal left`} style={{ fontSize: 11, color: hex(t.muted) }} />
      </FlexWidget>
      <FlexWidget style={{ width: 40, height: 40, borderRadius: 20, backgroundGradient: { from: hex(t.btnA), to: hex(t.btnB), orientation: 'TL_BR' }, alignItems: 'center', justifyContent: 'center' }}>
        <TextWidget text="+" style={{ fontSize: 24, fontWeight: '600', color: '#ffffff' }} />
      </FlexWidget>
    </FlexWidget>
  )
}

const both = (render: (t: Theme) => React.JSX.Element): WidgetRepresentation => ({ light: render(palettes.light), dark: render(palettes.dark) })

export const WIDGETS = {
  MunchCalories: (d: WidgetData) => both((t) => <Calories d={d} t={t} />),
  MunchToday: (d: WidgetData) => both((t) => <Today d={d} t={t} />),
  MunchQuickLog: (d: WidgetData) => both((t) => <QuickLog d={d} t={t} />),
}
export type WidgetName = keyof typeof WIDGETS
export const WIDGET_NAMES = Object.keys(WIDGETS) as WidgetName[]
