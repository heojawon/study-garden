import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { createSubject, initializeStudy, saveSession } from './services/studyService'
import type { Subject } from './domain/study'

vi.mock('./services/studyService', () => ({
  initializeStudy: vi.fn(),
  createSubject: vi.fn(),
  saveSession: vi.fn(),
  linkEmailAccount: vi.fn(),
  deleteAccount: vi.fn(),
}))

describe('Study Garden timer flow', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
    vi.useRealTimers()
    vi.mocked(initializeStudy).mockResolvedValue({
      userId: null,
      storage: 'local',
      notice: 'Firebase is not configured.',
      subjects: [{ id: 'math', name: '수학', color: '#477B53' }],
      sessions: [],
    })
    vi.mocked(createSubject).mockImplementation(async (name) => ({
      id: 'new-subject',
      name,
      color: '#477B53',
    }))
    vi.mocked(saveSession).mockResolvedValue()
  })

  it('lets a learner create and select a subject', async () => {
    vi.mocked(createSubject).mockImplementation(async (name) => ({
      id: 'physics',
      name,
      color: '#477B53',
    }))
    render(<App />)

    await screen.findByRole('heading', { name: '좋은 오후예요, 오늘도 자라나요' })
    fireEvent.change(screen.getByLabelText('과목 이름'), {
      target: { value: '물리학' },
    })
    fireEvent.click(screen.getByRole('button', { name: '과목 추가' }))

    expect(await screen.findByRole('option', { name: '물리학' })).toBeInTheDocument()
  })

  it('keeps subjects created by concurrent form submissions', async () => {
    let resolveFirst: ((subject: Subject) => void) | undefined
    let resolveSecond: ((subject: Subject) => void) | undefined
    vi.mocked(createSubject)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSecond = resolve
          }),
      )
    render(<App />)

    await screen.findByRole('heading', { name: '좋은 오후예요, 오늘도 자라나요' })
    fireEvent.change(screen.getByLabelText('과목 이름'), { target: { value: '물리학' } })
    fireEvent.click(screen.getByRole('button', { name: '과목 추가' }))
    fireEvent.change(screen.getByLabelText('과목 이름'), { target: { value: '화학' } })
    fireEvent.click(screen.getByRole('button', { name: '과목 추가' }))

    resolveFirst?.({ id: 'physics', name: '물리학', color: '#477B53' })
    resolveSecond?.({ id: 'chemistry', name: '화학', color: '#477B53' })

    expect(await screen.findByRole('option', { name: '물리학' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '화학' })).toBeInTheDocument()
  })

  it('starts, pauses, resumes, and saves only focused seconds', async () => {
    let clock = 1_792_900_800_000
    let monotonicClock = 1_000
    vi.spyOn(Date, 'now').mockImplementation(() => clock)
    vi.spyOn(performance, 'now').mockImplementation(() => monotonicClock)
    render(<App />)

    await screen.findByRole('heading', { name: '좋은 오후예요, 오늘도 자라나요' })
    fireEvent.click(screen.getByRole('button', { name: '집중 시작' }))
    clock += 60_000
    monotonicClock += 60_000
    fireEvent.click(screen.getByRole('button', { name: '일시정지' }))
    clock += 180_000
    monotonicClock += 180_000
    fireEvent.click(screen.getByRole('button', { name: '다시 시작' }))
    clock += 60_000
    monotonicClock += 60_000
    fireEvent.click(screen.getByRole('button', { name: '세션 저장' }))

    await waitFor(() => expect(saveSession).toHaveBeenCalledTimes(1))
    expect(vi.mocked(saveSession).mock.calls[0][0]).toMatchObject({
      subjectId: 'math',
      focusSeconds: 120,
      completed: true,
      mode: 'free',
    })
  })

  it('shows the recovery prompt when an active timer was saved locally', async () => {
    const snapshot = {
      subjectId: 'math',
      startedAt: Date.now() - 60_000,
      sessionStartedAt: Date.now() - 60_000,
      accumulatedSeconds: 0,
      pausedAt: null,
    }
    localStorage.setItem('study-garden.active-timer', JSON.stringify(snapshot))
    render(<App />)

    expect(
      await screen.findByRole('dialog', { name: '진행 중인 타이머 복구' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '이어서 하기' })).toBeInTheDocument()
  })

  it('saves monotonic focus time and valid timestamps after the wall clock moves backward', async () => {
    let wallClock = 10_000
    let monotonicClock = 500
    vi.spyOn(Date, 'now').mockImplementation(() => wallClock)
    vi.spyOn(performance, 'now').mockImplementation(() => monotonicClock)
    render(<App />)

    await screen.findByRole('heading', { name: '좋은 오후예요, 오늘도 자라나요' })
    fireEvent.click(screen.getByRole('button', { name: '집중 시작' }))
    monotonicClock += 60_000
    wallClock = 2_000
    fireEvent.click(screen.getByRole('button', { name: '세션 저장' }))

    await waitFor(() => expect(saveSession).toHaveBeenCalledTimes(1))
    const session = vi.mocked(saveSession).mock.calls[0][0]
    expect(session.focusSeconds).toBe(60)
    expect(session.endedAt).toBeGreaterThanOrEqual(session.startedAt)
  })

  it('reuses the same session ID when a save is retried after an ambiguous error', async () => {
    vi.mocked(saveSession)
      .mockRejectedValueOnce(new Error('temporary network error'))
      .mockResolvedValueOnce()
    render(<App />)

    await screen.findByRole('heading', { name: '좋은 오후예요, 오늘도 자라나요' })
    fireEvent.click(screen.getByRole('button', { name: '집중 시작' }))
    fireEvent.click(screen.getByRole('button', { name: '세션 저장' }))
    await waitFor(() => expect(saveSession).toHaveBeenCalledTimes(1))
    fireEvent.click(await screen.findByRole('button', { name: '세션 저장' }))
    await waitFor(() => expect(saveSession).toHaveBeenCalledTimes(2))

    const firstId = vi.mocked(saveSession).mock.calls[0][0].id
    const secondId = vi.mocked(saveSession).mock.calls[1][0].id
    expect(firstId).toBeTruthy()
    expect(secondId).toBe(firstId)
  })
})
