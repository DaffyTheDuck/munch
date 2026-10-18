# Journable

A personal AI calorie and macro tracker. Log meals or exercise in plain language, in any language or cuisine, or with a photo, and the app turns it into calories and macros you can trust and correct.

Web app (React + TypeScript) with a small Node API. All your data stays in your browser (IndexedDB).

## What makes it more than a prompt wrapper

| Feature | How it works |
| --- | --- |
| **Cuisine and language agnostic** | The model is prompted to interpret slang, transliterated text (Hinglish, Spanglish…), regional dishes, brands and photos. |
| **Grounded in reference data** | The model also returns a generic search term and a gram weight. The API retrieves candidates from USDA FoodData Central and only replaces the estimate when the candidate agrees on **name, macros and energy density**. Otherwise the AI estimate is kept and labelled `est.`. Every entry shows its provenance (`USDA`, `est.`, `edited`). |
| **Validated structured output** | Responses are parsed and validated with Zod (coercion, clamping). Invalid output triggers one automatic repair round-trip. |
| **Learns from corrections** | When you edit a food's numbers, it is stored and sent back as a hint the next time a similar food is logged. |
| **Agentic coach (LangGraph)** | A LangGraph `StateGraph` (`agent → tools → agent`) with native tool calling. Your data lives in the browser, so the `tools` node calls `interrupt()`; the browser runs the tools locally and resumes the graph with `Command({ resume })`. A checkpointer keeps per-thread memory, parallel tool calls are supported, and the UI shows which tools were used. A simpler hand-rolled JSON tool loop remains as the `classic` engine. |
| **LangChain model layer** | Optional (`LLM_LAYER=langchain`): Gemini / Groq / Anthropic through LangChain chat models, chained with `Runnable.withFallbacks()`, with tracking of which provider answered. The native adapters stay as the default and are unit-tested against the same contract. |
| **Goal planner** | Mifflin-St Jeor TDEE, pace-based deficit/surplus, safety floors, macro split and an ETA to your target weight. |
| **Food preferences** | Vegan, vegetarian, eggetarian, Jain, pescatarian or non-vegetarian, with per-weekday rules (for example non-veg only on Mon and Wed), allergies, dislikes, and cuisines that default from your location. |
| **Recommendation engine** | Meal plans are built on the device by a knowledge-based optimiser, not by the LLM: hard diet and allergy filtering from ingredient flags, portion optimisation (bounded least squares), cuisine coherence, variety, and taste learned with Thompson sampling. On 600 random scenarios: 0 rule violations, 0.70% mean calorie error, about 18 ms per plan. The LLM planner remains as "Try AI suggestions" and as a fallback for meals the catalog cannot fill. Details and references: [Architecture.md](Architecture.md#6-the-recommendation-engine). |
| **Provider-agnostic with failover** | Gemini, Anthropic or Groq behind one adapter (`server/llm.mjs`). If the main provider is overloaded, over quota or times out, the request automatically moves down the `AI_FALLBACKS` chain. Providers without a key are skipped. |
| **Evaluation harness** | `npm run eval` scores the full pipeline on a 40-meal multi-cuisine benchmark. See below. |

## Architecture

```
React UI ──/api/analyze──▶ server/analyze.mjs ──▶ server/llm.mjs ──▶ Gemini | Anthropic
 (IndexedDB)                 │  Zod validate + repair
                             └─▶ server/grounding.mjs ──▶ USDA FoodData Central
          ──/api/coach/chat──▶ server/coach.graph.mjs (LangGraph)
          ◀── {status:"tool", calls} ── graph paused at interrupt()
          browser runs tools on IndexedDB
          ──/api/coach/resume (results)──▶ graph continues ──▶ {status:"answer"}
```

`COACH_ENGINE=classic` uses `/api/coach` and `server/coach.mjs` instead (JSON tool protocol, same client-side tools).

The API holds the model key; the browser never sees it.

## Run it

```bash
npm install
cp .env.example .env     # add GEMINI_API_KEY (and optionally USDA_API_KEY)
npm run dev              # http://localhost:5173
npm test                 # unit tests (Vitest)
npm run eval             # benchmark (uses API quota, ~40 calls)
```

A free USDA key (https://fdc.nal.usda.gov/api-key-signup.html) removes the `DEMO_KEY` rate limit (~30 requests/hour).

## Documentation

- [Architecture.md](Architecture.md): components, data model, the recommendation engine in detail (with references), sync, security, tests and benchmarks, roadmap.
- [DECISIONS.md](DECISIONS.md): every significant decision, the alternatives rejected, and the mistakes that shaped the design.
- [FLOW.md](FLOW.md): user flows and data flows with diagrams.
- [SETUP-FIREBASE.md](SETUP-FIREBASE.md): turning on Google sign-in and sync.

## Accounts and sync

Optional Google sign-in (Firebase Auth) with local-first sync between the web and phone apps through Firestore. The sync engine in `shared/sync.ts` is platform-independent and tested against in-memory fakes; the server verifies Firebase ID tokens (no Admin SDK) and can restrict access to your own Google account. Nothing changes until you add Firebase config. See [SETUP-FIREBASE.md](SETUP-FIREBASE.md).

## Mobile app (Android first)

`mobile/` is an Expo (React Native) app that reuses the logic in `shared/` and the same API server. See [mobile/README.md](mobile/README.md) to run it on your phone with Expo Go.

## Evaluation

`eval/dataset.json` has 40 meals across ~20 cuisines and several languages, each with an acceptable calorie **range** drawn from typical published values. Ranges are approximations, so use the benchmark to compare configurations (model A vs B, grounded vs ungrounded), not as clinical ground truth.

```bash
npm run eval                                   # grounded
npm run eval -- --no-grounding --label ungrounded
npm run eval -- --provider anthropic --label anthropic
```

Reported: within-range %, MAPE to range midpoint, median miss, p50/p95 latency, repair rate and grounded share. Results are written to `eval/results/<label>.json`. A run with more than 10% failed calls is not saved, so quota errors can't produce misleading numbers.

**Results:** _not recorded yet. Run `npm run eval` and paste the table here._

| Config | Within range | MAPE | p50 / p95 latency | Grounded |
| --- | --- | --- | --- | --- |
| ungrounded | | | | |
| grounded | | | | |

## Free-tier note

Gemini's free tier caps requests per model per day (about 20 at the time of writing), and quotas are tracked per model. Configure a fallback (`AI_FALLBACKS=groq`) so the app keeps working when the primary is out of quota or overloaded. Benchmark runs disable fallback by default so results always measure a single model.

## Known limits

- Photo portion sizes are estimates. Tap any entry to correct it.
- USDA coverage is strongest for generic foods; regional dishes and restaurant meals fall back to the AI estimate.
- Data lives in one browser. Use Goals → Export/Import to move it.
- Not medical advice.
