// The food knowledge base used by the recommendation engine.
//
// Each entry is one typical serving with protein, carbs, fat and fibre (grams). Calories are DERIVED (4 P + 4 C + 9 F), so the
// numbers can never contradict each other. Values are rounded, representative figures drawn from common reference
// values (USDA FoodData Central and the Indian Food Composition Tables style of figures). They are good to roughly
// ±15% for a home-cooked portion and are NOT lab measurements; treat them as a starting point you can edit.
//
// Diet and allergen rules are NOT guessed from names. Each food lists the ingredient classes it contains, and diets
// are derived from those (see `allowsDiet`). When unsure, an ingredient is flagged (the safe direction): e.g. a dal
// tempered with ghee is marked dairy, poha is marked as containing peanuts.
import type { Meal } from '../types'
import type { DietType } from '../diet'
import type { Allergen, Food, Ingredient, Role, Tag } from './types'

const MEAL_CODE: Record<string, Meal> = { b: 'breakfast', l: 'lunch', s: 'snack', d: 'dinner' }

interface Flags {
  contains?: Ingredient[]
  allergens?: Allergen[]
  tags?: Tag[]
  /** [min, max, step] multiplier of one serving */
  portion?: [number, number, number]
  keywords?: string[]
}

const ANY = ['*']
const IND = ['indian']

// id, name, cuisines, meals ('b' 'l' 's' 'd'), role, serving label, grams, protein, carbs, fat, fibre
function f(id: string, name: string, cuisines: string[], meals: string, role: Role, label: string, grams: number, p: number, c: number, fat: number, fiber: number, flags: Flags = {}): Food {
  const contains = flags.contains ?? []
  const allergens = new Set<Allergen>(flags.allergens ?? [])
  if (contains.includes('dairy')) allergens.add('dairy')
  if (contains.includes('egg')) allergens.add('eggs')
  if (contains.includes('fish')) allergens.add('fish')
  if (contains.includes('shellfish')) allergens.add('shellfish')
  const [min, max, step] = flags.portion ?? defaultPortion(role)
  return {
    id,
    name,
    cuisines,
    meals: [...meals].map((m) => MEAL_CODE[m]),
    role,
    serving: { label, grams },
    kcal: Math.round(4 * p + 4 * c + 9 * fat),
    protein: p,
    carbs: c,
    fat,
    fiber,
    contains,
    allergens: [...allergens],
    tags: flags.tags ?? [],
    portion: { min, max, step },
    keywords: flags.keywords ?? [],
    source: 'catalog',
  }
}

function defaultPortion(role: Role): [number, number, number] {
  switch (role) {
    case 'carb':
      return [0.5, 2, 0.5]
    case 'protein':
      return [0.5, 2, 0.5]
    case 'veg':
    case 'side':
      return [0.5, 2, 0.5]
    case 'fruit':
    case 'drink':
      return [0.5, 2, 0.5]
    case 'snack':
      return [0.5, 2, 0.5]
    default:
      return [0.5, 1.75, 0.25] // complete dishes
  }
}

