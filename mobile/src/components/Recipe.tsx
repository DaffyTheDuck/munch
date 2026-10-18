import { useState } from 'react'
import { Linking, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { radius, useTheme } from '@/theme'
import { fetchRecipe, type Recipe } from '@/lib/api'
import { getSetting, setSetting } from '@/lib/db'
import { feel } from '@/lib/feel'
import { Press, T } from './ui'

const cacheKey = (name: string, diet: string) => `recipe:${diet}:${name.toLowerCase().replace(/\s+/g, ' ').trim()}`
// A search link, not a made-up video address: it always opens real results for the dish.
const videoUrl = (name: string) => `https://www.youtube.com/results?search_query=${encodeURIComponent(`${name.replace(/\s*\(.*?\)\s*/g, ' ').trim()} recipe`)}`

function Pill({ icon, label, onPress, busy, active }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; busy?: boolean; active?: boolean }) {
  const t = useTheme()
  return (
    <Press onPress={onPress} haptic="select" accessibilityLabel={label} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill, backgroundColor: active ? t.accentSoft : t.card2 }}>
      <Ionicons name={busy ? 'hourglass-outline' : icon} size={14} color={active ? t.accentStrong : t.muted} />
      <T variant="caption" style={{ color: active ? t.accentStrong : t.text }}>
        {busy ? 'Loading…' : label}
      </T>
    </Press>
  )
}

// "Recipe" and "Watch" buttons under a suggested dish. Recipes are written on demand, then kept on the phone.
export function RecipeButtons({ name, quantity, diet, allergies }: { name: string; quantity: string; diet: string; allergies: string[] }) {
  const t = useTheme()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [recipe, setRecipe] = useState<Recipe | null>(null)
  const [error, setError] = useState('')

  async function toggle() {
    if (open) return setOpen(false)
    setOpen(true)
    if (recipe) return
    setBusy(true)
    setError('')
    try {
      const key = cacheKey(name, diet)
      const cached = await getSetting(key)
      if (cached) {
        setRecipe(JSON.parse(cached) as Recipe)
      } else {
        const r = await fetchRecipe({ name, quantity, diet, allergies })
        setRecipe(r.recipe)
        await setSetting(key, JSON.stringify(r.recipe))
      }
    } catch (e) {
      feel.error()
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={{ gap: 8, marginTop: 6 }}>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Pill icon="book-outline" label="Recipe" onPress={() => void toggle()} busy={busy} active={open} />
        <Pill icon="logo-youtube" label="Watch" onPress={() => void Linking.openURL(videoUrl(name))} />
      </View>
      {open && !busy && error ? (
        <T variant="caption" color="over">
          {error}
        </T>
      ) : null}
      {open && recipe ? (
        <View style={{ gap: 8, padding: 12, borderRadius: radius.md, backgroundColor: t.card2 }}>
          <T variant="caption" muted>
            {recipe.timeMinutes} min · serves {recipe.servings}
          </T>
          <T variant="callout" style={{ fontWeight: '600' }}>
            Ingredients
          </T>
          {recipe.ingredients.map((g, i) => (
            <T key={i} variant="caption">
              • {g.amount ? `${g.amount} ` : ''}
              {g.item}
            </T>
          ))}
          <T variant="callout" style={{ fontWeight: '600', marginTop: 4 }}>
            Steps
          </T>
          {recipe.steps.map((s, i) => (
            <T key={i} variant="caption">
              {i + 1}. {s}
            </T>
          ))}
          {recipe.tip ? (
            <T variant="caption" color="accentStrong">
              Tip: {recipe.tip}
            </T>
          ) : null}
          <T variant="caption" muted style={{ fontSize: 11 }}>
            AI-written, so check it against your allergies.
          </T>
        </View>
      ) : null}
    </View>
  )
}
