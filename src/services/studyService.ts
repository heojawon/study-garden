import {
  EmailAuthProvider,
  connectAuthEmulator,
  deleteUser,
  getAuth,
  linkWithCredential,
  reauthenticateWithCredential,
  signInAnonymously,
  type User,
} from 'firebase/auth'
import {
  collection,
  connectFirestoreEmulator,
  deleteDoc,
  doc,
  getDocs,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  clearIndexedDbPersistence,
  runTransaction,
  setDoc,
  terminate,
  writeBatch,
  Timestamp,
  type Firestore,
  type DocumentData,
  type DocumentReference,
} from 'firebase/firestore'
import { getApp, getApps, initializeApp } from 'firebase/app'
import type { StudySession, Subject } from '../domain/study'

export interface StudyData {
  userId: string | null
  storage: 'firebase' | 'local'
  notice: string | null
  subjects: Subject[]
  sessions: StudySession[]
}

interface FirebaseRuntime {
  auth: ReturnType<typeof getAuth>
  db: Firestore
  user: User
}

const SUBJECTS_KEY = 'study-garden.subjects'
const SESSIONS_KEY = 'study-garden.sessions'
const ACTIVE_TIMER_KEY = 'study-garden.active-timer'
const DEFAULT_SUBJECTS: Subject[] = [
  { id: 'math', name: '수학', color: '#477B53' },
  { id: 'english', name: '영어', color: '#C78954' },
  { id: 'science', name: '과학', color: '#688E9E' },
]

let runtime: FirebaseRuntime | null = null
let authInstance: ReturnType<typeof getAuth> | null = null
let firestoreInstance: Firestore | null = null
let authEmulatorConnected = false
let firestoreEmulatorConnected = false
let initializationPromise: Promise<StudyData> | null = null

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSubject(value: unknown): value is Subject {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    value.id.trim().length > 0 &&
    typeof value.name === 'string' &&
    value.name.trim().length > 0 &&
    typeof value.color === 'string' &&
    /^#[0-9A-Fa-f]{6}$/.test(value.color)
  )
}

function isSubjects(value: unknown): value is Subject[] {
  return Array.isArray(value) && value.every(isSubject)
}

function isStudySession(value: unknown): value is StudySession {
  return (
    isRecord(value) &&
    (value.id === undefined || typeof value.id === 'string') &&
    typeof value.subjectId === 'string' &&
    value.subjectId.trim().length > 0 &&
    typeof value.startedAt === 'number' &&
    Number.isFinite(value.startedAt) &&
    typeof value.endedAt === 'number' &&
    Number.isFinite(value.endedAt) &&
    typeof value.focusSeconds === 'number' &&
    Number.isInteger(value.focusSeconds) &&
    value.focusSeconds >= 0 &&
    value.mode === 'free' &&
    typeof value.completed === 'boolean'
  )
}

function isStudySessions(value: unknown): value is StudySession[] {
  return Array.isArray(value) && value.every(isStudySession)
}

function localValue<T>(
  key: string,
  fallback: T,
  isValid: (value: unknown) => value is T,
): T {
  const stored = localStorage.getItem(key)
  if (stored === null) return fallback

  let value: unknown
  try {
    value = JSON.parse(stored)
  } catch {
    throw new Error(`Saved browser data for ${key} is invalid JSON.`)
  }
  if (!isValid(value)) {
    throw new Error(`Saved browser data for ${key} has an invalid format.`)
  }
  return value
}

function localFallback(notice: string): StudyData {
  try {
    return {
      userId: null,
      storage: 'local',
      notice,
      subjects: localValue(SUBJECTS_KEY, DEFAULT_SUBJECTS, isSubjects),
      sessions: localValue(SESSIONS_KEY, [], isStudySessions),
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Unknown local storage error'
    return {
      userId: null,
      storage: 'local',
      notice: `${notice} Existing browser data was not overwritten but could not be read. ${reason}`,
      subjects: DEFAULT_SUBJECTS,
      sessions: [],
    }
  }
}

function setLocalValue<T>(key: string, value: T): void {
  localStorage.setItem(key, JSON.stringify(value))
}

function firebaseConfig() {
  const config = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
  }

  return Object.values(config).every((value) => typeof value === 'string' && value.trim())
    ? config
    : null
}

