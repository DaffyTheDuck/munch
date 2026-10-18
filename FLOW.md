# Flows

How a person moves through Journable, and how data moves through the system underneath. Diagrams use [Mermaid](https://mermaid.js.org) and render on GitHub and in most Markdown viewers.

Related documents: [Architecture.md](Architecture.md) (components and data model), [DECISIONS.md](DECISIONS.md) (why it is built this way).

**Reading the diagrams.** *Client* means the web app or the phone app (they behave the same unless a step says otherwise). *Local DB* is IndexedDB on the web and SQLite on the phone. *API* is the small Node server. *Provider* is a language-model service (Gemini, Groq or Anthropic).

## Contents

1. [A first day, end to end](#1-a-first-day-end-to-end)
2. [Logging a meal from text or a photo](#2-logging-a-meal-from-text-or-a-photo)
3. [Choosing the meal from the clock](#3-choosing-the-meal-from-the-clock)
4. [Correcting an entry (how the app learns)](#4-correcting-an-entry-how-the-app-learns)
5. [Everyday gestures](#5-everyday-gestures)
6. [Planning the day with the recommendation engine](#6-planning-the-day-with-the-recommendation-engine)
7. [The coach](#7-the-coach)
8. [Signing in and syncing](#8-signing-in-and-syncing)
9. [Calling the API: authentication and fallback](#9-calling-the-api-authentication-and-fallback)
10. [Setting goals](#10-setting-goals)
11. [Running, building and shipping](#11-running-building-and-shipping)
12. [What the user sees when something goes wrong](#12-what-the-user-sees-when-something-goes-wrong)

---

## 1. A first day, end to end

```mermaid
flowchart TD
  A([Open the app]) --> B{Firebase configured?}
  B -- no --> D
  B -- yes --> C[Welcome screen:<br/>Continue with Google]
  C --> C2[Signed in, local data adopted,<br/>sync starts]
  C2 --> D[Log screen]
  D --> E{Goals saved?}
  E -- no --> F[Card: Set your daily goal]
  F --> G[Goals tab: target weight,<br/>age, height, activity, pace]
  G --> H[Plan shown: calories + macros<br/>+ weeks to goal]
  H --> I[Use these numbers]
  E -- yes --> J
  I --> J[Log screen with a calorie ring]
  J --> K[Type or photograph what you ate]
  K --> L[Entries appear, grouped by meal]
  J --> M[Plan tab]
  M --> N{Food preferences saved?}
  N -- no --> O[How do you eat?<br/>diet, weekday rules, allergies,<br/>dislikes, cuisines]
  O --> P
  N -- yes --> P[Plan my day / Rest of today]
  P --> Q[Review, swap, log meals]
  L --> R[Coach tab: ask about your week]
```

Everything works without an account. Sign-in only adds cross-device sync and server protection.

---

## 2. Logging a meal from text or a photo

The most important flow in the app.

```mermaid
sequenceDiagram
  autonumber
  actor U as User
  participant C as Client
  participant DB as Local DB
  participant API as API server
  participant P as Provider (LLM)
  participant FDC as USDA FoodData Central

  U->>C: types "khari puff aur chai" or attaches a photo
  C->>C: photo? resize to 1024 px, JPEG
  C->>DB: find past corrections whose words overlap
  DB-->>C: up to 5 hints
  C->>API: POST /api/analyze {text, image, hints} + Bearer token
  API->>API: verify Google sign-in token (if auth is on), rate limit
  API->>P: system prompt + text + image + hints
  Note over API,P: fallback chain: next provider if this one<br/>is busy, over quota, or times out
  P-->>API: JSON items (name, grams, kcal, macros, lookup)
  API->>API: Zod validate (one repair call if invalid)
  loop each food item
    API->>FDC: search by "lookup" (cached)
    FDC-->>API: candidates
    API->>API: accept only if name, macros and energy agree
  end
  API-->>C: items with source = usda or ai
  C->>DB: insert entries (meal from the clock)
  C->>U: entries slide in, "Added 2 items" + Undo
  C->>C: local change triggers a sync soon
```

**Branches.**
- *Nothing found:* the model returns no items; the client shows its note ("not food") and adds nothing.
- *Undo:* deletes exactly the rows just created (and leaves a tombstone for sync).
- *Photos:* only a 160 px thumbnail is kept with the entry; the full image is sent once and discarded.

---

## 3. Choosing the meal from the clock

```mermaid
flowchart LR
  T[Local time at the moment of logging] --> H{hour}
  H -- "23:00 – 03:59" --> S1[Snack]
  H -- "04:00 – 10:59" --> BF[Breakfast]
  H -- "11:00 – 14:59" --> LU[Lunch]
  H -- "15:00 – 17:59" --> S2[Snack]
  H -- "18:00 – 22:59" --> DI[Dinner]
  O[+ Add on a meal slot] -. overrides once .-> X[That meal]
```

The pill beside the input always shows the current meal and time, and refreshes every 15 seconds. A meal can be changed afterwards by dragging the entry to another meal (web) or in the edit sheet.

---

## 4. Correcting an entry (how the app learns)

```mermaid
flowchart TD
  A[Tap an entry] --> B[Edit sheet]
  B --> C{What changed?}
  C -- "Portion stepper (− / +)" --> D[Rescale calories, macros, grams together<br/>NOT a correction]
  C -- "Typed new calories or macros" --> E[Mark entry as edited]
  E --> F[Save a correction:<br/>name, quantity, numbers]
  F --> G[Next time similar words appear,<br/>the correction is sent to the model as a hint]
  C -- "Name, quantity, meal only" --> H[Save, no correction]
  B --> I[Delete] --> J[Undo available for a few seconds]
```

---

## 5. Everyday gestures

| Where | Gesture | Result |
| --- | --- | --- |
| Entry (phone) | Swipe **right** | Duplicate it (with undo) |
| Entry (phone) | Swipe **left** | Delete it (with undo) |
| Entry (web) | Hover, then − / + / copy / bin | Portion ±½, duplicate, delete |
| Entry | Tap | Edit sheet (phone) or dialog (web) |
| Entry (web) | Drag onto another meal | Move it (with undo) |
| Meal heading | + | Next entry goes into that meal |
| "Log again" chips | Tap | Re-add a recent food to the current meal |
| Day header | ← / → (web), tap a day in the week strip | Change day; `T` jumps to today |
| Phone | Haptic tick, press, success, error | Confirms taps, steppers, swipes and results |

Every destructive action is reversible for a few seconds.

---

## 6. Planning the day with the recommendation engine

### 6.1 What the user does

```mermaid
flowchart TD
  A[Plan tab] --> B[Whole day / Rest of today]
  B --> C[Targets shown:<br/>calories, protein, carbs, fat]
  C --> D[Plan my day]
  D --> E[Plan appears in ~20 ms:<br/>meals, items, why each was chosen]
  E --> F{Next}
  F -- "Log this meal" --> G[Entries added, meal counted as liked]
  F -- "Log everything" --> G
  F -- "Swap" --> H[Another meal from the engine,<br/>old dishes counted as swapped away]
  F -- "Plan again" --> I[New plan from a new random seed]
  F -- "Try AI suggestions" --> J[Language-model planner instead]
```

"Rest of today" subtracts what you have already eaten (and adds back calories burned), and plans only the meals that are still ahead and not yet logged.

### 6.2 What the engine does

```mermaid
flowchart TD
  IN[/Preferences + date + meals + target<br/>+ history + learned taste + avoid list/] --> D[Diet for this weekday]
  D --> F1[1. FILTER the pool<br/>diet flags, allergens, dislikes, avoid list]
  F1 --> S[2. SCORE each food<br/>cuisine, familiarity, sampled taste,<br/>health, recency, small jitter]
  S --> O[Order meals by size: lunch, dinner, breakfast, snack]
  O --> L{For each meal}
  L --> T[3. SEARCH role templates<br/>e.g. carb + protein + veg<br/>top 6 per role, ≤ 700 combinations]
  T --> Q[4. OPTIMISE portions per combination<br/>bounded least squares, snap to steps]
  Q --> B[Pick best: fit cost × 100 − preference<br/>coherent cuisine first]
  B --> U[Mark foods used, next meal]
  U --> L
  L -- done --> R[5. REFINE all portions together<br/>against the whole day's targets]
  R --> X[6. EXPLAIN: reasons + nutrient tips]
  X --> OUT[/Plan: meals, totals, fiber, unfilled meals/]
  OUT --> G{Any meal unfilled?}
  G -- no --> DONE([Show it])
  G -- yes --> AI[Ask the AI planner for just those meals]
  AI --> M[Merge, label 'Engine + AI']
  M --> DONE
  AI -. server unreachable .-> N[Show what we have + a note]
```

### 6.3 The learning loop

```mermaid
flowchart LR
  P[Plan shown] -->|Log meal| L[liked: α + 1 for each food]
  P -->|Swap| W[swapped: β + 1 for each food]
  L --> T[(Taste beliefs<br/>Beta per food)]
  W --> T
  T -->|sample θ ~ Beta| S[Next plan's scores]
  T -->|syncs between devices| T2[(Other device)]
  H[(Logged history)] -->|familiar foods become candidates,<br/>recent foods are penalised| S
```

---

## 7. The coach

Your data stays on the device. The model asks for the pieces it needs, the device runs those lookups, and the answer is built from the results.

```mermaid
sequenceDiagram
  autonumber
  actor U as User
  participant C as Client
  participant DB as Local DB
  participant API as API (LangGraph)
  participant P as Provider (LLM)

  U->>C: "How did my last 7 days go?"
  C->>API: POST /api/coach/chat {thread, message, today, goals}
  API->>P: system prompt + tool schemas + history
  P-->>API: tool calls: get_range_summary, get_weights (in parallel)
  Note over API: graph pauses at interrupt()
  API-->>C: {status: "tool", calls}
  C->>DB: run each tool locally
  DB-->>C: results
  C->>U: shows chips: which tools were used
  C->>API: POST /api/coach/resume {thread, results}
  API->>P: history + tool results
  P-->>API: final answer text
  API-->>C: {status: "answer", text}
  C->>U: answer citing the real numbers
```

At most five model turns per question. If a request fails mid-conversation, the client starts a fresh thread (a pending tool call would otherwise block the next question; the server answers `409 thread_busy`). With `COACH_ENGINE=classic` the same idea runs through a JSON protocol on `/api/coach`.

---

## 8. Signing in and syncing

### 8.1 Lifecycle

```mermaid
stateDiagram-v2
  [*] --> LocalOnly: no Firebase config
  [*] --> SignedOut: Firebase configured
  SignedOut --> Claiming: Google sign-in succeeds
  Claiming --> SignedOut: different account's data on device,<br/>user declines to replace it
  Claiming --> Syncing: data adopted or replaced
  Syncing --> Idle: sync finished
  Idle --> Syncing: local edit (1.5 s debounce),<br/>app focus / foreground, every 30 s
  Syncing --> Error: network or permission error
  Error --> Syncing: next trigger
  Idle --> SignedOut: sign out (data stays on device)
```

**Claiming local data.** The device remembers which account owns its data. First sign-in adopts whatever is already there (so your existing log is uploaded). Signing in with a *different* account on a device that already holds another account's data asks before replacing it; the other account's data stays safe in the cloud.

### 8.2 One sync cycle

```mermaid
sequenceDiagram
  autonumber
  participant E as Sync engine
  participant L as Local adapter
  participant R as Firestore adapter

  E->>L: prepare()  (legacy rows get ids, goals marked dirty)
  loop each collection: entries, weights, corrections, settings
    E->>L: getMeta("pull:collection")  → cursor
    loop until no more pages
      E->>R: pull(collection, cursor)
      R-->>E: records newer than cursor + new cursor
      E->>L: applyRemote(records)  (last write wins, never marks dirty)
      E->>L: setMeta(cursor)
    end
    E->>L: dirty(collection)  (edits and tombstones not yet uploaded)
    E->>R: push(batch of up to 200)
    E->>L: markClean(only if not edited again meanwhile)
  end
```

### 8.3 Conflict examples

```mermaid
flowchart TD
  subgraph S1[Same item edited on two devices]
    A1[Phone edits at 10:00] --> M1{Which is newer?}
    B1[Web edits at 10:05] --> M1
    M1 --> R1[10:05 wins everywhere]
  end
  subgraph S2[Old offline edit meets a newer one]
    A2[Phone offline: edit at 09:00] --> D2[Syncs later: DOWNLOADS first]
    B2[Web: edit at 10:00, already uploaded] --> D2
    D2 --> R2[Phone's older edit is replaced,<br/>never uploaded over the newer one]
  end
  subgraph S3[Delete versus edit]
    A3[Phone deletes at 10:00] --> M3{Which is newer?}
    B3[Web edits at 10:30] --> M3
    M3 --> R3[Edit wins: item kept]
  end
```

Undo after a delete re-creates the same record, which wins over its own tombstone (the tombstone is dropped before upload).

### 8.4 Offline

Nothing in the app needs the network except AI calls and sync. Offline, logging by hand-editing, planning (the engine runs locally), the calendar, the weight chart and goals all work. Edits queue as dirty rows and upload automatically when a sync next succeeds.

---

## 9. Calling the API: authentication and fallback

```mermaid
flowchart TD
  R[Request to /api/analyze, /api/coach*, /api/plan] --> A{FIREBASE_PROJECT_ID set?}
  A -- no --> OK
  A -- yes --> T{Bearer token present?}
  T -- no --> E401a[401 Please sign in]
  T -- yes --> V{Valid RS256 token for this project?}
  V -- no --> E401b[401 Sign-in expired]
  V -- yes --> W{ALLOWED_EMAILS set?}
  W -- yes --> M{Verified email in the list?}
  M -- no --> E403[403 Not allowed]
  M -- yes --> RL
  W -- no --> RL{Under the per-user rate limit?}
  RL -- no --> E429[429 Too many requests]
  RL -- yes --> OK[Handle the request]
  OK --> G[generate: provider chain]
```

```mermaid
flowchart LR
  G[generate] --> P1[Primary provider<br/>e.g. Gemini]
  P1 -- ok --> OUT([Answer])
  P1 -- "busy, quota, error, 45 s timeout" --> P2[Next with a key<br/>e.g. Groq]
  P2 -- ok --> OUT
  P2 -- fails --> P3[Next ...]
  P3 -- all failed --> ERR([One error listing each provider's reason])
```

Photos switch Groq to its vision model automatically.

---

## 10. Setting goals

```mermaid
flowchart TD
  P[Profile: sex, age, height, current weight,<br/>activity level, pace, target weight] --> BMR[BMR: Mifflin-St Jeor]
  BMR --> TDEE[× activity factor = TDEE]
  TDEE --> DIR{Target vs current}
  DIR -- "within 0.3 kg" --> MAIN[Maintain: TDEE]
  DIR -- lower --> CUT[Deficit = pace × 7700 / 7 per day<br/>floor 1500 kcal men, 1200 women]
  DIR -- higher --> BULK[Surplus, pace capped at 0.5 kg/week]
  MAIN --> MAC
  CUT --> MAC
  BULK --> MAC[Protein 2.0 / 1.8 / 1.6 g per kg by direction,<br/>fat 25% of calories, carbs fill the rest]
  MAC --> OUT[Daily targets + weeks to reach the target weight]
```

The result fills the daily targets; any number can still be edited by hand.

---

## 11. Running, building and shipping

### 11.1 Day-to-day development

```mermaid
flowchart LR
  subgraph PC[Your computer]
    A[npm run dev] --> V[Vite web app :5173]
    A --> S[API server :8787]
    M[npm run mobile] --> X[Expo Metro :8081]
  end
  V <--> S
  Phone[Phone with Expo Go<br/>same Wi-Fi] -->|scan QR| X
  Phone -->|fetch AI results| S
```

`npm run mobile` is the Expo Go flow; `npm run mobile:dev` is for a development build; `npm run mobile:clear` clears the cache; `npm run mobile:lite` limits Metro's memory (it is the heaviest process, around 500 MB).

### 11.2 Turning on Google sign-in and sync

```mermaid
flowchart TD
  A[Create Firebase project] --> B[Enable Google sign-in]
  B --> C[Create Firestore + publish rules]
  C --> D[Web config into .env] --> E[Restart server and web: sign-in appears]
  C --> F[Phone: fill mobile/.env and eas.json env]
  F --> G[eas build --profile development --platform android]
  G --> H[Install APK]
  H --> I[eas credentials: copy SHA-1]
  I --> J[Add Android app in Firebase with package + SHA-1]
  J --> K[npm run mobile:dev, open the app,<br/>Continue with Google]
```

Full instructions: [SETUP-FIREBASE.md](SETUP-FIREBASE.md).

### 11.3 Verifying a change

```mermaid
flowchart LR
  C[Code change] --> T[npm test: 192 tests]
  C --> W[tsc + vite build]
  C --> M[mobile: tsc, expo export, expo-doctor]
  C --> B[npx vite-node eval/recommend-eval.ts]
  T --> OK([Ship])
  W --> OK
  M --> OK
  B --> OK
```

The same checks (types, tests, build) run in GitHub Actions on every push.

---

## 12. What the user sees when something goes wrong

| Situation | What happens |
| --- | --- |
| Model is busy or over quota | The next provider in the chain answers; if all fail, one clear error lists each reason. |
| A model call stalls | After 45 s it is treated as a failure (no endless spinner). |
| Model returns malformed JSON | One automatic repair attempt, then a plain error. |
| USDA lookup fails or finds nothing good | The model's estimate is used and labelled "est.". |
| Server not reachable from the phone | "Can't reach your Journable server…" with what to check; Goals → Server has a test button. |
| Not signed in / expired / not allowed / rate-limited | 401 / 401 / 403 / 429 with a plain message. |
| Firestore rules not published | Sync status shows "Missing or insufficient permissions" and points to the setup guide. |
| Different Google account on a used device | A confirmation before the device's data is replaced. |
| Google sign-in in Expo Go | A clear message that it needs the development build; nothing crashes. |
| Catalog cannot fill a meal for an unusual diet and cuisine | The AI fills just that meal, or a note says it could not. |
| Camera permission denied | A message saying how to allow it. |
| Quota exhausted during a benchmark | The run stops early and refuses to save misleading results. |
