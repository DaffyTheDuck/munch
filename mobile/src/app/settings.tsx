import { useCallback, useEffect, useState } from 'react'
import { TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import Constants from 'expo-constants'
import { Ionicons } from '@expo/vector-icons'
import { font, radius, useTheme } from '@/theme'
import { deleteSetting, setSetting } from '@/lib/db'
import { checkOwnKey, fetchUsage, health, serverUrl, type Health } from '@/lib/api'
import { useUsage } from '@/lib/usage'
import { PROVIDER_INFO, clearOwnKey, getOwnKey, maskKey, saveOwnKey, type OwnKey, type Provider } from '@/lib/aikey'
import { loadTheme, saveTheme, type ThemePref } from '@/lib/themePref'
import { feel } from '@/lib/feel'
import { Card, Chip, IconButton, PrimaryButton, SecondaryButton, T } from '@/components/ui'
import { AccountCard } from '@/components/Account'
import { KeyboardScroll } from '@/components/KeyboardScroll'
import { useSession } from '@/lib/session'
import { useToast } from '@/components/Toast'

function Section({ icon, title, children }: { icon: keyof typeof Ionicons.glyphMap; title: string; children: React.ReactNode }) {
  const t = useTheme()
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4 }}>
        <Ionicons name={icon} size={15} color={t.muted} />
        <T variant="label" muted>
          {title}
        </T>
      </View>
      {children}
    </View>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 6 }}>
      <T variant="caption" muted style={{ fontFamily: font.semibold }}>
        {label}
      </T>
      {children}
    </View>
  )
}

const inputStyle = (t: ReturnType<typeof useTheme>) => ({
  fontFamily: font.medium,
  fontSize: 15,
  color: t.text,
  minHeight: 48,
  paddingHorizontal: 14,
  borderRadius: radius.md,
  backgroundColor: t.card2,
})

