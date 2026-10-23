// What an activity is, what it works, and whether the calories you logged are plausible.
// Offline and free: a table of common activities with MET values (the standard measure of exercise intensity,
// from the Compendium of Physical Activities). kcal burned = MET x body weight (kg) x hours.
export type Intensity = 'light' | 'moderate' | 'vigorous'

export interface ActivityInfo {
  id: string
  label: string
  /** metabolic equivalent: 1 = resting, 8 = about 8x resting energy use */
  met: number
  intensity: Intensity
  muscles: string[]
  benefits: string[]
  tips: string[]
}

interface Row extends ActivityInfo {
  match: RegExp
}

const rows: Row[] = [
  { id: 'run', match: /\b(run|running|jog|jogging|sprint|treadmill run)\b/i, label: 'Running', met: 9.8, intensity: 'vigorous', muscles: ['Quadriceps', 'Hamstrings', 'Calves', 'Glutes', 'Core'], benefits: ['Strong for heart and lung fitness', 'Burns a lot of calories per minute', 'Builds bone density in the legs'], tips: ['Build up distance by about 10% a week', 'Walk for 5 minutes first and last to warm up and cool down', 'Replace shoes every 600–800 km'] },
  { id: 'walk', match: /\b(walk|walking|stroll|brisk walk|power walk)\b/i, label: 'Walking', met: 3.8, intensity: 'light', muscles: ['Calves', 'Quadriceps', 'Glutes', 'Hamstrings'], benefits: ['Easy on the joints, so you can do it daily', 'Helps blood sugar after meals', 'Good for mood and sleep'], tips: ['A 10-minute walk after meals helps digestion and blood sugar', 'Walk fast enough that you can talk but not sing for a "brisk" pace'] },
  { id: 'cycle', match: /\b(cycl\w*|bike|biking|spin|spinning)\b/i, label: 'Cycling', met: 7.5, intensity: 'moderate', muscles: ['Quadriceps', 'Hamstrings', 'Glutes', 'Calves'], benefits: ['Low impact, kind to knees and hips', 'Builds leg endurance and heart fitness', 'Doubles as transport'], tips: ['Set the saddle so your knee is slightly bent at the bottom of the stroke', 'Vary the pace: 1 minute hard, 2 minutes easy'] },
  { id: 'swim', match: /\b(swim|swimming|laps|pool)\b/i, label: 'Swimming', met: 6, intensity: 'moderate', muscles: ['Shoulders', 'Back', 'Core', 'Legs'], benefits: ['Full-body workout with almost no impact', 'Great for heart and lung fitness', 'Gentle on injured joints'], tips: ['Mix strokes to work different muscles', 'Drink water: you still sweat in the pool'] },
  { id: 'yoga', match: /\b(yoga|asana|pranayama|vinyasa|hatha)\b/i, label: 'Yoga', met: 2.8, intensity: 'light', muscles: ['Core', 'Hips', 'Shoulders', 'Back'], benefits: ['Improves flexibility and balance', 'Reduces stress and helps sleep', 'Builds core strength slowly'], tips: ['Move with your breath, never into pain', 'Burn is modest, so the value is in recovery and mobility'] },
  { id: 'surya', match: /\b(surya namaskar|sun salutation)\b/i, label: 'Surya Namaskar', met: 3.8, intensity: 'moderate', muscles: ['Shoulders', 'Core', 'Hamstrings', 'Hips'], benefits: ['Warms the whole body in a few minutes', 'Mobility for spine and hips', 'Easy to do anywhere'], tips: ['Do 6–12 rounds at a steady pace', 'Keep the breath smooth: inhale up, exhale down'] },
  { id: 'strength', match: /\b(gym|weights?|weight ?training|strength|lifting|lift|resistance|dumbbells?|barbell|bodyweight|push ?ups?|pull ?ups?|workout)\b/i, label: 'Strength training', met: 5, intensity: 'moderate', muscles: ['Depends on the lifts: chest, back, legs, shoulders, arms, core'], benefits: ['Builds and keeps muscle, which keeps metabolism up while dieting', 'Strengthens bones and joints', 'Keeps burning slightly more calories for hours afterwards'], tips: ['Aim for each muscle group twice a week', 'Add weight or reps gradually', 'Eat protein within a few hours of training'] },
  { id: 'hiit', match: /\b(hiit|interval|circuit|crossfit|tabata|burpees?)\b/i, label: 'HIIT / circuit', met: 8, intensity: 'vigorous', muscles: ['Full body', 'Core', 'Legs'], benefits: ['A lot of calorie burn in a short time', 'Improves heart fitness quickly', 'Keeps the body burning extra energy afterwards'], tips: ['Two or three sessions a week is plenty', 'Leave a rest day between hard sessions', 'Quality movement matters more than speed'] },
  { id: 'skip', match: /\b(skipping|jump rope|rope)\b/i, label: 'Skipping rope', met: 11, intensity: 'vigorous', muscles: ['Calves', 'Shoulders', 'Core'], benefits: ['One of the highest calorie burns per minute', 'Improves coordination and footwork', 'Needs almost no equipment'], tips: ['Land softly on the balls of your feet', 'Start with 30-second rounds'] },
  { id: 'football', match: /\b(football|soccer|futsal)\b/i, label: 'Football', met: 7, intensity: 'vigorous', muscles: ['Legs', 'Core', 'Calves'], benefits: ['Mixes sprints and jogging, great for fitness', 'Social, so easier to keep doing', 'Improves agility'], tips: ['Warm up the ankles and hamstrings', 'Hydrate well in hot weather'] },
  { id: 'cricket', match: /\b(cricket|bowling|batting)\b/i, label: 'Cricket', met: 4.8, intensity: 'moderate', muscles: ['Legs', 'Shoulders', 'Core'], benefits: ['Mix of short bursts and walking', 'Hand-eye coordination', 'Social and outdoors'], tips: ['Warm up the shoulders before bowling', 'Sunscreen and water in the heat'] },
  { id: 'badminton', match: /\b(badminton|shuttle)\b/i, label: 'Badminton', met: 5.5, intensity: 'moderate', muscles: ['Legs', 'Shoulders', 'Core'], benefits: ['Fast footwork improves agility and reflexes', 'Good heart workout in short rallies', 'Easy to play indoors'], tips: ['Warm up the shoulders and ankles', 'Stay low and light on your feet'] },
  { id: 'tennis', match: /\b(tennis|squash|pickleball|table tennis|ping ?pong)\b/i, label: 'Racket sport', met: 6.5, intensity: 'moderate', muscles: ['Legs', 'Shoulders', 'Core', 'Forearms'], benefits: ['Mix of sprints and rests, good for heart fitness', 'Hand-eye coordination'], tips: ['Warm up shoulders and wrists', 'Play both sides to avoid imbalances'] },
  { id: 'basketball', match: /\b(basketball|netball)\b/i, label: 'Basketball', met: 6.5, intensity: 'vigorous', muscles: ['Legs', 'Core', 'Shoulders'], benefits: ['Jumping and sprinting build power', 'High calorie burn'], tips: ['Strengthen ankles to reduce sprains'] },
  { id: 'dance', match: /\b(danc\w*|zumba|aerobics|bhangra|garba)\b/i, label: 'Dance / aerobics', met: 5.5, intensity: 'moderate', muscles: ['Legs', 'Core', 'Hips'], benefits: ['Fun, so you actually keep doing it', 'Good for heart fitness and coordination', 'Improves mood'], tips: ['Wear supportive shoes', 'Keep moving between songs to keep your heart rate up'] },
  { id: 'hike', match: /\b(hike|hiking|trek|trekking|climb|climbing stairs|stairs|stair)\b/i, label: 'Hiking / stairs', met: 6.5, intensity: 'moderate', muscles: ['Glutes', 'Quadriceps', 'Calves', 'Core'], benefits: ['Strong leg and glute workout', 'Time outdoors helps mood', 'Climbing raises heart rate quickly'], tips: ['Shorten your stride going uphill', 'Poles reduce knee load on descents'] },
  { id: 'row', match: /\b(rowing|rower|kayak|canoe)\b/i, label: 'Rowing', met: 7, intensity: 'vigorous', muscles: ['Back', 'Legs', 'Arms', 'Core'], benefits: ['Works the legs, back and arms together', 'Low impact on joints'], tips: ['Push with the legs first, then lean back, then pull with the arms'] },
  { id: 'elliptical', match: /\b(elliptical|cross ?trainer|stepper)\b/i, label: 'Elliptical', met: 5, intensity: 'moderate', muscles: ['Legs', 'Glutes', 'Arms'], benefits: ['No impact on joints', 'Steady, sustainable cardio'], tips: ['Stand tall and avoid leaning on the handles'] },
  { id: 'boxing', match: /\b(boxing|kickboxing|martial|karate|judo|mma|taekwondo|punching)\b/i, label: 'Boxing / martial arts', met: 7.8, intensity: 'vigorous', muscles: ['Shoulders', 'Core', 'Legs', 'Arms'], benefits: ['High calorie burn', 'Coordination, reflexes and stress relief'], tips: ['Protect your wrists with correct form or wraps'] },
  { id: 'pilates', match: /\b(pilates|barre)\b/i, label: 'Pilates', met: 3, intensity: 'light', muscles: ['Core', 'Glutes', 'Back'], benefits: ['Builds deep core strength and posture', 'Gentle on joints'], tips: ['Small, controlled movements beat big ones'] },
  { id: 'stretch', match: /\b(stretch|stretching|mobility|foam roll|warm ?up|cool ?down)\b/i, label: 'Stretching / mobility', met: 2.3, intensity: 'light', muscles: ['Whole body'], benefits: ['Keeps joints moving well', 'Helps you recover between harder sessions'], tips: ['Hold each stretch 20–30 seconds, without bouncing'] },
  { id: 'chores', match: /\b(clean|cleaning|housework|chores|gardening|mopping|sweeping|cooking)\b/i, label: 'Household activity', met: 3.3, intensity: 'light', muscles: ['Whole body'], benefits: ['Everyday movement adds up across a week'], tips: ['Counts, but is easy to overestimate. Log it only if it was sustained'] },
]

