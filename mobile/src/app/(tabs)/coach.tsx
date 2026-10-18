import { useEffect, useRef, useState } from 'react'
import { ScrollView, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import Animated, { FadeInDown } from 'react-native-reanimated'
import { font, radius, useTheme } from '@/theme'
import { askCoach, coachEngine, type Turn } from '@/lib/coach'
import { useKeyboardLift } from '@/lib/hooks'
import { feel } from '@/lib/feel'
import { Card, Chip, Press, T } from '@/components/ui'
import { Skeleton } from '@/components/Skeleton'

const SUGGESTIONS = ['How did my last 7 days go?', 'Am I hitting my protein goal?', 'What do I eat most often?', 'Suggest a dinner for what I have left today', 'Is my weight trending the right way?']

function newThread() {
  return `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export default function Coach() {
  const t = useTheme()
  const insets = useSafeAreaInsets()
  const [turns, setTurns] = useState<Turn[]>([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [live, setLive] = useState<string[]>([])
  const [error, setError] = useState('')
  const [engine, setEngine] = useState('')
  const [barH, setBarH] = useState(80)
  const thread = useRef(newThread())
  const scroller = useRef<ScrollView>(null)
  const bar = useRef<View>(null)
  const lift = useKeyboardLift(bar)

  useEffect(() => {
    void coachEngine().then(setEngine)
  }, [])

  useEffect(() => {
    const id = setTimeout(() => scroller.current?.scrollToEnd({ animated: true }), 60)
    return () => clearTimeout(id)
  }, [turns, live, busy])

  async function send(q?: string) {
    const msg = (q ?? text).trim()
    if (!msg || busy) return
    feel.tap()
    const next: Turn[] = [...turns, { role: 'user', text: msg }]
    setTurns(next)
    setText('')
    setBusy(true)
    setError('')
    setLive([])
    const used: string[] = []
    try {
      const answer = await askCoach(
        next,
        (label) => {
          used.push(label)
          setLive([...used])
          feel.select()
        },
        thread.current,
      )
      setTurns([...next, { role: 'coach', text: answer, tools: used }])
      feel.success()
    } catch (e) {
      // A failed request can leave the server-side conversation mid-step, so start a fresh thread.
      thread.current = newThread()
      setError((e as Error).message)
      feel.error()
    } finally {
      setBusy(false)
      setLive([])
    }
  }

  const ToolChips = ({ list }: { list: string[] }) => (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
      {list.map((x, i) => (
        <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: t.accentSoft }}>
          <Ionicons name="sparkles" size={11} color={t.accentStrong} />
          <T variant="caption" color="accentStrong" style={{ fontSize: 11 }}>
            {x}
          </T>
        </View>
      ))}
    </View>
  )

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView
        ref={scroller}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: insets.top + 12, paddingHorizontal: 16, paddingBottom: barH + 24, gap: 14 }}
      >
        <View style={{ gap: 4 }}>
          <T variant="largeTitle">Coach</T>
          <T variant="callout" muted>
            Ask about your own data. Answers use your real numbers.
          </T>
          {engine === 'langgraph' && (
            <View style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4, paddingHorizontal: 10, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: t.accentSoft }}>
              <Ionicons name="sparkles" size={11} color={t.accentStrong} />
              <T variant="caption" color="accentStrong" style={{ fontFamily: font.semibold, fontSize: 11 }}>
                LangGraph agent
              </T>
            </View>
          )}
        </View>

        {turns.length === 0 && (
          <Card style={{ alignItems: 'center', gap: 12, paddingVertical: 26 }}>
            <View style={{ width: 54, height: 54, borderRadius: 16, backgroundColor: t.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="chatbubble-ellipses" size={26} color={t.accent} />
            </View>
            <T variant="title">Ask anything about your eating</T>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
              {SUGGESTIONS.map((s) => (
                <Chip key={s} label={s} onPress={() => void send(s)} />
              ))}
            </View>
          </Card>
        )}

        {turns.map((m, i) => (
          <Animated.View key={i} entering={FadeInDown.duration(260)} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '88%' }}>
            {m.tools && m.tools.length > 0 && <ToolChips list={m.tools} />}
            {m.role === 'user' ? (
              <LinearGradient colors={[t.btnA, t.btnB]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ paddingHorizontal: 15, paddingVertical: 11, borderRadius: 20, borderTopRightRadius: 6 }}>
                <T variant="body" style={{ color: '#fff' }}>
                  {m.text}
                </T>
              </LinearGradient>
            ) : (
              <View style={{ paddingHorizontal: 15, paddingVertical: 11, borderRadius: 20, borderTopLeftRadius: 6, backgroundColor: t.card, borderWidth: 1, borderColor: t.line }}>
                <T variant="body" selectable>
                  {m.text}
                </T>
              </View>
            )}
          </Animated.View>
        ))}

        {busy && (
          <View style={{ alignSelf: 'flex-start', width: '70%', gap: 8 }}>
            {live.length > 0 && <ToolChips list={live} />}
            <Skeleton height={54} />
          </View>
        )}
        {error ? (
          <T variant="caption" color="over">
            {error}
          </T>
        ) : null}
      </ScrollView>

      <View ref={bar} collapsable={false} onLayout={(e) => setBarH(e.nativeEvent.layout.height)} style={{ position: 'absolute', left: 0, right: 0, bottom: lift, paddingHorizontal: 12, paddingBottom: 12, paddingTop: 6 }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'flex-end',
            gap: 8,
            padding: 8,
            paddingLeft: 16,
            backgroundColor: t.card,
            borderRadius: radius.xl,
            borderWidth: 1,
            borderColor: t.line,
            shadowColor: t.shadow,
            shadowOpacity: t.dark ? 0.5 : 0.12,
            shadowRadius: 24,
            shadowOffset: { width: 0, height: 10 },
            elevation: 10,
          }}
        >
          <TextInput
            value={text}
            onChangeText={setText}
            editable={!busy}
            multiline
            placeholder="Ask your coach…"
            placeholderTextColor={t.muted}
            selectionColor={t.accent}
            cursorColor={t.accent}
            accessibilityLabel="Ask your coach"
            style={{ flex: 1, fontFamily: font.regular, fontSize: 17, color: t.text, maxHeight: 110, minHeight: 40, paddingTop: 8, paddingBottom: 8 }}
          />
          <Press onPress={() => void send()} disabled={busy || !text.trim()} haptic={false} accessibilityLabel="Ask" style={{ opacity: busy || !text.trim() ? 0.4 : 1 }}>
            <LinearGradient colors={[t.btnA, t.btnB]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="arrow-up" size={20} color="#fff" />
            </LinearGradient>
          </Press>
        </View>
      </View>
    </View>
  )
}