function resetLabel(iso?: string) {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

export default function SettingsScreen() {
  const t = useTheme()
  const insets = useSafeAreaInsets()
  const toast = useToast()
  const { configured } = useSession()

  const [theme, setTheme] = useState<ThemePref>('system')

  const usage = useUsage()
  const [own, setOwn] = useState<OwnKey | null>(null)
  const [provider, setProvider] = useState<Provider>('gemini')
  const [keyText, setKeyText] = useState('')
  const [keyBusy, setKeyBusy] = useState(false)
  const [keyMsg, setKeyMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const [url, setUrl] = useState('')
  const [urlNow, setUrlNow] = useState('')
  const [status, setStatus] = useState<Health | null>(null)
  const [checking, setChecking] = useState(false)

  const refreshUsage = useCallback(() => void fetchUsage(), [])

  useEffect(() => {
    void loadTheme().then(setTheme)
    void getOwnKey().then((k) => {
      setOwn(k)
      if (k) setProvider(k.provider)
    })
    void serverUrl().then((u) => {
      setUrl(u)
      setUrlNow(u)
    })
    refreshUsage()
  }, [refreshUsage])

  async function pickTheme(p: ThemePref) {
    feel.select()
    setTheme(p)
    await saveTheme(p)
  }

  async function saveKey() {
    const k = keyText.trim()
    if (k.length < 20) {
      setKeyMsg({ ok: false, text: 'That key looks too short. Paste the whole key.' })
      return
    }
    setKeyBusy(true)
    setKeyMsg(null)
    try {
      await saveOwnKey({ provider, key: k })
      setOwn({ provider, key: k })
      setKeyText('')
      const r = await checkOwnKey()
      setKeyMsg({ ok: true, text: `Key works (${PROVIDER_INFO[r.provider as Provider]?.label ?? r.provider}). AI now uses your key.` })
      feel.success()
    } catch (e) {
      setKeyMsg({ ok: false, text: (e as Error).message })
      feel.error()
    } finally {
      setKeyBusy(false)
      refreshUsage()
    }
  }

  async function removeKey() {
    await clearOwnKey()
    setOwn(null)
    setKeyMsg(null)
    feel.select()
    toast('Your API key was removed from this device')
    refreshUsage()
  }

  async function checkServer(next?: string) {
    setChecking(true)
    const target = (next ?? url).trim()
    if (target) await setSetting('serverUrl', target.replace(/\/+$/, ''))
    else await deleteSetting('serverUrl')
    setUrlNow(await serverUrl())
    const h = await health()
    setStatus(h)
    setChecking(false)
    h.ok ? feel.success() : feel.error()
    refreshUsage()
  }

  const left = usage.remaining ?? 0
  const meter = usage.enabled && !usage.unlimited && usage.limit ? Math.min(1, (usage.used ?? 0) / usage.limit) : 0

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <View style={{ paddingTop: insets.top + 8, paddingHorizontal: 12, paddingBottom: 4, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <IconButton name="chevron-back" label="Back" haptic="select" onPress={() => router.back()} />
        <T variant="largeTitle">Settings</T>
      </View>

      <KeyboardScroll showsVerticalScrollIndicator={false} keyboardDismissMode="interactive" contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 48 + insets.bottom, gap: 20 }}>
        <Section icon="person-circle-outline" title="ACCOUNT">
          {configured ? (
            <AccountCard />
          ) : (
            <Card>
              <T variant="body" muted>
                Google sign-in is not set up in this build, so your data stays on this phone only.
              </T>
            </Card>
          )}
        </Section>

        <Section icon="color-palette-outline" title="APPEARANCE">
          <Card style={{ gap: 12 }}>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {(
                [
                  ['system', 'System', 'phone-portrait-outline'],
                  ['light', 'Light', 'sunny-outline'],
                  ['dark', 'Dark', 'moon-outline'],
                ] as const
              ).map(([id, label, icon]) => (
                <Chip key={id} label={label} icon={icon} selected={theme === id} onPress={() => void pickTheme(id)} />
              ))}
            </View>
            <T variant="caption" muted>
              System follows your phone's light or dark setting.
            </T>
          </Card>
        </Section>

        <Section icon="sparkles-outline" title="AI">
          <Card style={{ gap: 14 }}>
            {own ? (
              <View style={{ gap: 4 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Ionicons name="key" size={16} color={t.good} />
                  <T variant="headline">Using your own {PROVIDER_INFO[own.provider].label} key</T>
                </View>
                <T variant="caption" muted>
                  {maskKey(own.key)} · AI requests use your key and do not count against the shared daily allowance.
                </T>
              </View>
            ) : usage.enabled && !usage.unlimited && usage.limit ? (
              <View style={{ gap: 8 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <T variant="headline">Daily AI allowance</T>
                  <T variant="callout" style={{ fontVariant: ['tabular-nums'] }} color={left <= 5 ? 'over' : 'muted'}>
                    {usage.used}/{usage.limit}
                  </T>
                </View>
                <View style={{ height: 7, borderRadius: 4, backgroundColor: t.card2, overflow: 'hidden' }}>
                  <View style={{ width: `${meter * 100}%`, height: 7, borderRadius: 4, backgroundColor: left <= 5 ? t.over : t.accent }} />
                </View>
                <T variant="caption" muted>
                  Resets at {resetLabel(usage.resetAt)}. Foods you have logged before and meal plans from the on-device engine cost nothing.
                </T>
              </View>
            ) : (
              <T variant="body" muted>
                {usage.enabled ? 'Your AI use is unlimited on this server.' : 'Connect to the server to see your AI allowance.'}
              </T>
            )}

            <View style={{ height: 1, backgroundColor: t.line }} />

            <T variant="headline">{own ? 'Change your API key' : 'Use your own API key'}</T>
            <T variant="caption" muted>
              Bring your own key for unlimited use on your own account. The key is kept in this phone's secure storage and is never synced or stored on the server; it is sent with each AI request over HTTPS.
            </T>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {(Object.keys(PROVIDER_INFO) as Provider[]).map((p) => (
                <Chip key={p} label={PROVIDER_INFO[p].label} selected={provider === p} onPress={() => { feel.select(); setProvider(p) }} />
              ))}
            </View>
            <Field label={`API key · ${PROVIDER_INFO[provider].hint} · get one at ${PROVIDER_INFO[provider].url}`}>
              <TextInput
                value={keyText}
                onChangeText={setKeyText}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="off"
                textContentType="none"
                importantForAutofill="no"
                placeholder="Paste your key"
                placeholderTextColor={t.muted}
                selectionColor={t.accent}
                cursorColor={t.accent}
                style={inputStyle(t)}
              />
            </Field>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <PrimaryButton title={keyBusy ? 'Testing…' : 'Save & test'} icon="key" loading={keyBusy} disabled={!keyText.trim()} onPress={() => void saveKey()} style={{ flex: 1 }} />
              {own ? <SecondaryButton title="Remove" onPress={() => void removeKey()} /> : null}
            </View>
            {keyMsg && (
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
                <Ionicons name={keyMsg.ok ? 'checkmark-circle' : 'alert-circle'} size={18} color={keyMsg.ok ? t.good : t.over} />
                <T variant="caption" color={keyMsg.ok ? 'good' : 'over'} style={{ flex: 1 }}>
                  {keyMsg.text}
                </T>
              </View>
            )}
          </Card>
        </Section>

        <Section icon="server-outline" title="SERVER">
          <Card style={{ gap: 12 }}>
            <T variant="caption" muted>
              The Munch server the app talks to. Currently: {urlNow || '…'}
            </T>
            <Field label="Server address">
              <TextInput
                value={url}
                onChangeText={setUrl}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                placeholder="https://your-server.run.app"
                placeholderTextColor={t.muted}
                selectionColor={t.accent}
                cursorColor={t.accent}
                style={inputStyle(t)}
              />
            </Field>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <PrimaryButton title={checking ? 'Checking…' : 'Save & test'} loading={checking} icon="pulse" onPress={() => void checkServer()} style={{ flex: 1 }} />
              <SecondaryButton
                title="Auto"
                onPress={() => {
                  setUrl('')
                  void checkServer('')
                }}
              />
            </View>
            {status && (
              <View style={{ gap: 4 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Ionicons name={status.ok ? 'checkmark-circle' : 'alert-circle'} size={18} color={status.ok ? t.good : t.over} />
                  <T variant="callout" color={status.ok ? 'good' : 'over'}>
                    {status.ok ? `Connected · ${status.provider}` : "Can't reach the server"}
                  </T>
                </View>
                {status.ok ? (
                  <T variant="caption" muted>
                    Model layer: {status.llmLayer === 'langchain' ? 'LangChain' : 'native'} · Coach: {status.coachEngine === 'langgraph' ? 'LangGraph agent' : 'classic'}
                  </T>
                ) : (
                  <T variant="caption" muted>
                    Check the address and your connection. For a server on your own computer, keep the phone on the same Wi-Fi and allow Node through the firewall.
                  </T>
                )}
              </View>
            )}
          </Card>
        </Section>

        <Section icon="information-circle-outline" title="ABOUT">
          <Card style={{ gap: 4 }}>
            <T variant="headline">{Constants.expoConfig?.name ?? 'Munch'}</T>
            <T variant="caption" muted>
              Version {Constants.expoConfig?.version ?? '1.0.0'} · Your entries are stored on this phone{configured ? ' and synced to your account' : ''}.
            </T>
          </Card>
        </Section>
      </KeyboardScroll>
    </View>
  )
}
