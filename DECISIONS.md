# Decision log

Every significant design decision in Journable, in the order it was made, with the reasoning and the alternatives that were rejected. Each entry follows the same shape: **Context** (the problem), **Decision**, **Alternatives considered**, **Consequences** (what it costs us and what it buys us).

This is a living document. Entries are never deleted; if a decision is reversed, the old entry stays and is marked **Superseded** with a pointer to its replacement. That includes the mistakes: several entries below record a bug that a test or a live run exposed, because the reason a rule exists is often the most useful part.

Related documents: [Architecture.md](Architecture.md) (how it is built), [FLOW.md](FLOW.md) (how data and users move through it), [SETUP-FIREBASE.md](SETUP-FIREBASE.md) (turning on sign-in and sync).

**Status key:** Accepted · Superseded · Open (decided for now, revisit later)

## Contents

| # | Decision | Status |
| --- | --- | --- |
| [D-01](#d-01-a-personal-tracker-with-its-own-identity-not-a-clone) | A personal tracker with its own identity | Accepted |
| [D-02](#d-02-web-first-react--typescript--vite) | Web first: React, TypeScript, Vite | Accepted |
| [D-03](#d-03-local-first-storage-indexeddb-and-sqlite) | Local-first storage (IndexedDB, SQLite) | Accepted |
| [D-04](#d-04-model-keys-live-on-a-small-api-server-never-in-the-client) | Model keys live on a small API server | Accepted |
| [D-05](#d-05-gemini-by-default-behind-a-provider-adapter-with-fallbacks) | Gemini by default, behind an adapter with fallbacks | Accepted |
| [D-06](#d-06-structured-output-validated-with-zod-with-one-repair-pass) | Structured output validated with Zod, one repair pass | Accepted |
| [D-07](#d-07-ground-estimates-in-usda-data-only-when-name-macros-and-energy-agree) | Ground estimates in USDA data, only when three checks agree | Accepted |
| [D-08](#d-08-an-evaluation-harness-that-refuses-to-lie) | An evaluation harness that refuses to lie | Accepted |
| [D-09](#d-09-corrections-teach-the-model-through-hints) | Corrections teach the model through hints | Accepted |
| [D-10](#d-10-the-coach-is-a-tool-calling-agent-and-the-tools-run-on-the-device) | The coach is a tool-calling agent; tools run on the device | Accepted |
| [D-11](#d-11-langgraph-for-the-coach-langchain-as-an-opt-in-layer) | LangGraph for the coach, LangChain as an opt-in layer | Accepted |
| [D-12](#d-12-a-shared-folder-for-everything-pure) | A `shared/` folder for everything pure | Accepted |
| [D-13](#d-13-expo-react-native-for-the-phone-sdk-57) | Expo (React Native) for the phone, SDK 57 | Accepted |
| [D-14](#d-14-firebase-auth-with-google-and-server-side-token-verification-without-the-admin-sdk) | Firebase Auth with Google; verify tokens without the Admin SDK | Accepted |
| [D-15](#d-15-a-custom-local-first-sync-engine-over-firestore) | A custom local-first sync engine over Firestore | Accepted |
| [D-16](#d-16-download-before-upload) | Download before upload | Accepted |
| [D-17](#d-17-native-google-sign-in-needs-a-development-build) | Native Google sign-in needs a development build | Accepted |
| [D-18](#d-18-the-meal-comes-from-the-clock) | The meal comes from the clock | Accepted |
| [D-19](#d-19-a-diet-model-with-per-weekday-rules) | A diet model with per-weekday rules | Accepted |
| [D-20](#d-20-allergies-are-handled-conservatively) | Allergies are handled conservatively | Accepted |
| [D-21](#d-21-not-everything-belongs-to-the-llm-a-recommendation-engine-for-planning) | A recommendation engine for planning, not the LLM | Accepted |
| [D-22](#d-22-a-curated-catalog-with-derived-diets-and-derived-calories) | A curated catalog with derived diets and calories | Accepted |
| [D-23](#d-23-portions-by-bounded-least-squares-no-external-solver) | Portions by bounded least squares, no external solver | Accepted |
| [D-24](#d-24-learn-taste-with-thompson-sampling) | Learn taste with Thompson sampling | Accepted |
| [D-25](#d-25-variety-and-coherence-as-explicit-rules) | Variety and coherence as explicit rules | Accepted |
| [D-26](#d-26-design-language-dm-sans-neutral-graphite-and-a-violetblue-accent) | Design language: DM Sans, graphite, violet to blue | Accepted |
| [D-27](#d-27-testing-strategy) | Testing strategy | Accepted |
| [D-28](#d-28-honesty-about-privacy-and-about-numbers) | Honesty about privacy and about numbers | Accepted |
| [D-29](#d-29-what-we-chose-not-to-build-yet) | What we chose not to build yet | Open |
| [D-30](#d-30-the-path-from-personal-use-to-a-public-app) | The path from personal use to a public app | Open |

---

## D-01. A personal tracker with its own identity, not a clone

**Context.** The starting point was an existing Android calorie-counting app, and the wish to have "the same thing" for personal use.

**Decision.** Build the *capability* (log meals by chat or photo, get calories and macros) under our own name, design and code. Do not copy the original's branding, screenshots or assets, and give the Android app a different package id (`com.mihir.journablelocal`) so it can never collide with, or be mistaken for, the Play Store app.

**Alternatives considered.** A pixel-for-pixel clone (rejected: not ours to copy, and no learning value); a generic "calorie counter" with no differentiator (rejected: the interesting work is elsewhere).

**Consequences.** Freedom to add things the original does not have: a recommendation engine, diet rules, sync you control, a coach that reads your own data.

---

## D-02. Web first: React + TypeScript + Vite

**Context.** The user had no Android Studio installed and wanted to start immediately, with Android and maybe web as targets.

**Decision.** Build the web app first (React 18, TypeScript, Vite), then add a phone app later reusing the logic.

**Alternatives considered.** Native Android in Kotlin (needs the Android SDK; cannot be built or run on this machine yet); Flutter (a second language and toolchain, weaker web); a wrapper such as Capacitor around the web app (fast, but feels like a website).

**Consequences.** Something usable on day one, hot reload, and TypeScript types that later became the shared core. The cost is that a polished mobile experience needed a second front end (D-13).

---

## D-03. Local-first storage: IndexedDB and SQLite

**Context.** A food log is personal data that should work offline and be instant.

**Decision.** Each app stores everything on the device first: IndexedDB (via Dexie) on the web, SQLite (`expo-sqlite`) on the phone. Screens read local data only. Cloud sync (D-15) is optional and layered on top.

**Alternatives considered.** A server database as the source of truth (needs hosting, auth and connectivity for every action); Firestore with its own offline cache (on React Native the JS SDK keeps the cache in memory only, so offline writes can be lost when the app is killed).

**Consequences.** Instant UI, offline by default, privacy by default. The price is that cross-device consistency has to be built (D-15, D-16), and web and phone data are separate until the user signs in.

---

## D-04. Model keys live on a small API server, never in the client

**Context.** Calling an AI provider needs an API key. Anything shipped to a browser or a phone can be extracted.

**Decision.** A small Node/Express API holds the keys in `.env` and exposes only the endpoints the app needs (`/api/analyze`, `/api/plan`, `/api/coach*`). The clients never see a provider key.

**Alternatives considered.** Calling providers directly from the client with a user-supplied key (poor UX, key exposure); serverless functions (fine later; a plain server was simplest to run locally).

**Consequences.** One place to add auth, rate limits, validation and provider fallback. A server must be running (and reachable from the phone) for AI features; the recommendation engine (D-21) deliberately does not need it.

---

## D-05. Gemini by default, behind a provider adapter with fallbacks

**Context.** Free-tier Gemini was the cheapest way to start. Two problems appeared quickly: the newest model name (`gemini-3.8-flash`) was listed for the key but **hung without answering**, and the free tier allows only about **20 requests per day per model**, which also exhausted a benchmark run.

**Decision.** Put every provider (Gemini, Anthropic, Groq) behind one `generate()` contract. An ordered chain (`AI_PROVIDER` then `AI_FALLBACKS`) is tried in turn; providers without a key are skipped; every call has a 45 s timeout so a stalled model becomes an error, not endless loading. The default model is the newest one that actually answers (`gemini-3.5-flash`).

**Alternatives considered.** Hard-code one provider (a quota error then takes the app down); retry the same provider (does not help with a daily cap).

**Consequences.** The app keeps working when a model is busy or out of quota. Fallback models can be less accurate, which is why benchmarks disable fallback (D-08). The Groq path has been tested with mocks only; no key was available to try it live.

---

## D-06. Structured output validated with Zod, with one repair pass

**Context.** Models return JSON that is *almost* right: wrapped in code fences, with renamed fields, or with missing values.

**Decision.** Parse leniently (strip fences, slice the outermost object), then validate with Zod. If validation fails, make exactly one repair call that quotes the error. Clamp numbers to sane ranges.

**A mistake worth recording.** The first version of the meal planner defaulted missing macro fields to `0`. In a live run the plan hit its calorie target perfectly but showed 0 g protein, carbs and fat for every item, because the model had used different field names and the schema silently filled in zeros. The fix: macros are **required**, common aliases (`protein`, `carbs`, `fat`, `kcal`) are accepted, and a plan whose macros do not roughly match its calories (4P + 4C + 9F within 30%) triggers a repair. The lesson generalises: **never default a missing nutrient to zero**.

**Alternatives considered.** Provider-native JSON modes (not uniform across providers); free-form parsing with regexes (brittle).

**Consequences.** One extra model call in the failure case; far fewer silent errors.

---

## D-07. Ground estimates in USDA data, only when name, macros and energy agree

**Context.** A language model's calorie numbers are plausible, not authoritative. USDA FoodData Central offers reference values for generic foods.

**Decision.** The model returns, for each item, a gram weight and a generic search term. The server looks that term up in USDA (Foundation and SR Legacy data) and replaces the model's numbers **only** if a candidate passes three checks: (1) at least 60% of the search words appear in the candidate's description, (2) protein, carbs and fat per 100 g are each within `max(4 g, 50%)` of what the model implied, and (3) energy per 100 g is within 30%. Otherwise the model's estimate stays and is labelled "est.".

**A mistake worth recording.** The first version matched on energy density alone. Live, it matched **beer to "cola, regular"** (similar kcal per 100 g, but 37 g carbs instead of about 13) and **tacos to a Taco Bell menu item**, making the numbers *worse*. Checks (1) and (2) were added and the same input then produced the correct beer entry (13 g carbs), a USDA match for rice, and an honest "estimate" for tacos.

**Alternatives considered.** Embedding-based retrieval over a local food database (heavier, and USDA already provides search); trusting the model alone (no provenance).

**Consequences.** Every logged item shows where its numbers came from (`USDA`, `est.`, `edited`). The public `DEMO_KEY` is limited to about 30 requests an hour, so a free USDA key is recommended; grounding falls back silently when a lookup fails.

---

## D-08. An evaluation harness that refuses to lie

**Context.** Claims about accuracy are cheap. The first full benchmark run hit the free-tier quota: 37 of 40 calls failed, yet the summary still printed a flattering "100% within range" over the three that succeeded.

**Decision.** `npm run eval` scores the logging pipeline on 40 multi-cuisine meals with acceptable calorie *ranges* (typical published values, not clinical truth). The runner (a) stops early on quota or key errors, (b) **does not save results** if more than 10% of calls failed, and (c) disables provider fallback by default so a run always measures a single model. The recommendation engine has its own benchmark (`eval/recommend-eval.ts`, D-21).

**Alternatives considered.** Reporting whatever came back (misleading); point values as ground truth (false precision).

**Consequences.** No results are published for the logging pipeline yet, because quota has not allowed a clean run. The README table is deliberately blank rather than invented.

---

## D-09. Corrections teach the model through hints

**Context.** Estimates are sometimes wrong for a given person ("my usual poha is smaller").

**Decision.** When a user edits a food's numbers, store the correction. On later logs, find corrections whose words overlap the new text and send up to five as hints in the prompt ("prefer these values when the same food appears"). Changing a portion with the −/+ stepper is *not* a correction, because it is a deterministic rescale, not new information.

**Alternatives considered.** Fine-tuning (disproportionate); a personal lookup table that overrides the model entirely (loses the model's flexibility for variants).

**Consequences.** Personalisation with no training and no extra calls. Corrections sync between devices with the rest of the data.

---

## D-10. The coach is a tool-calling agent, and the tools run on the device

**Context.** "How did my week go?" needs real data. The data lives in the browser or phone, not on the server.

**Decision.** The model never sees the whole database. It is given a small set of read-only tools (`get_day_log`, `get_range_summary`, `get_weights`, `get_goals`, `top_foods`). When it asks for one, the **client** runs it locally and returns the result; the UI shows which tools were used.

**Alternatives considered.** Uploading the whole log to the server each turn (privacy and size); embedding the data in the prompt (does not scale, encourages made-up numbers).

**Consequences.** Answers cite real numbers; only the data the model actually asks for leaves the device. It also made the data layer the single source of truth for both apps.

---

## D-11. LangGraph for the coach, LangChain as an opt-in layer

**Context.** The first coach used a hand-rolled JSON protocol ("reply with a tool call or an answer"). It worked, but a graph with native tool calling is the standard structure for agents and is easier to extend.

**Decision.** Re-implement the coach as a **LangGraph** `StateGraph` (`agent → tools → agent`) using the model's native tool calling. Because tools run on the client, the `tools` node calls `interrupt()`; the browser runs the tools and resumes the graph with `Command({ resume })`. A checkpointer keeps per-thread memory. LangChain chat models and `withFallbacks()` are available as an **opt-in** provider layer (`LLM_LAYER=langchain`). The hand-written adapters stay the default and stay tested; the old JSON-protocol coach stays as `COACH_ENGINE=classic`.

**Alternatives considered.** Replace the native adapters outright (risk to a working system for no functional gain); skip LangChain (it is a widely recognised building block, so being able to demonstrate it has value).

**Consequences.** Both layers satisfy the same contract and are exercised by tests. A real bug surfaced while wiring it: repeating one Zod validator in two fields made Gemini reject the tool schema (`$ref` not supported). Each field now gets its own instance. Conversation memory lives in the server's memory, so it resets on restart.

---

## D-12. A `shared/` folder for everything pure

**Context.** The web app, the phone app and the API server all need the same logic: types, goal calculator, dates, diet rules, the sync engine, the recommendation engine.

**Decision.** Put every piece of platform-independent logic in `shared/` as plain TypeScript with no DOM, React Native or Node APIs. The web app re-exports from it; the phone app imports it through a path alias with Metro configured to watch the folder; the server imports the few files it needs directly (Node 22 runs TypeScript with type stripping, so no build step).

**Alternatives considered.** An npm-workspaces monorepo (more tooling than a single-developer project needs); copying files (they drift).

**Consequences.** One implementation of each rule, tested once. Constraint: shared files must use erasable TypeScript only and avoid dependencies, because three different bundlers and runtimes load them.

---

## D-13. Expo (React Native) for the phone, SDK 57

**Context.** The user has an Android phone, no Android Studio and no Mac, and wants an app that feels native.

**Decision.** Expo with Expo Router, Reanimated, Gesture Handler, SQLite and Haptics. It runs on a real phone through Expo Go with no Android Studio, and cloud builds (EAS) can produce an installable APK later. The project is on **SDK 57**, not the newest 58: SDK 58 had been released days earlier, but the Play Store's Expo Go only supports 57 ("Project is incompatible with this version of Expo Go"). Plain `expo start` would also have defaulted to development-build mode once `expo-dev-client` was installed, so the scripts are explicit: `npm run mobile` (Expo Go) and `npm run mobile:dev` (development build).

**Alternatives considered.** Native Kotlin or Swift (cannot be built here; iOS needs a Mac); Flutter; Capacitor.

**Consequences.** One codebase for Android and, later, iOS; most logic is shared with the web (D-12). Upgrading to SDK 58 is one command once its Expo Go reaches the store. The phone app has been type-checked, bundled and passed `expo-doctor`, but **not yet run on a device by the author**.

---

## D-14. Firebase Auth with Google, and server-side token verification without the Admin SDK

**Context.** The user wanted Google login, and the AI endpoints must not be usable by strangers (they spend the owner's model quota).

**Decision.** Firebase Authentication with the Google provider on both clients. The API verifies the Firebase ID token itself with `jose` against Google's published signing keys, checking algorithm (RS256), issuer and audience, so no service account or Admin SDK is needed. `ALLOWED_EMAILS` can restrict the server to named accounts (the email must be verified), and a per-user sliding-window rate limit (default 60 requests a minute) caps abuse. When `FIREBASE_PROJECT_ID` is not set, the server stays open exactly as before, so local development is unchanged.

**Alternatives considered.** Supabase Auth (comparable; Firebase was chosen for its Google-first flow and Firestore); building OAuth by hand (error-prone); the Admin SDK (needs a secret key to be managed).

**Consequences.** A small, testable verifier (12 tests: valid, expired, wrong project, wrong key, tampered, disallowed email, rate limit). Verified end to end against fakes only; the real Google flow is untested until a Firebase project exists.

---

## D-15. A custom local-first sync engine over Firestore

**Context.** Web and phone should show the same log. See D-03 for why the device database stays the source of truth.

**Decision.** A small engine in `shared/sync.ts` that each app plugs into through two adapters (local database, Firestore). Rules: every record has a stable id (`cid`) and a client `updatedAt`; **last write wins** by `updatedAt`; deletions are records too ("tombstones") so they travel; local edits set a `dirty` flag and applying remote changes never does, so records cannot ping-pong between devices; the pull cursor is an opaque server timestamp so a device with a wrong clock cannot make others miss changes; weights use the id `w-YYYY-MM-DD` so a day can only ever have one. Settings (goals, profile, diet, learned taste) sync as small documents.

**Alternatives considered.** CRDTs (correct but heavy for single-user, rarely-conflicting data); relying on Firestore's own offline cache (see D-03); Supabase or a custom server (more to host).

**Consequences.** The engine is pure and is tested against in-memory fakes (16 tests), and the web local store is tested for real against an in-memory IndexedDB (18 tests). The phone's SQLite adapter mirrors it but has no automated tests (SQLite is not available in the test environment); it is type-checked and bundled only. Known trade-offs: ordering depends on device clocks, and there is a millisecond-scale race if two devices write the same record between one device's download and upload.

---

## D-16. Download before upload

**Context.** The first version of the engine uploaded local changes first, then downloaded.

**The bug.** A device holding an *older* unsynced edit would upload it over a *newer* edit another device had already saved, silently losing the newer one. A test for exactly this scenario failed.

**Decision.** Each sync downloads first and applies anything newer (clearing the dirty flag on the loser) and only then uploads what is still dirty.

**Consequences.** The "stale edit overwrites newer" case is now impossible under normal conditions and has a regression test. The residual race (above) is accepted for a personal app; a Firestore transaction per record would remove it at a cost.

---

## D-17. Native Google sign-in needs a development build

**Context.** Google's native sign-in library is a native module, and Expo Go cannot load native modules it does not bundle.

**Decision.** Use `@react-native-google-signin/google-signin`, loaded lazily so that Expo Go does not crash; build a development client with EAS (cloud, free tier, no Android Studio); register the build's SHA-1 in Firebase. Without Firebase config the phone app is local-only and keeps working in Expo Go.

**Alternatives considered.** A browser-based OAuth flow (works in Expo Go but is fiddly and less trustworthy); the Expo auth-session provider (custom-scheme redirects are discouraged by Google for Android).

**Consequences.** One-time setup cost (documented step by step). Filling in the phone's Firebase variables before installing the development build would lock an Expo Go session on a sign-in screen that cannot complete; the docs warn about this.

---

## D-18. The meal comes from the clock

**Context.** A Breakfast / Lunch / Snack / Dinner picker was an extra tap on every log.

**Decision.** Choose the meal from the user's local time when they log (04:00–11:00 breakfast, 11–15 lunch, 15–18 snack, 18–23 dinner, 23:00–04:00 snack), read at the moment of logging, shown as a quiet pill with the time. The "+ Add" slot under any meal overrides it for one entry, and entries can be dragged to another meal or edited later.

**Alternatives considered.** Always ask (friction); infer from the text ("for lunch…", fragile across languages).

**Consequences.** One tap fewer, correct for most entries. Logging into a past day still uses the current clock; the slots are the way to backfill.

---

## D-19. A diet model with per-weekday rules

**Context.** "Veg or non-veg" is too coarse. Many people are vegetarian on some days (religious or cultural reasons) or non-vegetarian only on some.

**Decision.** A preference is a **base diet** plus up to three **rules** ("on these weekdays I eat X"), each day following exactly one rule. Diets: vegan, vegetarian, eggetarian, Jain, pescatarian, non-vegetarian (Halal was explicitly left out). The weekday picker is available for every diet, so it covers both "vegetarian, but non-veg on Mon and Wed" and "non-veg, but vegetarian on Tue and Thu". Cuisines are a setting that defaults from the device's locale, falling back to its time zone, with no location permission.

**Alternatives considered.** One diet for all days (cannot express the real habit); a free-text diet (cannot be enforced).

**Consequences.** `dietOn(prefs, date)` is a pure function used by both apps, the server planner and the engine, and is tested for several weekday patterns.

---

## D-20. Allergies are handled conservatively

**Context.** A wrong suggestion for an allergy is the worst failure this feature can have.

**Decision.** Three layers. (1) The catalog carries explicit **allergen flags** and **ingredient flags** (D-22), and a food with a matching flag is never offered. (2) A keyword checker over food names (with allergen families expanded: "nuts" covers almond, cashew and so on) is a second line of defence and is applied to foods the user has logged, which have no flags. It is deliberately conservative: "peanut butter" counts as a nut, and "almond milk" counts as dairy for a dairy allergy (a false alarm, never a miss). (3) The LLM planner's output is re-checked by the same rules, given one repair attempt, and offending items are removed.

**Alternatives considered.** Trusting the model's compliance (it is a language model, not a rule engine).

**Consequences.** Property tests run every diet against many allergy sets and seeds (over 1,500 suggested items) and assert zero violations by both the flag check and the keyword check. This is a strong safeguard, not a medical guarantee, and the UI says so.

---

## D-21. Not everything belongs to the LLM: a recommendation engine for planning

**Context.** The first meal planner asked a language model for a whole day. It worked, but: each plan took about 7 seconds and cost an API call; the model could break a diet or allergy rule, so we had to police it with a repair loop and item removal; results varied unpredictably; and it needed the network and a working server. The user asked for a dedicated recommendation engine instead, grounded in the literature.

**Decision.** Planning is a **knowledge-based, optimisation-driven recommender** that runs on the device. The LLM keeps the jobs only a language model can do well: understanding free text and photos, the coach conversation, and, as a fallback, filling a meal the catalog cannot. The pipeline is: filter by hard constraints, score soft preferences, search role-based meal templates, optimise portions, refine the whole day, explain the result. Details and the literature behind each step are in [Architecture.md](Architecture.md#6-the-recommendation-engine).

**Alternatives considered.** Keep the LLM planner (slow, costly, unreliable on rules); collaborative filtering or deep recommenders (need a large interaction dataset; a single user has none); a pure linear program on ingredient data (excellent for cost-minimising menus, but we want variety, taste and coherent dishes).

**Consequences.** On 600 random scenarios (random diets, allergies, cuisines and targets): 0% of plans left a meal unfilled, mean calorie error 0.70% (95th percentile 1.83%), 100% within 5% of the calorie target, macro errors of about 2–3%, **zero** diet or allergy violations, and a mean of **18 ms** per plan. Important caveat: those errors are measured against the *catalog's own numbers*, so they show how well the optimiser hits targets, not that the catalog is correct (see D-22). The LLM planner remains as "Try AI suggestions" and as the fallback for unfilled meals.

---

## D-22. A curated catalog with derived diets and derived calories

**Context.** The engine needs food data it can trust to be internally consistent and to know what each food contains.

**Decision.** A 146-entry catalog of typical servings across Indian and global cuisines. Each entry stores protein, carbs, fat and fibre; **calories are computed** as 4P + 4C + 9F, so a food can never contradict itself. Diets are **derived from ingredient classes** (meat, fish, shellfish, egg, dairy, honey, gelatin, root vegetable, allium, mushroom), not guessed from names; when unsure an ingredient is flagged, in the safe direction (a dal tempered with ghee is marked dairy, poha is marked as possibly containing peanuts). The foods the user logs repeatedly are added as extra candidates so suggestions include real habits.

**The honest limit.** The values are representative, rounded figures good to roughly ±15% for a home-cooked portion. They are an editable starting point, not laboratory data, and the catalog is thinner for some cuisines than for Indian food. A meal the catalog cannot fill falls back to the AI helper.

**Alternatives considered.** Ingredient-level recipes computed from USDA (more accurate, much more data entry); asking the model to generate the catalog (it would then contain the same unverified numbers, only hidden).

**Consequences.** Tests assert catalog integrity (unique ids, valid fields, kcal consistency) and coverage (at least 12 foods for every diet at breakfast, lunch and dinner, and 6 for snacks). Growing the catalog safely is on the roadmap (an offline, validated expansion pipeline).

---

## D-23. Portions by bounded least squares, no external solver

**Context.** Once a set of foods is chosen, "how many servings of each" is the continuous part of the classic *diet problem*.

**Decision.** Minimise the weighted squared relative error of calories, protein, carbs and fat, plus a small pull back toward one normal serving, subject to per-food portion bounds. This is a convex quadratic program; cyclic coordinate descent with a closed-form update per coordinate solves it exactly in a handful of iterations, so no solver library is needed. The solution is then snapped to realistic steps (a half roti is odd, half a "2 rotis" serving is not) and polished by trying one step either way. A second pass re-solves all chosen portions together against the whole day.

**Alternatives considered.** A general LP/MIP solver (heavy dependency, worse on phones); greedy portioning (visibly misses targets).

**Consequences.** Tens of lines of code, microsecond-scale solves, fully deterministic, and unit-tested against a case with a known exact answer.

---

## D-24. Learn taste with Thompson sampling

**Context.** The engine should drift toward what the user likes without any training pipeline.

**Decision.** Each food has a Beta belief of "would they like this?", starting from a mild prior. Logging a suggested meal counts as a success; swapping it away counts as a failure; old evidence slowly fades. When ranking, one value is *sampled* from each belief (Thompson sampling), so liked foods win most of the time while uncertain ones still get tried. Beliefs sync across devices.

**Alternatives considered.** Pick the highest average (never explores); epsilon-greedy (wasteful exploration); a contextual bandit such as LinUCB (a good next step once we have features worth conditioning on).

**Consequences.** A test confirms liked foods appear more often, and swapped-away foods less often, than at baseline. It is a *weak* signal by design: one swap is not a verdict.

---

## D-25. Variety and coherence as explicit rules

**Context.** Optimising only for macro fit would serve the same convenient foods forever, and it once paired whole-wheat bread with rajma masala.

**Decision.** (1) No non-staple dish repeats inside one plan; rice and roti may repeat across meals. (2) Dishes eaten in the last three days are penalised, fading with the days since, strongly enough to outweigh the "familiar" bonus. (3) A meal must read like one cuisine: foods that suit every cuisine are neutral, the rest must share a cuisine; a combination that mixes cuisines is used only if nothing coherent exists.

**A mistake worth recording.** Coherence began as a soft penalty and still let bread-with-dal through; it became a hard preference with a fallback. Recency first lost to the familiarity bonus; the penalty now decays as `0.6 · e^(−days/2)`.

**Alternatives considered.** Literal Maximal Marginal Relevance re-ranking (the diversity idea is the same; penalties were simpler to reason about and test).

**Consequences.** Plans look like meals a person would eat. Without any history, a 14-day run still repeats a few dishes (51 distinct foods, milk the most often, 10 times), which is expected when no history is supplied; in the app, recent meals are passed in.

---

## D-26. Design language: DM Sans, neutral graphite and a violet-to-blue accent

**Context.** The first palette (graphite with a green-to-teal accent) was described as "meh" and then as having a bad green tint.

**Decision.** DM Sans for a soft, readable type; neutral near-black and white surfaces with no colour cast; a single violet-to-blue accent (the calorie ring, buttons, logo, charts); green kept only for genuinely positive states. Light, dark and system themes. Motion is used to explain, not decorate (the ring draws, numbers count, entries slide in) and everything respects "reduce motion". On the phone, haptics give small, consistent feedback.

**Alternatives considered.** More saturated brand colours (tiring in a daily-use app); a tinted dark theme (the original complaint).

**Consequences.** The logo, favicon and installed-app icons were regenerated to match. Both themes were checked in real browser screenshots; the phone app has not been visually checked on a device.

---

## D-27. Testing strategy

**Context.** Much of this system is hard to test live: model output is non-deterministic, Firebase and Google need accounts, the phone needs a device.

**Decision.** Test the **logic** exhaustively and the **seams** with fakes. Pure shared code is unit-tested; the web local store runs against an in-memory IndexedDB; model calls, Firestore and the network are replaced by scripted fakes; the recommendation engine is covered by property tests (every diet × many allergy sets × many seeds) and a randomised accuracy test. Live checks were run by hand where possible (USDA, Gemini, the LangGraph coach, the planner), and several real bugs were found that way (D-06, D-07, D-11, D-16). Current total: **192 tests in 13 files**, plus `tsc` on both apps, a web build, an Android bundle, and `expo-doctor`.

**Alternatives considered.** Only live tests (flaky, quota-limited); only mocks (miss real-service quirks, as the Gemini `$ref` bug showed).

**Consequences.** Logic is trustworthy and regressions are caught. What remains unverified is stated plainly in Architecture.md §10.

---

## D-28. Honesty about privacy and about numbers

**Context.** The sidebar originally said "Your data stays on this device." That stopped being true the moment text and photos were sent to a model, and again with cloud sync.

**Decision.** Say exactly what happens: the log is stored on the device; text and photos you log are sent to the chosen AI provider; with sign-in on, records sync to your private Firestore area (readable only by you under the security rules). Show provenance on every number (`USDA`, `est.`, `edited`). Label plans as estimates and not medical advice. Cite sources only if they were checked: of 20 references considered, 17 were confirmed against OpenAlex, Crossref or arXiv, and the three that were not are marked as such in Architecture.md §12.

**Consequences.** Less marketing gloss, more trust, and a documentation habit that distinguishes *verified* from *believed*.

---

## D-29. What we chose not to build yet

| Idea | Why not yet |
| --- | --- |
| MCP server exposing the log | The data lives in the browser or phone, not on the server. |
| RAG over embeddings of a food database | USDA's own search plus the agreement checks (D-07) achieves grounding with less machinery. |
| Detailed nutrients (fiber, sugar, sodium, micronutrients) | Agreed as the next phase; only USDA-matched foods can show reliable micronutrients, and the AI's guesses should not be presented as data. |
| Calendar and backup export on the phone | Lower priority than planning and sync. |
| Weekly plan and shopping list | Natural extension of the engine (see roadmap). |
| iOS build | Needs a Mac or EAS cloud build and an Apple developer account; no iPhone available. |
| Deploying the server | Needed for use away from the home network; local-only was enough to build and test. |
| Fully transactional sync writes | The remaining race is millisecond-scale for one user. |
| Contextual bandit (LinUCB) for ranking | Worth it once there are user and food features beyond per-food beliefs. |

---

## D-30. The path from personal use to a public app

**Context.** Friends and family were the first request; then "random people". Opening the app to strangers turns a personal tool into a product: AI cost scales with users, signup invites abuse, and food and weight logs are sensitive personal data with legal expectations.

**Decision.**

1. **Use it privately first, for about 2–3 months.** Nothing is hosted yet; the server runs on the owner's machine and sign-in is restricted to the owner's account (`ALLOWED_EMAILS`). The time is used to collect real behaviour: how often the engine versus the AI is used, which foods the catalog is missing, what breaks.
2. **Cost model: free, with a daily AI limit per person**, funded by the owner, with a global spending cap as a safety net. The recommendation engine already costs nothing because it runs on the device.
3. **Launch path: invite-only beta (about 20–50 people), then public web**, then the Play Store. Not a straight public launch, so a bug or a cost problem is contained.
4. **Hosting is deferred** until the private period ends. The leading option is Google Cloud Run with Firebase Hosting, because Firebase is already in use and budget alerts and one bill come with it; Render or Fly remain acceptable.

**Alternatives considered.** Bring-your-own AI key (no cost to the owner, but hard for non-technical users); a paid tier (needs payments, tax and refunds); launching publicly at once (every problem is public immediately).

**Consequences.** The work that makes a public launch safe is listed as a track in the roadmap (Architecture.md §13): a cheaper food-resolution path that avoids model calls for common foods, per-user daily AI limits and a usage counter, a global budget cap and Firebase App Check, a stateless server (rate limits, coach memory and the USDA cache moved out of process memory), account deletion and data export, a privacy policy and consent, and a pay-as-you-go Firebase plan with budget alerts. Legal and privacy obligations (health-related personal data, regional privacy laws, store requirements) need professional advice before a public launch; nothing here is legal guidance.

## D-31 Resolution ladder before the AI
Typed text is matched first against your own history, then the built-in catalog (`shared/resolve.ts`). Only unrecognised parts (and all photos) go to the AI. Strict matching: ambiguous names and unit mismatches fall through to the AI. Saves quota and works offline.

## D-32 Daily AI limit with a visible counter
`server/usage.mjs` meters AI calls per user per day (default 40, `DAILY_AI_LIMIT`, 0 = unlimited; optional global cap; `UNLIMITED_EMAILS`). 5xx failures are refunded. `/api/usage` feeds a counter in both apps.
