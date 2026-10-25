import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  elapsedSeconds,
  pauseTimer,
  recoverTimer,
  resumeTimer,
  startTimer,
  type ActiveTimer,
} from './domain/timer'
import type { StudySession, Subject } from './domain/study'
import {
  createSubject,
  deleteAccount,
  accountDeletionNeedsPassword,
  initializeStudy,
  linkEmailAccount,
  saveSession,
  type StudyData,
} from './services/studyService'
import './styles.css'

const ACTIVE_TIMER_KEY = 'study-garden.active-timer'

type Page = '홈' | '타이머' | '기록' | '통계' | '과목' | '설정'

function formatTime(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(safeSeconds / 3600)
  const minutes = Math.floor((safeSeconds % 3600) / 60)
  const remainder = safeSeconds % 60
  return [hours, minutes, remainder].map((value) => String(value).padStart(2, '0')).join(':')
}

function readActiveTimer(): ActiveTimer | null {
  try {
    const raw = localStorage.getItem(ACTIVE_TIMER_KEY)
    return raw ? (JSON.parse(raw) as ActiveTimer) : null
  } catch {
    return null
  }
}

function Icon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    leaf: 'M20 4c-8 0-14 3-14 10a6 6 0 0 0 6 6c7 0 10-6 8-16ZM5 21c2-5 5-8 11-12',
    home: 'm3 10 9-7 9 7v10a1 1 0 0 1-1 1h-6v-7h-4v7H4a1 1 0 0 1-1-1Z',
    timer: 'M10 2h4m-2 0v3m7.1.9 1.4-1.4M12 8v5l3 2m6-3a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
    book: 'M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21Zm0 0V21m0-1.5A2.5 2.5 0 0 1 6.5 17H20',
    chart: 'M4 19V5m0 14h17M8 15l3-4 3 2 5-7',
    flower: 'M12 12c-5-5-8-1-5 2-4 2-1 7 3 4 0 5 6 5 5 0 4 3 7-2 3-4 3-3 0-7-4-3-.5-5-6-5-6 1Zm0 0v9',
    plus: 'M12 5v14m-7-7h14',
    play: 'm8 5 12 7-12 7Z',
    pause: 'M8 5v14m8-14v14',
    check: 'm5 12 4 4L19 6',
    settings: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm0-6v3m0 14v3M4.2 4.2l2.1 2.1m11.4 11.4 2.1 2.1M2 12h3m14 0h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1',
  }
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
      <path d={paths[name] ?? paths.leaf} />
    </svg>
  )
}

