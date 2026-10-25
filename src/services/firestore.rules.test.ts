import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc } from 'firebase/firestore'

let environment: RulesTestEnvironment

beforeAll(async () => {
  environment = await initializeTestEnvironment({
    projectId: 'demo-study-garden',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  })
})

beforeEach(async () => {
  await environment.clearFirestore()
})

afterAll(async () => {
  await environment.cleanup()
})

describe('Firestore user ownership rules', () => {
  it('allows a signed-in user to write their own valid subject', async () => {
    const db = environment.authenticatedContext('learner-a').firestore()

    await assertSucceeds(
      setDoc(doc(db, 'users/learner-a/subjects/math'), {
        id: 'math',
        name: '수학',
        color: '#477B53',
      }),
    )
  })

  it('prevents one user from reading another user’s data', async () => {
    const db = environment.authenticatedContext('learner-a').firestore()

    await assertFails(getDoc(doc(db, 'users/learner-b/subjects/math')))
  })

  it('rejects invalid session durations and unauthenticated writes', async () => {
    const db = environment.authenticatedContext('learner-a').firestore()
    const session = {
      id: 'session-1',
      subjectId: 'math',
      startedAt: new Date('2026-10-25T00:00:00.000Z'),
      endedAt: new Date('2026-10-25T00:05:00.000Z'),
      focusSeconds: -1,
      mode: 'free',
      completed: true,
    }

    await assertFails(setDoc(doc(db, 'users/learner-a/sessions/session-1'), session))
    await assertFails(
      setDoc(
        doc(environment.unauthenticatedContext().firestore(), 'users/learner-a/subjects/nope'),
        { id: 'nope', name: 'Nope', color: '#477B53' },
      ),
    )
  })
})