export const CATALOG: Food[] = [
  // ------------------------------------------------------------ breakfast dishes
  f('idli', 'Idli (2 pieces)', IND, 'bs', 'main', '2 pieces (80 g)', 80, 4, 22, 0.6, 1, { tags: ['fermented', 'light'], portion: [0.5, 3, 0.5] }),
  f('plain-dosa', 'Plain dosa', IND, 'bd', 'main', '1 dosa (80 g)', 80, 3.5, 23, 3.5, 1, { tags: ['fermented'], portion: [0.5, 3, 0.5] }),
  f('masala-dosa', 'Masala dosa', IND, 'bld', 'main', '1 dosa (200 g)', 200, 6, 40, 11, 3, { contains: ['root', 'allium'], tags: ['indulgent'], portion: [0.5, 2, 0.5] }),
  f('poha', 'Vegetable poha', IND, 'bs', 'main', '1 plate (200 g)', 200, 5, 40, 8, 3, { contains: ['allium', 'root'], allergens: ['peanuts'] }),
  f('upma', 'Vegetable upma', IND, 'b', 'main', '1 cup (200 g)', 200, 6, 36, 8, 3, { contains: ['allium'], allergens: ['gluten', 'nuts'] }),
  f('moong-chilla', 'Moong dal chilla', IND, 'bd', 'main', '2 chillas (140 g)', 140, 12, 24, 6, 5, { tags: ['legume', 'high-protein'], keywords: ['moong', 'lentil'] }),
  f('besan-chilla', 'Besan chilla', IND, 'bsd', 'main', '2 chillas (130 g)', 130, 10, 22, 8, 4, { tags: ['legume'], keywords: ['chickpea', 'gram flour'] }),
  f('daliya', 'Vegetable daliya (broken wheat porridge)', IND, 'bl', 'main', '1 bowl (250 g)', 250, 7, 38, 4, 6, { allergens: ['gluten'], tags: ['whole-grain'], keywords: ['wheat'] }),
  f('ragi-porridge', 'Ragi porridge', IND, 'b', 'main', '1 bowl (250 g)', 250, 5, 35, 2, 4, { tags: ['whole-grain'], keywords: ['finger millet'] }),
  f('paratha', 'Plain paratha', IND, 'bd', 'carb', '1 paratha (60 g)', 60, 4, 24, 8, 2, { allergens: ['gluten'], portion: [0.5, 3, 0.5] }),
  f('aloo-paratha', 'Aloo paratha', IND, 'bl', 'main', '1 paratha (110 g)', 110, 5, 33, 10, 3, { contains: ['root'], allergens: ['gluten'], tags: ['indulgent'], portion: [0.5, 2.5, 0.5] }),
  f('oats-milk', 'Oats porridge with milk', ANY, 'bs', 'main', '1 bowl (300 g)', 300, 11.4, 36.6, 9.2, 4, { contains: ['dairy'], allergens: ['gluten'], tags: ['whole-grain'] }),
  f('oats-soy-banana', 'Oats with soy milk and banana', ANY, 'b', 'main', '1 bowl (320 g)', 320, 10, 52, 6, 7, { allergens: ['soy', 'gluten'], tags: ['whole-grain'] }),
  f('veg-sandwich', 'Vegetable sandwich', ANY, 'bsl', 'main', '2 slices (170 g)', 170, 7, 36, 6, 4, { contains: ['dairy'], allergens: ['gluten'] }),
  f('hummus-sandwich', 'Hummus and vegetable sandwich', ['mediterranean', 'middle-eastern', 'american'], 'bl', 'main', '2 slices (190 g)', 190, 9, 38, 8, 7, { allergens: ['gluten', 'sesame'] }),
  f('pb-toast', 'Peanut butter toast', ['american', 'british', '*'], 'bs', 'main', '2 slices (90 g)', 90, 14, 32, 17, 5, { allergens: ['peanuts', 'gluten'], keywords: ['peanut butter'] }),
  f('scrambled-egg-toast', 'Scrambled eggs on toast', ['american', 'british', '*'], 'b', 'main', '2 eggs, 1 slice (150 g)', 150, 16, 14, 17, 1, { contains: ['egg', 'dairy'], allergens: ['gluten'], tags: ['high-protein'] }),
  f('masala-omelette', 'Masala omelette', IND, 'bd', 'main', '2-egg omelette (130 g)', 130, 13, 3, 16, 1, { contains: ['egg', 'allium'], tags: ['high-protein'], portion: [0.5, 2, 0.5] }),
  f('tofu-scramble', 'Tofu scramble', ['american', '*'], 'bld', 'main', '1 bowl (150 g)', 150, 15, 6, 9, 2, { allergens: ['soy'], tags: ['high-protein'], keywords: ['tofu'] }),
  f('greek-yogurt-fruit', 'Greek yogurt with fruit', ['mediterranean', 'american', '*'], 'bs', 'main', '1 bowl (250 g)', 250, 17, 24, 3, 2, { contains: ['dairy'], tags: ['high-protein'] }),
  f('beans-on-toast', 'Baked beans on toast', ['british'], 'bld', 'main', '1 plate (280 g)', 280, 17, 60, 4, 14, { allergens: ['gluten'], tags: ['legume'] }),
  f('banana-pb-smoothie', 'Banana peanut-butter smoothie', ['american', '*'], 'bs', 'drink', '1 large glass (350 ml)', 350, 13, 48, 14, 5, { contains: ['dairy'], allergens: ['peanuts'] }),

  // ------------------------------------------------------------ carbs
  f('white-rice', 'Steamed rice', ['indian', 'chinese', 'thai', 'japanese', 'korean', 'vietnamese', 'latin-american', 'african'], 'ld', 'carb', '1 cup cooked (160 g)', 160, 4.3, 45, 0.4, 0.6),
  f('brown-rice', 'Brown rice', ['indian', 'chinese', 'thai', 'japanese', 'korean', 'vietnamese', 'latin-american', 'african', 'american', 'mediterranean'], 'ld', 'carb', '1 cup cooked (195 g)', 195, 5, 45, 1.8, 3.5, { tags: ['whole-grain'] }),
  f('roti', 'Whole-wheat roti (2)', IND, 'ld', 'carb', '2 rotis (80 g)', 80, 6, 36, 5, 5, { allergens: ['gluten'], tags: ['whole-grain'], portion: [0.5, 2.5, 0.5] }),
  f('bajra-roti', 'Bajra (millet) roti (2)', IND, 'ld', 'carb', '2 rotis (100 g)', 100, 6, 34, 4, 5, { tags: ['whole-grain'], portion: [0.5, 2, 0.5] }),
  f('jeera-rice', 'Jeera rice', IND, 'ld', 'carb', '1 cup (180 g)', 180, 4, 43, 5, 1, { contains: ['dairy'] }),
  f('quinoa', 'Quinoa', ['american', 'mediterranean', 'latin-american', 'middle-eastern'], 'ld', 'carb', '1 cup cooked (185 g)', 185, 8, 39, 3.6, 5, { tags: ['whole-grain'] }),
  f('wholewheat-pasta', 'Whole-wheat pasta', ['italian', 'mediterranean', '*'], 'ld', 'carb', '1 cup cooked (140 g)', 140, 7.5, 37, 1, 6, { allergens: ['gluten'], tags: ['whole-grain'] }),
  f('wholewheat-bread', 'Whole-wheat bread (2 slices)', ['american', 'british', 'mediterranean', 'middle-eastern'], 'bld', 'carb', '2 slices (60 g)', 60, 7, 24, 2, 4, { allergens: ['gluten'], tags: ['whole-grain'] }),
  f('naan', 'Naan', IND, 'ld', 'carb', '1 naan (90 g)', 90, 8, 45, 7, 2, { contains: ['dairy'], allergens: ['gluten'], tags: ['indulgent'], portion: [0.5, 2, 0.5] }),
  f('pita', 'Pita bread', ['mediterranean', 'middle-eastern'], 'ld', 'carb', '1 pita (60 g)', 60, 5.5, 33, 1.2, 2, { allergens: ['gluten'] }),
  f('corn-tortillas', 'Corn tortillas (2)', ['mexican', 'latin-american'], 'ld', 'carb', '2 tortillas (50 g)', 50, 3, 24, 1.5, 3, { portion: [0.5, 3, 0.5] }),
  f('sweet-potato', 'Baked sweet potato', ['american', '*'], 'ld', 'carb', '1 medium (150 g)', 150, 2, 27, 0.2, 4, { contains: ['root'] }),
  f('khichdi', 'Moong dal khichdi', IND, 'ld', 'main', '1 bowl (250 g)', 250, 10, 42, 6, 6, { contains: ['dairy'], tags: ['legume'] }),
  f('veg-pulao', 'Vegetable pulao', IND, 'ld', 'main', '1 cup (200 g)', 200, 5, 42, 7, 3, { contains: ['allium'] }),
  f('veg-biryani', 'Vegetable biryani', IND, 'ld', 'main', '1 cup (220 g)', 220, 7, 50, 10, 4, { contains: ['allium', 'dairy'], tags: ['indulgent'] }),
  f('curd-rice', 'Curd rice', IND, 'ld', 'main', '1 bowl (250 g)', 250, 6, 38, 6, 1, { contains: ['dairy'] }),
  f('lemon-rice', 'Lemon rice', IND, 'ld', 'main', '1 cup (200 g)', 200, 4, 42, 7, 2, { allergens: ['peanuts'] }),
  f('mujaddara', 'Mujaddara (lentils and rice)', ['middle-eastern', 'mediterranean'], 'ld', 'main', '1 plate (300 g)', 300, 14, 62, 10, 9, { contains: ['allium'], tags: ['legume'] }),
  f('black-beans-rice', 'Black beans and rice', ['latin-american', 'mexican'], 'ld', 'main', '1 plate (350 g)', 350, 15, 70, 4, 14, { tags: ['legume'] }),

  // ------------------------------------------------------------ protein dishes: legumes and soy
  f('dal-tadka', 'Dal tadka', IND, 'ld', 'protein', '1 bowl (200 g)', 200, 9, 20, 6, 6, { contains: ['allium'], tags: ['legume'], keywords: ['lentil'] }),
  f('simple-moong-dal', 'Plain moong dal (Jain style)', IND, 'bld', 'protein', '1 bowl (200 g)', 200, 10, 22, 4, 6, { tags: ['legume'], keywords: ['lentil', 'moong'] }),
  f('masoor-dal', 'Masoor dal', IND, 'ld', 'protein', '1 bowl (200 g)', 200, 11, 24, 4, 7, { contains: ['allium'], tags: ['legume'], keywords: ['lentil'] }),
  f('sambar', 'Sambar', IND, 'bld', 'protein', '1 bowl (200 ml)', 200, 6, 18, 3, 5, { contains: ['allium'], tags: ['legume'], keywords: ['lentil'] }),
  f('chana-masala', 'Chana masala', IND, 'ld', 'protein', '1 cup (200 g)', 200, 12, 36, 9, 10, { contains: ['allium'], tags: ['legume'], keywords: ['chickpea', 'chole'] }),
  f('rajma', 'Rajma masala', IND, 'ld', 'protein', '1 cup (200 g)', 200, 13, 36, 6, 11, { contains: ['allium'], tags: ['legume'], keywords: ['kidney bean'] }),
  f('soya-chunk-curry', 'Soya chunk curry', IND, 'ld', 'protein', '1 cup (200 g)', 200, 20, 18, 6, 6, { contains: ['allium'], allergens: ['soy'], tags: ['high-protein'], keywords: ['soy'] }),
  f('tofu-stir-fry', 'Tofu and vegetable stir-fry', ['chinese', 'thai', 'japanese', '*'], 'ld', 'protein', '1 bowl (200 g)', 200, 15, 10, 9, 3, { contains: ['allium'], allergens: ['soy'], tags: ['high-protein'], keywords: ['tofu'] }),
  f('lentil-soup', 'Lentil soup', ['mediterranean', 'middle-eastern', '*'], 'ld', 'protein', '1 bowl (300 g)', 300, 12, 26, 2, 9, { contains: ['allium'], tags: ['legume'] }),
  f('black-bean-curry', 'Black bean curry', ['latin-american', 'mexican', '*'], 'ld', 'protein', '1 bowl (250 g)', 250, 14, 38, 3, 12, { contains: ['allium'], tags: ['legume'] }),
  f('edamame', 'Edamame', ['japanese', '*'], 'sld', 'protein', '1 cup shelled (155 g)', 155, 18, 14, 8, 8, { allergens: ['soy'], tags: ['high-protein'], portion: [0.5, 1.5, 0.5] }),
  f('tempeh-stir-fry', 'Tempeh stir-fry', ['thai', '*'], 'ld', 'protein', '1 bowl (180 g)', 180, 20, 12, 11, 4, { allergens: ['soy'], tags: ['high-protein'], keywords: ['tempeh'] }),
  f('falafel', 'Falafel (3 pieces)', ['middle-eastern', 'mediterranean'], 'lds', 'protein', '3 pieces (100 g)', 100, 7, 16, 9, 4, { allergens: ['sesame'], tags: ['legume', 'fried'], keywords: ['chickpea'] }),

  // ------------------------------------------------------------ protein dishes: dairy and egg
  f('palak-paneer', 'Palak paneer', IND, 'ld', 'protein', '1 cup (200 g)', 200, 14, 9, 21, 4, { contains: ['dairy', 'allium'], tags: ['high-protein'], keywords: ['cottage cheese', 'spinach'] }),
  f('paneer-bhurji', 'Paneer bhurji', IND, 'bld', 'protein', '1 bowl (150 g)', 150, 15, 6, 20, 2, { contains: ['dairy', 'allium'], tags: ['high-protein'] }),
  f('paneer-tikka', 'Paneer tikka', IND, 'lds', 'protein', '6 pieces (120 g)', 120, 17, 6, 16, 1, { contains: ['dairy'], tags: ['high-protein'] }),
  f('matar-paneer', 'Matar paneer', IND, 'ld', 'protein', '1 cup (200 g)', 200, 13, 14, 17, 4, { contains: ['dairy', 'allium'], keywords: ['peas'] }),
  f('cottage-cheese', 'Cottage cheese', ['american', 'british', '*'], 'bsl', 'protein', '1 cup (150 g)', 150, 17, 5, 6, 0, { contains: ['dairy'], tags: ['high-protein'], portion: [0.5, 1.5, 0.5] }),
  f('boiled-eggs', 'Boiled eggs (2)', ANY, 'bsld', 'protein', '2 eggs (100 g)', 100, 12.6, 1.2, 10.6, 0, { contains: ['egg'], tags: ['high-protein'], portion: [0.5, 2, 0.5] }),
  f('egg-curry', 'Egg curry', IND, 'ld', 'protein', '2 eggs with gravy (220 g)', 220, 14, 8, 17, 2, { contains: ['egg', 'allium'], tags: ['high-protein'] }),
  f('shakshuka', 'Shakshuka', ['middle-eastern', 'mediterranean'], 'bld', 'main', '2 eggs (300 g)', 300, 14, 12, 14, 3, { contains: ['egg', 'allium'] }),

  // ------------------------------------------------------------ protein dishes: meat, fish, seafood
  f('grilled-chicken', 'Grilled chicken breast', ANY, 'ld', 'protein', '120 g', 120, 37, 0, 4.3, 0, { contains: ['meat'], tags: ['high-protein'], portion: [0.5, 2, 0.5] }),
  f('chicken-curry', 'Chicken curry', IND, 'ld', 'protein', '1 cup (200 g)', 200, 26, 8, 14, 2, { contains: ['meat', 'allium'], tags: ['high-protein'] }),
  f('tandoori-chicken', 'Tandoori chicken', IND, 'ld', 'protein', '2 pieces (150 g)', 150, 32, 4, 9, 1, { contains: ['meat', 'dairy'], tags: ['high-protein'] }),
  f('chicken-tikka', 'Chicken tikka', IND, 'lds', 'protein', '6 pieces (150 g)', 150, 30, 4, 7, 1, { contains: ['meat', 'dairy'], tags: ['high-protein'] }),
  f('mutton-curry', 'Mutton curry', IND, 'ld', 'protein', '1 cup (200 g)', 200, 25, 6, 22, 2, { contains: ['meat', 'allium'], tags: ['indulgent'] }),
  f('fish-curry', 'Fish curry', IND, 'ld', 'protein', '1 cup (200 g)', 200, 22, 7, 12, 2, { contains: ['fish', 'allium'], tags: ['high-protein'] }),
  f('grilled-fish', 'Grilled fish fillet', ANY, 'ld', 'protein', '120 g', 120, 26, 0, 5, 0, { contains: ['fish'], tags: ['high-protein'], portion: [0.5, 2, 0.5] }),
  f('grilled-salmon', 'Grilled salmon', ANY, 'ld', 'protein', '120 g', 120, 26, 0, 14, 0, { contains: ['fish'], tags: ['high-protein'], portion: [0.5, 2, 0.5] }),
  f('prawn-masala', 'Prawn masala', IND, 'ld', 'protein', '1 cup (200 g)', 200, 24, 8, 10, 2, { contains: ['shellfish', 'allium'], tags: ['high-protein'] }),
  f('tuna-salad', 'Tuna salad', ['american', 'mediterranean', '*'], 'ld', 'protein', '1 bowl (200 g)', 200, 25, 8, 9, 2, { contains: ['fish'], tags: ['high-protein'] }),
  f('chicken-kebab', 'Chicken kebab', ['middle-eastern', 'mediterranean'], 'ld', 'protein', '4 pieces (150 g)', 150, 32, 4, 9, 1, { contains: ['meat'], tags: ['high-protein'] }),

  // ------------------------------------------------------------ vegetables and sides
  f('mixed-veg-sabzi', 'Mixed vegetable sabzi', IND, 'ld', 'veg', '1 cup (180 g)', 180, 3, 14, 6, 4, { contains: ['allium', 'root'] }),
  f('lauki-sabzi', 'Lauki (bottle gourd) sabzi', IND, 'ld', 'veg', '1 cup (180 g)', 180, 2, 8, 4, 3, { keywords: ['bottle gourd'] }),
  f('bhindi-fry', 'Bhindi (okra) stir-fry', IND, 'ld', 'veg', '1 cup (150 g)', 150, 3, 10, 7, 4, { contains: ['allium'], keywords: ['okra', 'ladyfinger'] }),
  f('aloo-gobi', 'Aloo gobi', IND, 'ld', 'veg', '1 cup (200 g)', 200, 4, 24, 8, 5, { contains: ['root', 'allium'], keywords: ['potato', 'cauliflower'] }),
  f('baingan-bharta', 'Baingan bharta', IND, 'ld', 'veg', '1 cup (200 g)', 200, 3, 13, 8, 5, { contains: ['allium'], keywords: ['aubergine', 'eggplant'] }),
  f('spinach-saute', 'Sautéed spinach', ANY, 'ld', 'veg', '1 cup (180 g)', 180, 4, 6, 5, 4, { keywords: ['spinach', 'palak'] }),
  f('cucumber-tomato-salad', 'Cucumber and tomato salad', ANY, 'ld', 'veg', '1 bowl (150 g)', 150, 1.5, 8, 0.5, 2, { tags: ['light'] }),
  f('sprouts-salad', 'Sprouts salad', IND, 'bsld', 'veg', '1 bowl (150 g)', 150, 9, 18, 2, 6, { tags: ['legume', 'light'], keywords: ['sprouts', 'moong'] }),
  f('steamed-broccoli', 'Steamed broccoli and carrots', ANY, 'ld', 'veg', '1 cup (150 g)', 150, 3.5, 10, 0.5, 4, { contains: ['root'], tags: ['light'], keywords: ['broccoli', 'carrot'] }),
  f('green-salad', 'Green salad with olive oil', ANY, 'ld', 'veg', '1 bowl (150 g)', 150, 2, 8, 7, 3, { tags: ['light'] }),
  f('stir-fried-veg', 'Stir-fried vegetables', ['chinese', 'thai', 'japanese', '*'], 'ld', 'veg', '1 cup (180 g)', 180, 3, 12, 5, 4, { contains: ['allium'], allergens: ['soy'] }),
  f('cabbage-poriyal', 'Cabbage poriyal', IND, 'ld', 'veg', '1 cup (150 g)', 150, 2.5, 9, 5, 3, { keywords: ['cabbage', 'thoran'] }),
  f('vegetable-soup', 'Vegetable soup', ANY, 'ld', 'veg', '1 bowl (250 g)', 250, 3, 13, 1.5, 3, { contains: ['allium', 'root'], tags: ['light'] }),
  f('roasted-veg', 'Roasted vegetables', ['mediterranean', 'american', 'british', '*'], 'ld', 'veg', '1 cup (180 g)', 180, 3, 15, 6, 5, { contains: ['allium', 'root'] }),
  f('raita', 'Raita', IND, 'ld', 'side', '1 bowl (120 g)', 120, 4, 6, 3, 1, { contains: ['dairy', 'allium'] }),
  f('curd', 'Curd (yogurt)', IND, 'bld', 'side', '1 bowl (150 g)', 150, 5, 7, 5.5, 0, { contains: ['dairy'], portion: [0.5, 2, 0.5] }),
  f('hummus-veg', 'Hummus with cucumber', ['mediterranean', 'middle-eastern', '*'], 'lds', 'side', '3 tbsp (60 g)', 60, 4, 9, 7, 3, { allergens: ['sesame'], tags: ['legume'] }),
  f('guacamole', 'Guacamole', ['mexican', 'latin-american', '*'], 'lds', 'side', '1/4 cup (60 g)', 60, 1.5, 6, 11, 4, { contains: ['allium'] }),
  f('avocado', 'Avocado (half)', ANY, 'bld', 'side', '1/2 avocado (100 g)', 100, 1.5, 6, 11, 5, { portion: [0.5, 1.5, 0.5] }),
  f('greek-salad', 'Greek salad', ['mediterranean'], 'ld', 'veg', '1 bowl (250 g)', 250, 5, 10, 16, 3, { contains: ['dairy', 'allium'] }),
  f('chickpea-salad', 'Chickpea salad bowl', ['mediterranean', 'middle-eastern', '*'], 'ld', 'main', '1 bowl (300 g)', 300, 13, 38, 10, 10, { contains: ['allium'], tags: ['legume'] }),
  f('miso-soup', 'Miso soup', ['japanese'], 'ld', 'side', '1 bowl (240 ml)', 240, 3, 5, 1.2, 1, { contains: ['fish'], allergens: ['soy'], tags: ['light'] }),

  // ------------------------------------------------------------ global complete dishes
  f('burrito-bowl', 'Veg burrito bowl', ['mexican', 'american'], 'ld', 'main', '1 bowl (400 g)', 400, 16, 75, 14, 14, { contains: ['allium'], tags: ['legume'] }),
  f('chicken-burrito-bowl', 'Chicken burrito bowl', ['mexican', 'american'], 'ld', 'main', '1 bowl (420 g)', 420, 35, 70, 14, 10, { contains: ['meat', 'allium'], tags: ['high-protein'] }),
  f('quesadilla', 'Bean and cheese quesadilla', ['mexican'], 'ld', 'main', '1 quesadilla (200 g)', 200, 20, 38, 20, 6, { contains: ['dairy'], allergens: ['gluten'], tags: ['indulgent'] }),
  f('falafel-wrap', 'Falafel wrap', ['middle-eastern', 'mediterranean'], 'ld', 'main', '1 wrap (280 g)', 280, 15, 50, 16, 9, { allergens: ['gluten', 'sesame'], tags: ['legume'] }),
  f('pasta-primavera', 'Pasta primavera', ['italian'], 'ld', 'main', '1.5 cups (300 g)', 300, 13, 60, 10, 7, { contains: ['dairy', 'allium'], allergens: ['gluten'] }),
  f('pasta-arrabbiata', 'Pasta arrabbiata', ['italian'], 'ld', 'main', '1.5 cups (300 g)', 300, 12, 62, 8, 6, { contains: ['allium'], allergens: ['gluten'] }),
  f('margherita-pizza', 'Margherita pizza (2 slices)', ['italian'], 'ld', 'main', '2 slices (200 g)', 200, 18, 60, 16, 3, { contains: ['dairy'], allergens: ['gluten'], tags: ['indulgent'], portion: [0.5, 1.5, 0.5] }),
  f('minestrone', 'Minestrone', ['italian', 'mediterranean'], 'ld', 'main', '1.5 cups (360 g)', 360, 8, 28, 4, 8, { contains: ['allium', 'root'], allergens: ['gluten'], tags: ['legume'] }),
  f('teriyaki-tofu-bowl', 'Teriyaki tofu rice bowl', ['japanese'], 'ld', 'main', '1 bowl (400 g)', 400, 20, 68, 10, 5, { allergens: ['soy', 'gluten', 'sesame'], tags: ['high-protein'] }),
  f('chicken-teriyaki-bowl', 'Chicken teriyaki rice bowl', ['japanese'], 'ld', 'main', '1 bowl (400 g)', 400, 35, 70, 9, 3, { contains: ['meat'], allergens: ['soy', 'gluten'], tags: ['high-protein'] }),
  f('salmon-rice-bowl', 'Salmon rice bowl', ['japanese'], 'ld', 'main', '1 bowl (380 g)', 380, 32, 65, 16, 3, { contains: ['fish'], allergens: ['soy'], tags: ['high-protein'] }),
  f('veg-sushi', 'Vegetable sushi roll (6)', ['japanese'], 'ld', 'main', '6 pieces (200 g)', 200, 6, 42, 2, 3, { allergens: ['soy', 'sesame'], tags: ['light'] }),
  f('veg-bibimbap', 'Vegetable bibimbap', ['korean'], 'ld', 'main', '1 bowl (450 g)', 450, 14, 80, 12, 8, { contains: ['egg', 'allium'], allergens: ['soy', 'sesame'] }),
  f('veg-fried-rice', 'Vegetable fried rice', ['chinese'], 'ld', 'main', '1.5 cups (300 g)', 300, 9, 65, 10, 4, { contains: ['allium'], allergens: ['soy'] }),
  f('veg-dumplings', 'Steamed vegetable dumplings (6)', ['chinese'], 'ld', 'main', '6 pieces (180 g)', 180, 10, 40, 8, 4, { contains: ['allium'], allergens: ['gluten', 'soy'] }),
  f('thai-green-curry', 'Vegetable and tofu green curry', ['thai'], 'ld', 'protein', '1 bowl (250 g)', 250, 12, 14, 18, 4, { contains: ['allium'], allergens: ['soy'] }),
  f('turkey-sandwich', 'Turkey sandwich', ['american', 'british'], 'ld', 'main', '2 slices (220 g)', 220, 28, 34, 8, 4, { contains: ['meat'], allergens: ['gluten'], tags: ['high-protein'] }),
  f('chicken-salad-bowl', 'Grilled chicken salad bowl', ['american', 'mediterranean', '*'], 'ld', 'main', '1 bowl (350 g)', 350, 35, 14, 14, 5, { contains: ['meat'], tags: ['high-protein'] }),
  f('chicken-biryani', 'Chicken biryani', IND, 'ld', 'main', '1 cup (240 g)', 240, 18, 40, 11, 2, { contains: ['meat', 'allium', 'dairy'], tags: ['indulgent'] }),
  f('cottage-cheese-fruit', 'Cottage cheese and fruit bowl', ['american', 'british', '*'], 'bs', 'main', '1 bowl (250 g)', 250, 14, 20, 4, 3, { contains: ['dairy'], tags: ['high-protein'] }),

  // ------------------------------------------------------------ fruit
  f('banana', 'Banana', ANY, 'bsl', 'fruit', '1 medium (118 g)', 118, 1.3, 27, 0.4, 3, { portion: [0.5, 2, 0.5] }),
  f('apple', 'Apple', ANY, 'bsl', 'fruit', '1 medium (180 g)', 180, 0.5, 25, 0.3, 4.4, { portion: [0.5, 2, 0.5] }),
  f('orange', 'Orange', ANY, 'bsl', 'fruit', '1 medium (130 g)', 130, 1.2, 15, 0.2, 3, { portion: [0.5, 2, 0.5] }),
  f('papaya', 'Papaya', ['indian', 'latin-american', 'thai', '*'], 'bsl', 'fruit', '1 cup (150 g)', 150, 0.7, 14, 0.4, 2.5),
  f('guava', 'Guava', IND, 'sl', 'fruit', '1 medium (100 g)', 100, 2.5, 14, 1, 5, { portion: [0.5, 2, 0.5] }),
  f('mango', 'Mango', ['indian', 'latin-american', 'thai', '*'], 'bsl', 'fruit', '1 cup (165 g)', 165, 1.4, 25, 0.6, 2.6),
  f('berries', 'Mixed berries', ['american', 'british', 'mediterranean', '*'], 'bs', 'fruit', '1 cup (140 g)', 140, 1, 18, 0.5, 5),
  f('watermelon', 'Watermelon', ANY, 'sl', 'fruit', '2 cups (300 g)', 300, 1.5, 23, 0.4, 1, { portion: [0.5, 1.5, 0.5] }),
  f('fruit-bowl', 'Mixed fruit bowl', ANY, 'bsl', 'fruit', '1 cup (150 g)', 150, 1.5, 28, 0.5, 4),
  f('pomegranate', 'Pomegranate seeds', ['indian', 'middle-eastern', 'mediterranean'], 'sl', 'fruit', '1/2 cup (87 g)', 87, 1.5, 15, 1, 3.5),

  // ------------------------------------------------------------ snacks
  f('roasted-chana', 'Roasted chana', IND, 's', 'snack', '1 handful (30 g)', 30, 6, 18, 2, 5, { tags: ['legume'], keywords: ['chickpea'] }),
  f('almonds', 'Almonds', ANY, 's', 'snack', '1 handful (28 g)', 28, 6, 6, 14, 3.5, { allergens: ['nuts'], tags: ['high-protein'], portion: [0.5, 1.5, 0.5] }),
  f('mixed-nuts', 'Mixed nuts', ANY, 's', 'snack', '1 handful (28 g)', 28, 5, 7, 15, 2.5, { allergens: ['nuts', 'peanuts'], portion: [0.5, 1.5, 0.5] }),
  f('roasted-peanuts', 'Roasted peanuts', ANY, 's', 'snack', '1 handful (28 g)', 28, 7, 6, 14, 2.5, { allergens: ['peanuts'], portion: [0.5, 1.5, 0.5] }),
  f('makhana', 'Roasted makhana (fox nuts)', IND, 's', 'snack', '1 cup (30 g)', 30, 3, 22, 1, 2, { tags: ['light'] }),
  f('apple-pb', 'Apple with peanut butter', ['american', '*'], 's', 'snack', '1 apple, 1 tbsp (200 g)', 200, 4, 28, 8, 5, { allergens: ['peanuts'] }),
  f('greek-yogurt-cup', 'Greek yogurt (plain)', ['mediterranean', 'american', '*'], 'bs', 'snack', '1 cup (150 g)', 150, 15, 6, 1, 0, { contains: ['dairy'], tags: ['high-protein'] }),
  f('hummus-carrot', 'Hummus with carrot sticks', ['mediterranean', 'middle-eastern', '*'], 's', 'snack', '1 portion (130 g)', 130, 4, 14, 7, 5, { contains: ['root'], allergens: ['sesame'] }),
  f('dates', 'Dates (3)', ['middle-eastern', 'indian', '*'], 's', 'snack', '3 dates (60 g)', 60, 1, 27, 0.2, 3, { tags: ['sweet'] }),
  f('dark-chocolate', 'Dark chocolate', ANY, 's', 'snack', '20 g', 20, 1.5, 11, 8, 2, { tags: ['sweet', 'indulgent'] }),
  f('popcorn', 'Air-popped popcorn', ['american', '*'], 's', 'snack', '3 cups (24 g)', 24, 3, 18, 1, 3.5, { tags: ['light', 'whole-grain'] }),
  f('boiled-egg-snack', 'Boiled egg', ANY, 's', 'snack', '1 egg (50 g)', 50, 6, 0.6, 5, 0, { contains: ['egg'], tags: ['high-protein'], portion: [1, 3, 1] }),
  f('sprout-chaat', 'Sprout chaat', IND, 's', 'snack', '1 bowl (150 g)', 150, 9, 18, 2, 6, { contains: ['allium'], tags: ['legume', 'light'] }),
  f('cheese-cubes', 'Cheese cubes', ['american', 'british', 'mediterranean', '*'], 's', 'snack', '30 g', 30, 7, 0.5, 9, 0, { contains: ['dairy'], portion: [0.5, 2, 0.5] }),

  // ------------------------------------------------------------ drinks
  f('buttermilk', 'Buttermilk (chaas)', IND, 'bsl', 'drink', '1 glass (250 ml)', 250, 3, 5, 1.5, 0, { contains: ['dairy'], tags: ['light'] }),
  f('milk', 'Milk', ANY, 'bs', 'drink', '1 glass (250 ml)', 250, 8, 12, 8, 0, { contains: ['dairy'] }),
  f('soy-milk', 'Soy milk', ANY, 'bs', 'drink', '1 glass (250 ml)', 250, 7, 8, 4, 1, { allergens: ['soy'] }),
  f('coconut-water', 'Coconut water', ['indian', 'thai', 'latin-american', '*'], 'sl', 'drink', '1 glass (250 ml)', 250, 0.7, 9, 0.5, 0, { tags: ['light'] }),
  f('masala-chai', 'Masala chai', IND, 'bs', 'drink', '1 cup (150 ml)', 150, 2.5, 10, 3, 0, { contains: ['dairy'] }),
  f('whey-shake', 'Whey protein shake (in water)', ANY, 'bs', 'drink', '1 scoop (30 g)', 30, 24, 3, 1.5, 0, { contains: ['dairy'], tags: ['high-protein'], portion: [0.5, 1.5, 0.5] }),
  f('plant-protein-shake', 'Plant protein shake (in water)', ANY, 'bs', 'drink', '1 scoop (30 g)', 30, 21, 4, 2, 2, { tags: ['high-protein'], portion: [0.5, 1.5, 0.5] }),
]

// ------------------------------------------------------------------ diets, derived from ingredient classes

const NO_ANIMAL_FLESH: Ingredient[] = ['meat', 'fish', 'shellfish', 'gelatin']

/** Whether a food fits a diet. Derived from the ingredient classes, never from the food's name. */
export function allowsDiet(food: Pick<Food, 'contains'>, diet: DietType): boolean {
  const has = (...xs: Ingredient[]) => xs.some((x) => food.contains.includes(x))
  switch (diet) {
    case 'nonveg':
      return true
    case 'pescatarian':
      return !has('meat', 'gelatin')
    case 'eggetarian':
      return !has(...NO_ANIMAL_FLESH)
    case 'vegetarian':
      return !has(...NO_ANIMAL_FLESH, 'egg')
    case 'vegan':
      return !has(...NO_ANIMAL_FLESH, 'egg', 'dairy', 'honey')
    case 'jain':
      return !has(...NO_ANIMAL_FLESH, 'egg', 'honey', 'root', 'allium', 'mushroom')
  }
}

export const MEAL_ROLES = ['main', 'carb', 'protein', 'veg', 'side', 'fruit', 'drink', 'snack'] as const