async function connectFirebase(): Promise<FirebaseRuntime | null> {
  const config = firebaseConfig()
  if (!config) return null
  if (runtime) return runtime

  const app = getApps().length ? getApp() : initializeApp(config)
  const auth = authInstance ?? getAuth(app)
  const db =
    firestoreInstance ??
    initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    })
  authInstance = auth
  firestoreInstance = db

  if (import.meta.env.VITE_USE_FIREBASE_EMULATOR === 'true') {
    const host = import.meta.env.VITE_FIREBASE_EMULATOR_HOST || '127.0.0.1'
    if (!authEmulatorConnected) {
      connectAuthEmulator(
        auth,
        `http://${host}:${Number(import.meta.env.VITE_AUTH_EMULATOR_PORT || 9099)}`,
        { disableWarnings: true },
      )
      authEmulatorConnected = true
    }
    if (!firestoreEmulatorConnected) {
      connectFirestoreEmulator(
        db,
        host,
        Number(import.meta.env.VITE_FIRESTORE_EMULATOR_PORT || 8080),
      )
      firestoreEmulatorConnected = true
    }
  }

  const credential =
    auth.currentUser === null ? await signInAnonymously(auth) : { user: auth.currentUser }
  runtime = { auth, db, user: credential.user }
  return runtime
}

function userCollection(db: Firestore, uid: string, child: string) {
  return collection(db, 'users', uid, child)
}

function timestampMillis(value: unknown): number {
  if (value instanceof Timestamp) return value.toMillis()
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'number' && Number.isFinite(value)) return value
  throw new Error('A saved session contains an invalid timestamp.')
}

async function migrateLocalData(connection: FirebaseRuntime): Promise<void> {
  const subjects = localValue(SUBJECTS_KEY, DEFAULT_SUBJECTS, isSubjects)
  const storedSessions = localValue(SESSIONS_KEY, [], isStudySessions)
  const usedSessionIds = new Set<string>()
  const sessions = storedSessions.map((session) => {
    let id = session.id && session.id.trim() ? session.id : crypto.randomUUID()
    while (usedSessionIds.has(id)) id = crypto.randomUUID()
    usedSessionIds.add(id)
    return { ...session, id }
  })

  if (sessions.some((session, index) => session.id !== storedSessions[index].id)) {
    setLocalValue(SESSIONS_KEY, sessions)
  }

  const records: Array<{ reference: DocumentReference; data: DocumentData }> = [
    ...subjects.map((subject) => ({
      reference: doc(
        connection.db,
        'users',
        connection.user.uid,
        'subjects',
        subject.id,
      ),
      data: { ...subject },
    })),
    ...sessions.map((session) => ({
      reference: doc(
        connection.db,
        'users',
        connection.user.uid,
        'sessions',
        session.id,
      ),
      data: {
        ...session,
        startedAt: new Date(session.startedAt),
        endedAt: new Date(session.endedAt),
      },
    })),
  ]

  for (let offset = 0; offset < records.length; offset += 450) {
    const batch = records.slice(offset, offset + 450)
    await runTransaction(connection.db, async (transaction) => {
      const snapshots = await Promise.all(
        batch.map(({ reference }) => transaction.get(reference)),
      )
      snapshots.forEach((snapshot, index) => {
        if (!snapshot.exists()) {
          transaction.set(batch[index].reference, batch[index].data)
        }
      })
    })
  }
}

async function loadFirebaseData(connection: FirebaseRuntime): Promise<StudyData> {
  const [subjectDocs, sessionDocs] = await Promise.all([
    getDocs(userCollection(connection.db, connection.user.uid, 'subjects')),
    getDocs(userCollection(connection.db, connection.user.uid, 'sessions')),
  ])
  const subjects = subjectDocs.docs.map((entry) => ({ id: entry.id, ...entry.data() }) as Subject)
  const sessions = sessionDocs.docs.map((entry) => {
    const data = entry.data()
    return {
      id: entry.id,
      ...data,
      startedAt: timestampMillis(data.startedAt),
      endedAt: timestampMillis(data.endedAt),
    } as StudySession
  })

  if (subjects.length === 0) {
    for (const subject of DEFAULT_SUBJECTS) {
      await setDoc(doc(connection.db, 'users', connection.user.uid, 'subjects', subject.id), subject)
    }
    subjects.push(...DEFAULT_SUBJECTS)
  }

  return {
    userId: connection.user.uid,
    storage: 'firebase',
    notice: null,
    subjects,
    sessions,
  }
}