export default function App() {
  const [data, setData] = useState<StudyData | null>(null)
  const [activeTimer, setActiveTimer] = useState<ActiveTimer | null>(null)
  const [recovery, setRecovery] = useState<ActiveTimer | null>(null)
  const [selectedSubject, setSelectedSubject] = useState('')
  const [subjectName, setSubjectName] = useState('')
  const [page, setPage] = useState<Page>('홈')
  const [now, setNow] = useState(Date.now())
  const [saving, setSaving] = useState(false)
  const [actionMessage, setActionMessage] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  useEffect(() => {
    let mounted = true
    void initializeStudy().then((result) => {
      if (!mounted) return
      setData(result)
      setSelectedSubject(result.subjects[0]?.id ?? '')
      const saved = readActiveTimer()
      const recovered = saved
        ? recoverTimer(saved, Date.now(), performance.now(), performance.timeOrigin)
        : null
      if (recovered) setRecovery(recovered)
    })
    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(interval)
  }, [])

  useEffect(() => {
    if (!data) return
    if (activeTimer) {
      const wallClockNow = Date.now()
      const monotonicNow = performance.now()
      const snapshot =
        activeTimer.pausedAt === null
          ? {
              ...activeTimer,
              startedAt: wallClockNow,
              accumulatedSeconds: elapsedSeconds(
                activeTimer,
                wallClockNow,
                monotonicNow,
                performance.timeOrigin,
              ),
              startedMonotonicAt: monotonicNow,
            }
          : activeTimer
      localStorage.setItem(ACTIVE_TIMER_KEY, JSON.stringify(snapshot))
    } else if (!recovery) {
      localStorage.removeItem(ACTIVE_TIMER_KEY)
    }
  }, [activeTimer, data, now, recovery])

  const todaySeconds = useMemo(
    () =>
      data?.sessions.reduce((total, session) => {
        const sameDay = new Date(session.endedAt).toDateString() === new Date(now).toDateString()
        return total + (sameDay ? session.focusSeconds : 0)
      }, 0) ?? 0,
    [data?.sessions, now],
  )

  const currentSeconds = activeTimer
    ? elapsedSeconds(activeTimer, now, performance.now(), performance.timeOrigin)
    : 0
  const selectedSubjectInfo = data?.subjects.find((subject) => subject.id === selectedSubject)

  const acceptRecovery = useCallback(() => {
    if (!recovery) return
    const recovered = recoverTimer(
      recovery,
      Date.now(),
      performance.now(),
      performance.timeOrigin,
    )
    if (recovered) {
      setSelectedSubject(recovered.subjectId)
      setActiveTimer(recovered)
      setActionMessage('타이머를 이어서 진행합니다.')
    }
    setRecovery(null)
  }, [recovery])

  async function handleCreateSubject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = subjectName.trim()
    if (!trimmed || !data) return
    if (data.subjects.some((subject) => subject.name.toLocaleLowerCase() === trimmed.toLocaleLowerCase())) {
      setActionMessage('이미 같은 이름의 과목이 있어요.')
      return
    }
    try {
      const subject = await createSubject(trimmed)
      setData((current) =>
        current && !current.subjects.some((existing) => existing.id === subject.id)
          ? { ...current, subjects: [...current.subjects, subject] }
          : current,
      )
      setSelectedSubject(subject.id)
      setSubjectName('')
      setActionMessage(`${subject.name} 과목을 추가했어요.`)
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : '과목을 저장하지 못했어요.')
    }
  }

  function handleStart() {
    if (!selectedSubject) {
      setActionMessage('먼저 공부할 과목을 선택해 주세요.')
      return
    }
    const timer = startTimer(
      selectedSubject,
      Date.now(),
      performance.now(),
      performance.timeOrigin,
    )
    setActiveTimer(timer)
    setActionMessage('집중 타이머를 시작했어요.')
  }

  async function handleFinish() {
    if (!activeTimer || saving) return
    const startedAt = activeTimer.sessionStartedAt ?? activeTimer.startedAt
    const finishedAt = Math.max(Date.now(), startedAt)
    const session: StudySession = {
      id: activeTimer.sessionId ?? crypto.randomUUID(),
      subjectId: activeTimer.subjectId,
      startedAt,
      endedAt: finishedAt,
      focusSeconds: elapsedSeconds(
        activeTimer,
        finishedAt,
        performance.now(),
        performance.timeOrigin,
      ),
      mode: 'free',
      completed: true,
    }
    setSaving(true)
    try {
      await saveSession(session)
      setData((current) =>
        current ? { ...current, sessions: [...current.sessions, session] } : current,
      )
      setActiveTimer(null)
      setRecovery(null)
      localStorage.removeItem(ACTIVE_TIMER_KEY)
      setActionMessage(`${formatTime(session.focusSeconds)} 집중 시간을 저장했어요.`)
    } catch (error) {
      setActionMessage(
        `세션을 저장하지 못했어요. 타이머는 계속 보관됩니다. ${
          error instanceof Error ? error.message : ''
        }`,
      )
    } finally {
      setSaving(false)
    }
  }

  async function handleLinkAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    try {
      await linkEmailAccount(email, password)
      setActionMessage('계정이 연결됐어요. 이제 다른 기기에서도 기록을 이어갈 수 있어요.')
      setPassword('')
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : '계정을 연결하지 못했어요.')
    }
  }

  async function handleDeleteAccount() {
    if (!window.confirm('계정과 저장된 모든 학습 기록을 삭제할까요? 이 작업은 되돌릴 수 없어요.')) {
      return
    }
    try {
      let passwordForDeletion: string | undefined
      if (accountDeletionNeedsPassword()) {
        const enteredPassword = window.prompt(
          '계정 삭제를 위해 현재 계정의 비밀번호를 다시 입력해 주세요.',
        )
        if (enteredPassword === null) return
        passwordForDeletion = enteredPassword
      }
      await deleteAccount(passwordForDeletion)
      setActionMessage('계정과 학습 기록을 삭제했어요.')
      window.location.reload()
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : '계정을 삭제하지 못했어요.')
    }
  }

  if (!data) {
    return (
      <main className="loading-screen" aria-live="polite">
        <span className="loading-mark"><Icon name="leaf" /></span>
        <p>정원을 준비하고 있어요...</p>
      </main>
    )
  }

  const navItems: { label: Page; icon: string }[] = [
    { label: '홈', icon: 'home' },
    { label: '타이머', icon: 'timer' },
    { label: '기록', icon: 'book' },
    { label: '통계', icon: 'chart' },
    { label: '과목', icon: 'flower' },
    { label: '설정', icon: 'settings' },
  ]

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#home" onClick={() => setPage('홈')}>
          <span className="brand-mark"><Icon name="leaf" /></span>
          <span>study garden<small>천천히, 꾸준히 자라요</small></span>
        </a>
        <p className="nav-caption">나의 정원</p>
        <nav aria-label="주 메뉴">
          {navItems.map((item) => (
            <button
              className={`nav-item ${page === item.label ? 'selected' : ''}`}
              key={item.label}
              onClick={() => setPage(item.label)}
              aria-current={page === item.label ? 'page' : undefined}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-plant" aria-hidden="true">🌱</div>
          <p>작은 시간이 모여<br />큰 숲이 돼요.</p>
          <span>오늘도 응원할게요</span>
        </div>
      </aside>

      <main id="main-content" className="main-content">
        <header className="topbar">
          <div className="mobile-brand"><span className="brand-mark"><Icon name="leaf" /></span> study garden</div>
          <div className="breadcrumb">나의 정원 <span>/</span> {page}</div>
          <div className="profile-chip">
            <span className="avatar" aria-hidden="true">🌿</span>
            <span>오늘의 정원사</span>
          </div>
        </header>

        <div className="content-wrap">
          <section className="welcome-row">
            <div>
              <p className="eyebrow">{new Intl.DateTimeFormat('ko-KR', { dateStyle: 'full' }).format(now)}</p>
              <h1>좋은 오후예요, 오늘도 자라나요</h1>
              <p className="welcome-subtitle">한 걸음씩 쌓아가는 당신의 공부 정원이에요.</p>
            </div>
            <div className="weather-chip"><span aria-hidden="true">☀️</span> 집중하기 좋은 날</div>
          </section>

          {data.notice && (
            <div className="setup-notice" role="status">
              <span className="notice-dot" aria-hidden="true" />
              <span>{data.notice}</span>
              <a href="#firebase-setup" onClick={() => setPage('설정')}>Firebase 설정 안내</a>
            </div>
          )}

          <section className="dashboard-grid">
            <div className="primary-column">
              <article className="hero-card">
                <div className="hero-copy">
                  <span className="hero-kicker"><Icon name="leaf" /> 오늘의 성장</span>
                  <h2>오늘도 한 뼘,<br />자라고 있어요.</h2>
                  <p>꾸준히 쌓아가는 시간이<br />나만의 숲을 만들어요.</p>
                  <div className="hero-metric">
                    <span className="metric-icon"><Icon name="timer" /></span>
                    <span><strong>{formatTime(todaySeconds)}</strong><small>오늘 공부한 시간</small></span>
                  </div>
                </div>
                <div className="garden-art" role="img" aria-label="햇살 아래 자라는 작은 나무">
                  <div className="sun-glow" />
                  <div className="cloud cloud-one" />
                  <div className="cloud cloud-two" />
                  <div className="hill hill-back" />
                  <div className="hill hill-front" />
                  <div className="tree"><span className="tree-top" /><span className="tree-trunk" /></div>
                  <span className="art-flower flower-one">✿</span><span className="art-flower flower-two">✿</span>
                  <span className="art-leaf">✦</span>
                </div>
              </article>

              <article className="panel timer-panel" aria-labelledby="timer-heading">
                <div className="panel-heading">
                  <div><p className="eyebrow">FREE FOCUS</p><h2 id="timer-heading">집중 타이머</h2></div>
                  <span className={`timer-state ${activeTimer ? activeTimer.pausedAt ? 'paused' : 'running' : ''}`}>
                    <span /> {activeTimer ? activeTimer.pausedAt ? '잠시 쉬는 중' : '집중 중' : '준비 완료'}
                  </span>
                </div>
                <div className="timer-layout">
                  <div className={`timer-ring ${activeTimer && activeTimer.pausedAt === null ? 'is-running' : ''}`}>
                    <div className="timer-ring-inner">
                      <span className="timer-label">{activeTimer ? selectedSubjectInfo?.name ?? '집중 시간' : '오늘의 집중'}</span>
                      <strong aria-live="off">{formatTime(currentSeconds)}</strong>
                      <span className="timer-caption">{activeTimer ? '차분히 이어가요' : '작은 시작이 큰 변화를 만들어요'}</span>
                    </div>
                  </div>
                  <div className="timer-controls">
                    <label htmlFor="subject-select">오늘 공부할 과목</label>
                    <select
                      id="subject-select"
                      value={selectedSubject}
                      onChange={(event) => setSelectedSubject(event.target.value)}
                      disabled={Boolean(activeTimer)}
                    >
                      {data.subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
                    </select>
                    <div className="timer-buttons">
                      {!activeTimer ? (
                        <button className="button button-primary" onClick={handleStart} disabled={!data.subjects.length}>
                          <Icon name="play" /> 집중 시작
                        </button>
                      ) : (
                        <>
                          <button
                            className="button button-soft"
                            onClick={() => setActiveTimer(
                              activeTimer.pausedAt === null
                                ? pauseTimer(
                                    activeTimer,
                                    Date.now(),
                                    performance.now(),
                                    performance.timeOrigin,
                                  )
                                : resumeTimer(
                                    activeTimer,
                                    Date.now(),
                                    performance.now(),
                                    performance.timeOrigin,
                                  ),
                            )}
                          >
                            <Icon name={activeTimer.pausedAt === null ? 'pause' : 'play'} />
                            {activeTimer.pausedAt === null ? '일시정지' : '다시 시작'}
                          </button>
                          <button className="button button-primary" onClick={() => void handleFinish()} disabled={saving}>
                            <Icon name="check" /> {saving ? '저장 중...' : '세션 저장'}
                          </button>
                        </>
                      )}
                    </div>
                    <p className="timer-helper">타이머는 실제 시각을 기준으로 계산돼요.</p>
                  </div>
                </div>
              </article>

              {page === '기록' && (
                <article className="panel history-panel">
                  <div className="panel-heading"><div><p className="eyebrow">YOUR JOURNEY</p><h2>최근 공부 기록</h2></div></div>
                  {data.sessions.length ? (
                    <ul className="session-list">{[...data.sessions].reverse().map((session, index) => (
                      <li key={session.id ?? `${session.startedAt}-${index}`}>
                        <span className="subject-dot" />
                        <span>{data.subjects.find((subject) => subject.id === session.subjectId)?.name ?? '과목'}</span>
                        <time>{formatTime(session.focusSeconds)}</time>
                      </li>
                    ))}</ul>
                  ) : <p className="empty-state">첫 집중 세션을 마치면 여기에 기록돼요.</p>}
                </article>
              )}
              {page === '통계' && (
                <article className="panel history-panel">
                  <div className="panel-heading"><div><p className="eyebrow">GROWTH THIS WEEK</p><h2>오늘의 성장 기록</h2></div></div>
                  <div className="stats-summary"><strong>{formatTime(todaySeconds)}</strong><span>오늘 저장된 집중 시간</span></div>
                </article>
              )}
              {page === '과목' && (
                <article className="panel history-panel">
                  <div className="panel-heading"><div><p className="eyebrow">YOUR SUBJECTS</p><h2>나의 과목</h2></div></div>
                  <ul className="subject-list">{data.subjects.map((subject) => <li key={subject.id}><span className="subject-dot" style={{ backgroundColor: subject.color }} />{subject.name}</li>)}</ul>
                  <form className="add-subject-form" onSubmit={(event) => void handleCreateSubject(event)}>
                    <label className="sr-only" htmlFor="new-subject">과목 이름</label>
                    <input id="new-subject" value={subjectName} onChange={(event) => setSubjectName(event.target.value)} placeholder="새 과목 이름" maxLength={40} />
                    <button className="button button-primary" type="submit"><Icon name="plus" /> 과목 추가</button>
                  </form>
                </article>
              )}
            </div>

            <aside className="secondary-column">
              <article className="panel subject-panel">
                <div className="panel-heading compact">
                  <div><p className="eyebrow">YOUR SUBJECTS</p><h2>자라고 있는 과목</h2></div>
                  <button className="icon-button" aria-label="과목 관리" onClick={() => setPage('과목')}><Icon name="plus" /></button>
                </div>
                <div className="subject-cards">
                  {(data.subjects.slice(0, 3) as Subject[]).map((subject, index) => (
                    <button className={`subject-card subject-${index}`} key={subject.id} onClick={() => { setSelectedSubject(subject.id); setPage('타이머') }}>
                      <span className="subject-emoji" aria-hidden="true">{['🌱', '🌼', '🌿'][index % 3]}</span>
                      <span className="subject-card-copy"><strong>{subject.name}</strong><small>오늘의 작은 새싹</small></span>
                      <span className="subject-arrow" aria-hidden="true">↗</span>
                    </button>
                  ))}
                  <form className="inline-add-form" onSubmit={(event) => void handleCreateSubject(event)}>
                    <label className="sr-only" htmlFor="inline-subject">과목 이름</label>
                    <input id="inline-subject" value={subjectName} onChange={(event) => setSubjectName(event.target.value)} placeholder="새 과목 이름" maxLength={40} />
                    <button className="icon-button add-icon" aria-label="과목 추가" type="submit"><Icon name="plus" /></button>
                  </form>
                </div>
              </article>

              <article className="quote-card">
                <span className="quote-leaves" aria-hidden="true">❧</span>
                <p>“천천히 자라도 괜찮아요.<br />중요한 건 멈추지 않는 거예요.”</p>
                <small>오늘의 정원 한마디</small>
              </article>

              <article className="panel account-panel">
                <div><p className="eyebrow">ACCOUNT & SYNC</p><h2>계정과 동기화</h2></div>
                {data.userId ? (
                  <>
                    <p className="account-state">익명 계정으로 안전하게 저장 중</p>
                    <form className="account-form" onSubmit={(event) => void handleLinkAccount(event)}>
                      <label htmlFor="account-email">이메일로 계정 연결</label>
                      <input id="account-email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="이메일 주소" required />
                      <input aria-label="비밀번호" type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="비밀번호 (6자 이상)" minLength={6} required />
                      <button className="button button-primary button-full" type="submit">계정 연결</button>
                    </form>
                    <button className="text-button danger-text" onClick={() => void handleDeleteAccount()}>계정 및 데이터 삭제</button>
                  </>
                ) : (
                  <>
                    <p className="account-state">브라우저에만 저장돼요. Firebase를 연결하면 계정 연결과 동기화를 사용할 수 있어요.</p>
                    <a className="setup-link" href="#firebase-setup">Firebase 프로젝트 설정 방법</a>
                  </>
                )}
              </article>
            </aside>
          </section>
          {page === '설정' && (
            <section className="panel setup-guide" id="firebase-setup" aria-labelledby="setup-heading">
              <p className="eyebrow">SETUP & PRIVACY</p>
              <h2 id="setup-heading">Firebase 연결과 계정 설정</h2>
              <p>Firebase 프로젝트를 아직 만들지 않았다면 지금은 브라우저 로컬 저장 모드로 사용할 수 있어요. 로컬 기록은 이 브라우저에만 저장되며 기기 간 동기화되지 않습니다.</p>
              <ol>
                <li>Firebase 콘솔에서 프로젝트를 만들고 Authentication의 익명 로그인과 이메일/비밀번호를 켜세요.</li>
                <li>Firestore 데이터베이스를 만들고 프로젝트 루트에서 <code>firestore.rules</code>를 배포하세요. 테스트 모드를 사용하지 마세요.</li>
                <li><code>.env.example</code>을 <code>.env.local</code>로 복사하고 Firebase 웹 앱 설정값을 입력하세요.</li>
                <li>에뮬레이터를 쓸 때는 <code>VITE_USE_FIREBASE_EMULATOR=true</code>를 설정하고 <code>npm run emulators</code>를 실행하세요.</li>
              </ol>
              {data.userId ? (
                <>
                  <p className="account-state">익명 사용자 ID: <code>{data.userId}</code></p>
                  <form className="account-form settings-account-form" onSubmit={(event) => void handleLinkAccount(event)}>
                    <label htmlFor="settings-email">이메일 계정 연결</label>
                    <input id="settings-email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="이메일 주소" required />
                    <input aria-label="설정 비밀번호" type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="비밀번호 (6자 이상)" minLength={6} required />
                    <button className="button button-primary" type="submit">계정 연결</button>
                  </form>
                  <button className="text-button danger-text" onClick={() => void handleDeleteAccount()}>계정 및 모든 데이터 삭제</button>
                </>
              ) : <a className="setup-link" href="#firebase-setup">Firebase가 연결되면 계정 연결 기능을 사용할 수 있어요.</a>}
            </section>
          )}
          <footer className="footer-note"><span>✦</span> 작은 시간이 모여 나만의 숲이 됩니다.</footer>
        </div>
      </main>

      <nav className="mobile-nav" aria-label="모바일 주 메뉴">
        {navItems.map((item) => (
          <button key={item.label} aria-current={page === item.label ? 'page' : undefined} onClick={() => setPage(item.label)}>
            <Icon name={item.icon} /><span>{item.label}</span>
          </button>
        ))}
      </nav>

      <div className="sr-only" role="status" aria-live="polite">{actionMessage}</div>

      {recovery && (
        <div className="dialog-backdrop">
          <section className="recovery-dialog" role="dialog" aria-modal="true" aria-labelledby="recovery-heading" aria-describedby="recovery-description">
            <span className="dialog-icon" aria-hidden="true">🌱</span>
            <p className="eyebrow">A LITTLE SPROUT IS WAITING</p>
            <h2 id="recovery-heading">진행 중인 타이머 복구</h2>
            <p id="recovery-description">이전에 시작한 집중 타이머가 있어요. 이어서 공부할까요?</p>
            <p className="recovery-time">
              현재까지{' '}
              {formatTime(
                elapsedSeconds(recovery, now, performance.now(), performance.timeOrigin),
              )}
            </p>
            <div className="dialog-actions">
              <button className="button button-soft" onClick={() => { setRecovery(null); localStorage.removeItem(ACTIVE_TIMER_KEY) }}>새로 시작하기</button>
              <button className="button button-primary" onClick={acceptRecovery}>이어서 하기</button>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
