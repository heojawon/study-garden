import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { StudySession, Subject } from '../domain/study'

const firebase = vi.hoisted(() => ({
  documents: new Map<string, Record<string, unknown>>(),
  runTransaction: vi.fn(),
  signInAnonymously: vi.fn(),
}))

vi.mock('firebase/app', () => ({
  getApp: vi.fn(() => ({})),
  getApps: vi.fn(() => []),
  initializeApp: vi.fn(() => ({})),
}))

vi.mock('firebase/auth', () => ({
  EmailAuthProvider: {
    PROVIDER_ID: 'password',
    credential: vi.fn(),
  },
  connectAuthEmulator: vi.fn(),
  deleteUser: vi.fn(),
  getAuth: vi.fn(() => ({ currentUser: null })),
  linkWithCredential: vi.fn(),
  reauthenticateWithCredential: vi.fn(),
  signInAnonymously: firebase.signInAnonymously,
}))

vi.mock('firebase/firestore', () => ({
  Timestamp: class Timestamp {},
  clearIndexedDbPersistence: vi.fn(),
  collection: vi.fn((_db, ...segments: string[]) => ({ path: segments.join('/') })),
  connectFirestoreEmulator: vi.fn(),
  deleteDoc: vi.fn(),
  doc: vi.fn((_db, ...segments: string[]) => ({
    id: segments.at(-1),
    path: segments.join('/'),
  })),
  getDocs: vi.fn(async (reference: { path: string }) => ({
    docs: [...firebase.documents.entries()]
      .filter(([path]) => path.startsWith(`${reference.path}/`))
      .map(([path, data]) => ({
        id: path.slice(reference.path.length + 1),
        data: () => data,
      })),
  })),
  initializeFirestore: vi.fn(() => ({})),
  persistentLocalCache: vi.fn(() => ({})),
  persistentMultipleTabManager: vi.fn(() => ({})),
  runTransaction: firebase.runTransaction,
  setDoc: vi.fn(async (reference: { path: string }, data: Record<string, unknown>) => {
    firebase.documents.set(reference.path, data)
  }),
  terminate: vi.fn(),
  writeBatch: vi.fn(),
}))

