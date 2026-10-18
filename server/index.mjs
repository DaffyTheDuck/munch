import { createApp, allowedEmails, authEnabled } from './app.mjs'
import { providerInfo } from './llm.mjs'

// A hosted server must never run without sign-in: that would let anyone spend your AI budget.
if (process.env.NODE_ENV === 'production' && !authEnabled() && process.env.ALLOW_OPEN !== '1') {
  console.error('Refusing to start: set FIREBASE_PROJECT_ID so the API requires Google sign-in (or ALLOW_OPEN=1 to override).')
  process.exit(1)
}

const port = Number(process.env.PORT) || 8787
createApp().listen(port, () => {
  const { provider, model, chain } = providerInfo()
  console.log(`Journable API on http://localhost:${port}`)
  console.log(
    authEnabled()
      ? `Auth: Google sign-in required (Firebase project ${process.env.FIREBASE_PROJECT_ID})${allowedEmails().length ? `, restricted to ${allowedEmails().length} account(s)` : ', any Google account allowed (set ALLOWED_EMAILS to restrict)'}`
      : 'Auth: OFF (set FIREBASE_PROJECT_ID to require Google sign-in)',
  )
  console.log(`AI: ${provider}/${model}${chain.length > 1 ? `, fallbacks: ${chain.slice(1).join(' → ')}` : ', no fallback configured'}`)
})
