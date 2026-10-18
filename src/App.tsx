import { useState } from 'react'
import { todayStr } from './util'
import DayView from './views/DayView'
import CalendarView from './views/CalendarView'
import WeightView from './views/WeightView'
import CoachView from './views/CoachView'
import PlanView from './views/PlanView'
import SettingsView from './views/SettingsView'
import Icon from './components/Icon'
import { ToastProvider } from './components/Toast'
import ThemeSwitch from './components/ThemeSwitch'
import Logo from './components/Logo'
import LoginScreen from './views/LoginScreen'
import { Avatar } from './components/AccountCard'
import { useSession } from './lib/session'

type Tab = 'day' | 'plan' | 'coach' | 'calendar' | 'weight' | 'settings'

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'day', label: 'Log', icon: 'log' },
  { id: 'plan', label: 'Plan', icon: 'utensils' },
  { id: 'coach', label: 'Coach', icon: 'coach' },
  { id: 'calendar', label: 'Calendar', icon: 'calendar' },
  { id: 'weight', label: 'Weight', icon: 'weight' },
  { id: 'settings', label: 'Goals', icon: 'target' },
]

const tabFromHash = (): Tab => {
  const h = location.hash.replace('#', '')
  return (TABS.find((t) => t.id === h)?.id ?? 'day') as Tab
}

export default function App() {
  const [tab, setTabState] = useState<Tab>(tabFromHash)
  // keep the address in sync so a tab can be linked to, and survives a refresh
  const setTab = (t: Tab) => {
    setTabState(t)
    history.replaceState(null, '', t === 'day' ? location.pathname + location.search : `#${t}`)
  }
  const [date, setDate] = useState(todayStr())
  const { configured, loading, user, sync } = useSession()

  // With Firebase configured, the app asks you to sign in first. Without it, it just runs locally as before.
  if (configured && loading) return <div className="boot"><Logo size={56} /></div>
  if (configured && !user) return <LoginScreen />

  return (
    <ToastProvider>
      <div className="app">
        <aside className="side">
          <div className="brand">
            <Logo size={36} />
            <span className="brand-name">Munch</span>
          </div>
          <nav>
            {TABS.map((t) => (
              <button key={t.id} className={`nav ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
                <Icon name={t.icon} />
                <span>{t.label}</span>
              </button>
            ))}
          </nav>
          <div className="side-foot">
            {user && (
              <button className="account-chip" onClick={() => setTab('settings')} title="Account and sync">
                <Avatar name={user.name} photo={user.photo} size={28} />
                <span className="account-name">{user.name.split(' ')[0] || 'Account'}</span>
                <i className={`sync-dot ${sync.state}`} aria-label={`Sync: ${sync.state}`} />
              </button>
            )}
            <ThemeSwitch />
            <p>Saved on this device. Text and photos you log are sent to your AI provider.</p>
          </div>
        </aside>
        <main className="content" key={tab}>
          {tab === 'day' && <DayView date={date} setDate={setDate} onGoals={() => setTab('settings')} />}
          {tab === 'plan' && <PlanView date={date} />}
          {tab === 'coach' && <CoachView />}
          {tab === 'calendar' && (
            <CalendarView
              selected={date}
              onPick={(d) => {
                setDate(d)
                setTab('day')
              }}
            />
          )}
          {tab === 'weight' && <WeightView />}
          {tab === 'settings' && <SettingsView />}
        </main>
      </div>
    </ToastProvider>
  )
}
