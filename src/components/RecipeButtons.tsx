import { useState } from 'react'
import { fetchRecipe, type Recipe } from '../api'
import Icon from './Icon'

const cacheKey = (name: string, diet: string) => `recipe:${diet}:${name.toLowerCase().replace(/\s+/g, ' ').trim()}`
// A search link, not a made-up video address: it always opens real results for the dish.
const videoUrl = (name: string) => `https://www.youtube.com/results?search_query=${encodeURIComponent(`${name.replace(/\s*\(.*?\)\s*/g, ' ').trim()} recipe`)}`

function read(key: string): Recipe | null {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null') as Recipe | null
  } catch {
    return null
  }
}

// "Recipe" and "Watch" buttons under a suggested dish. Recipes are written on demand, then kept in this browser.
export default function RecipeButtons({ name, quantity, diet, allergies }: { name: string; quantity: string; diet: string; allergies: string[] }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [recipe, setRecipe] = useState<Recipe | null>(null)
  const [error, setError] = useState('')

  async function toggle() {
    if (open) return setOpen(false)
    setOpen(true)
    if (recipe) return
    const key = cacheKey(name, diet)
    const cached = read(key)
    if (cached) return setRecipe(cached)
    setBusy(true)
    setError('')
    try {
      const r = await fetchRecipe({ name, quantity, diet, allergies })
      setRecipe(r.recipe)
      try {
        localStorage.setItem(key, JSON.stringify(r.recipe))
      } catch {
        /* storage full or unavailable: the recipe still shows */
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className="recipe">
      <span className="recipe-actions">
        <button type="button" className={`chip small ${open ? 'on' : ''}`} onClick={() => void toggle()} aria-expanded={open}>
          <Icon name="book" size={13} /> {busy ? 'Loading…' : 'Recipe'}
        </button>
        <a className="chip small" href={videoUrl(name)} target="_blank" rel="noopener noreferrer">
          <Icon name="play" size={13} /> Watch
        </a>
      </span>
      {open && error && <span className="small-text bad-text">{error}</span>}
      {open && recipe && (
        <span className="recipe-body">
          <span className="muted small-text">
            {recipe.timeMinutes} min · serves {recipe.servings}
          </span>
          <b>Ingredients</b>
          <ul>
            {recipe.ingredients.map((g, i) => (
              <li key={i}>
                {g.amount ? `${g.amount} ` : ''}
                {g.item}
              </li>
            ))}
          </ul>
          <b>Steps</b>
          <ol>
            {recipe.steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
          {recipe.tip && <span className="why small-text">Tip: {recipe.tip}</span>}
          <span className="muted small-text">AI-written, so check it against your allergies.</span>
        </span>
      )}
    </span>
  )
}