const FALLBACK: ActivityInfo = { id: 'general', label: 'Activity', met: 4.5, intensity: 'moderate', muscles: [], benefits: [], tips: [] }

/** Best match for an activity description, or null when it is not in the table. */
export function matchActivity(text: string): ActivityInfo | null {
  const hit = rows.find((r) => r.match.test(text))
  if (!hit) return null
  const { match: _m, ...info } = hit
  return info
}

/** Minutes from text like "30 min", "1 hour", "1.5 hrs", "1h 20m". Returns null when no duration is written. */
export function parseMinutes(text: string): number | null {
  const t = text.toLowerCase()
  const hm = /(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\b\s*(?:(\d+)\s*(?:m|min|mins|minutes?)?)?/.exec(t)
  if (hm) {
    const mins = Math.round(Number(hm[1]) * 60 + (hm[2] ? Number(hm[2]) : 0))
    return mins > 0 && mins <= 1440 ? mins : null
  }
  const m = /(\d+(?:\.\d+)?)\s*(?:m|min|mins|minute|minutes)\b/.exec(t)
  if (m) {
    const mins = Math.round(Number(m[1]))
    return mins > 0 && mins <= 1440 ? mins : null
  }
  return null
}

/** Kilometres from text like "5 km" or "10k". */
export function parseKm(text: string): number | null {
  const m = /(\d+(?:\.\d+)?)\s*(?:km|kms|kilomet\w+|k)\b/i.exec(text)
  return m ? Number(m[1]) : null
}

export interface ActivityReport {
  info: ActivityInfo | null
  minutes: number | null
  km: number | null
  /** what the standard formula gives for this person, or null without a duration or weight */
  expectedKcal: number | null
  loggedKcal: number
  /** logged / expected */
  ratio: number | null
  verdict: 'plausible' | 'high' | 'low' | 'unknown'
  note: string
  kcalPerMinute: number | null
  paceMinPerKm: number | null
  /** food equivalents of the calories logged */
  equivalents: { label: string; count: number }[]
}

const round = (n: number, d = 0) => Math.round(n * 10 ** d) / 10 ** d

export function activityReport(input: { name: string; quantity: string; calories: number; weightKg: number | null }): ActivityReport {
  const text = `${input.name} ${input.quantity}`
  const info = matchActivity(text)
  const minutes = parseMinutes(text)
  const km = parseKm(text)
  const w = input.weightKg && input.weightKg > 30 ? input.weightKg : null
  const met = info?.met ?? FALLBACK.met
  const expected = minutes && w ? round(met * w * (minutes / 60)) : null
  const ratio = expected ? round(input.calories / expected, 2) : null
  let verdict: ActivityReport['verdict'] = 'unknown'
  let note = ''
  if (!minutes) note = 'Add the duration (for example "30 min") to check the calories against the standard formula.'
  else if (!w) note = 'Add your weight in Goals to check the calories against the standard formula.'
  else if (!info) note = 'This activity is not in the standard table, so the estimate uses a general moderate-effort value.'
  if (ratio !== null) {
    if (ratio > 1.4) {
      verdict = 'high'
      note = `This looks high: the standard formula gives about ${expected} kcal for ${minutes} minutes at your weight. Watches and AI estimates often overshoot. Consider using ${expected}.`
    } else if (ratio < 0.65) {
      verdict = 'low'
      note = `This is lower than typical (about ${expected} kcal). That is fine if you took it easy, so edit it if you went harder.`
    } else {
      verdict = 'plausible'
      note = `Close to the standard estimate of about ${expected} kcal for ${minutes} minutes at your weight.`
    }
  }
  const kcal = Math.max(0, input.calories)
  return {
    info,
    minutes,
    km,
    expectedKcal: expected,
    loggedKcal: kcal,
    ratio,
    verdict,
    note,
    kcalPerMinute: minutes ? round(kcal / minutes, 1) : null,
    paceMinPerKm: minutes && km && km > 0 ? round(minutes / km, 1) : null,
    equivalents: kcal >= 30 ? [{ label: 'bananas', count: round(kcal / 105, 1) }, { label: 'rotis', count: round(kcal / 100, 1) }] : [],
  }
}