describe('local study data migration', () => {
  let studyService: typeof import('./studyService')

  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    firebase.documents.clear()
    localStorage.clear()
    vi.stubEnv('VITE_FIREBASE_API_KEY', 'test-api-key')
    vi.stubEnv('VITE_FIREBASE_AUTH_DOMAIN', 'test.example.com')
    vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'study-garden-test')
    vi.stubEnv('VITE_FIREBASE_APP_ID', 'test-app-id')
    vi.stubEnv('VITE_USE_FIREBASE_EMULATOR', 'false')
    firebase.signInAnonymously.mockResolvedValue({
      user: { uid: 'learner', isAnonymous: true, providerData: [] },
    })
    firebase.runTransaction.mockImplementation(
      async (
        _db: unknown,
        callback: (transaction: {
          get: (reference: { path: string }) => Promise<{ exists: () => boolean }>
          set: (reference: { path: string }, data: Record<string, unknown>) => void
        }) => Promise<void>,
      ) =>
        callback({
          get: async (reference) => ({
            exists: () => firebase.documents.has(reference.path),
          }),
          set: (reference, data) => firebase.documents.set(reference.path, data),
        }),
    )
    studyService = await import('./studyService')
  })

  it('migrates local subjects and sessions and safely retries the migration', async () => {
    const subjects: Subject[] = [
      { id: 'math', name: '수학', color: '#477B53' },
      { id: 'history', name: '역사', color: '#C78954' },
    ]
    const sessions: StudySession[] = [
      {
        id: 'session-1',
        subjectId: 'history',
        startedAt: 1_700_000_000_000,
        endedAt: 1_700_000_060_000,
        focusSeconds: 60,
        mode: 'free',
        completed: true,
      },
    ]
    localStorage.setItem('study-garden.subjects', JSON.stringify(subjects))
    localStorage.setItem('study-garden.sessions', JSON.stringify(sessions))

    const firstLoad = await studyService.initializeStudy()
    const secondLoad = await studyService.initializeStudy()

    expect(firstLoad.storage).toBe('firebase')
    expect(firstLoad.subjects.map((subject) => subject.id)).toContain('history')
    expect(firstLoad.sessions.map((session) => session.id)).toEqual(['session-1'])
    expect(secondLoad.sessions.map((session) => session.id)).toEqual(['session-1'])
    expect(firebase.documents.get('users/learner/sessions/session-1')?.focusSeconds).toBe(60)
  })

  it('preserves cloud documents when local IDs collide', async () => {
    firebase.documents.set('users/learner/subjects/math', {
      id: 'math',
      name: 'Cloud Math',
      color: '#477B53',
    })
    localStorage.setItem(
      'study-garden.subjects',
      JSON.stringify([
        { id: 'math', name: 'Local Math', color: '#C78954' },
        { id: 'history', name: '역사', color: '#C78954' },
      ]),
    )

    const result = await studyService.initializeStudy()

    expect(result.subjects.find((subject) => subject.id === 'math')?.name).toBe('Cloud Math')
    expect(result.subjects.map((subject) => subject.id)).toContain('history')
  })

  it('assigns stable distinct IDs to local sessions with duplicate IDs', async () => {
    localStorage.setItem(
      'study-garden.sessions',
      JSON.stringify([
        {
          id: 'duplicate',
          subjectId: 'math',
          startedAt: 1_700_000_000_000,
          endedAt: 1_700_000_030_000,
          focusSeconds: 30,
          mode: 'free',
          completed: true,
        },
        {
          id: 'duplicate',
          subjectId: 'math',
          startedAt: 1_700_000_060_000,
          endedAt: 1_700_000_120_000,
          focusSeconds: 60,
          mode: 'free',
          completed: true,
        },
      ]),
    )

    const result = await studyService.initializeStudy()
    const storedSessions = JSON.parse(
      localStorage.getItem('study-garden.sessions') ?? '[]',
    ) as StudySession[]

    expect(result.sessions).toHaveLength(2)
    expect(new Set(storedSessions.map((session) => session.id)).size).toBe(2)
  })

  it('keeps local data available when migration fails', async () => {
    const localSubjects = [{ id: 'history', name: '역사', color: '#C78954' }]
    localStorage.setItem('study-garden.subjects', JSON.stringify(localSubjects))
    firebase.runTransaction.mockRejectedValueOnce(new Error('Firestore unavailable'))

    const result = await studyService.initializeStudy()

    expect(result.storage).toBe('local')
    expect(result.subjects).toEqual(localSubjects)
    expect(localStorage.getItem('study-garden.subjects')).toEqual(JSON.stringify(localSubjects))

    const retried = await studyService.initializeStudy()

    expect(retried.storage).toBe('firebase')
    expect(retried.subjects).toEqual(localSubjects)
  })

  it('shares one in-flight initialization across concurrent callers', async () => {
    const resolvers: Array<() => void> = []
    firebase.signInAnonymously.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvers.push(() =>
            resolve({ user: { uid: 'learner', isAnonymous: true, providerData: [] } }),
          )
        }),
    )

    const firstLoad = studyService.initializeStudy()
    const secondLoad = studyService.initializeStudy()

    expect(firebase.signInAnonymously).toHaveBeenCalledTimes(1)
    resolvers.forEach((release) => release())
    await Promise.all([firstLoad, secondLoad])
  })

  it('does not overwrite malformed local data and explains the problem', async () => {
    const malformedSubjects = '{"id":"math","name":"수학"}'
    localStorage.setItem('study-garden.subjects', malformedSubjects)
    vi.stubEnv('VITE_FIREBASE_API_KEY', '')

    const result = await studyService.initializeStudy()

    expect(result.notice).toContain('not overwritten')
    expect(localStorage.getItem('study-garden.subjects')).toBe(malformedSubjects)
  })

  it('upserts local sessions by ID so retries do not create duplicates', async () => {
    vi.stubEnv('VITE_FIREBASE_API_KEY', '')
    const session: StudySession = {
      id: 'retry-safe',
      subjectId: 'math',
      startedAt: 1_700_000_000_000,
      endedAt: 1_700_000_060_000,
      focusSeconds: 60,
      mode: 'free',
      completed: true,
    }
    await studyService.initializeStudy()

    await studyService.saveSession(session)
    await studyService.saveSession(session)

    const storedSessions = JSON.parse(
      localStorage.getItem('study-garden.sessions') ?? '[]',
    ) as StudySession[]
    expect(storedSessions).toHaveLength(1)
  })
})