async function initializeStudyOnce(): Promise<StudyData> {
  try {
    const connection = await connectFirebase()
    if (!connection) {
      const subjects = localValue(SUBJECTS_KEY, DEFAULT_SUBJECTS, isSubjects)
      const sessions = localValue(SESSIONS_KEY, [], isStudySessions)
      setLocalValue(SUBJECTS_KEY, subjects)
      return {
        userId: null,
        storage: 'local',
        notice: 'Firebase is not configured. Your study data is saved only in this browser.',
        subjects,
        sessions,
      }
    }
    await migrateLocalData(connection)
    return await loadFirebaseData(connection)
  } catch (error) {
    runtime = null
    const reason = error instanceof Error ? error.message : 'Unknown connection error'
    const prefix = firebaseConfig()
      ? `Firebase could not connect. Local browser storage is active. ${reason}`
      : 'Firebase is not configured. Your study data is saved only in this browser.'
    return localFallback(`${prefix} ${reason}`)
  }
}

export function initializeStudy(): Promise<StudyData> {
  if (!initializationPromise) {
    initializationPromise = initializeStudyOnce().finally(() => {
      initializationPromise = null
    })
  }
  return initializationPromise
}

export async function createSubject(name: string): Promise<Subject> {
  const subject: Subject = {
    id: crypto.randomUUID(),
    name: name.trim(),
    color: '#477B53',
  }
  if (runtime) {
    await setDoc(doc(runtime.db, 'users', runtime.user.uid, 'subjects', subject.id), subject)
  } else {
    const subjects = localValue(SUBJECTS_KEY, DEFAULT_SUBJECTS, isSubjects)
    setLocalValue(SUBJECTS_KEY, [...subjects, subject])
  }
  return subject
}

export async function saveSession(session: StudySession): Promise<void> {
  const id = session.id ?? crypto.randomUUID()
  const persistedSession = { ...session, id }

  if (runtime) {
    await setDoc(
      doc(runtime.db, 'users', runtime.user.uid, 'sessions', id),
      {
        ...persistedSession,
        startedAt: new Date(session.startedAt),
        endedAt: new Date(session.endedAt),
      },
    )
    return
  }

  const sessions = localValue(SESSIONS_KEY, [], isStudySessions)
  setLocalValue(SESSIONS_KEY, [
    ...sessions.filter((savedSession) => savedSession.id !== id),
    persistedSession,
  ])
}

export async function linkEmailAccount(email: string, password: string): Promise<void> {
  if (!runtime) {
    throw new Error('Connect Firebase before linking an account. Check the setup guide.')
  }
  if (!runtime.user.isAnonymous) {
    throw new Error('This account is already linked.')
  }

  const credential = EmailAuthProvider.credential(email.trim(), password)
  const linked = await linkWithCredential(runtime.user, credential)
  runtime.user = linked.user
}

export function accountDeletionNeedsPassword(): boolean {
  return Boolean(runtime && !runtime.user.isAnonymous)
}

export async function deleteAccount(password?: string): Promise<void> {
  if (!runtime) {
    throw new Error('No Firebase account is connected. Local browser data was not deleted.')
  }

  if (!runtime.user.isAnonymous) {
    const email = runtime.user.email
    const hasEmailProvider = runtime.user.providerData.some(
      (provider) => provider.providerId === EmailAuthProvider.PROVIDER_ID,
    )
    if (!hasEmailProvider || !email || !password) {
      throw new Error('Enter the linked account password to reauthenticate before deletion.')
    }
    const credential = EmailAuthProvider.credential(email, password)
    await reauthenticateWithCredential(runtime.user, credential)
  }

  const uid = runtime.user.uid
  const { db, user } = runtime
  for (const child of ['subjects', 'sessions', 'goals', 'days']) {
    const documents = await getDocs(userCollection(db, uid, child))
    for (let offset = 0; offset < documents.docs.length; offset += 450) {
      const batch = writeBatch(db)
      documents.docs.slice(offset, offset + 450).forEach((entry) => batch.delete(entry.ref))
      await batch.commit()
    }
  }
  await deleteDoc(doc(db, 'users', uid))
  await deleteUser(user)
  runtime = null
  localStorage.removeItem(ACTIVE_TIMER_KEY)
  localStorage.removeItem(SUBJECTS_KEY)
  localStorage.removeItem(SESSIONS_KEY)
  await terminate(db)
  await clearIndexedDbPersistence(db)
}
