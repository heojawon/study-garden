import { describe, expect, it } from 'vitest'
import {
  elapsedSeconds,
  pauseTimer,
  recoverTimer,
  resumeTimer,
  startTimer,
  type ActiveTimer,
} from './timer'

describe('free timer time accounting', () => {
  it('calculates elapsed seconds from timestamps instead of tick counts', () => {
    const timer = startTimer('math', 1_000)

    expect(elapsedSeconds(timer, 91_999)).toBe(90)
    expect(elapsedSeconds(timer, 1_000)).toBe(0)
  })

  it('excludes time spent paused, including repeated pause and resume cycles', () => {
    const running = startTimer('math', 10_000)
    const paused = pauseTimer(running, 40_000)
    const resumed = resumeTimer(paused, 70_000)

    expect(elapsedSeconds(paused, 80_000)).toBe(30)
    expect(elapsedSeconds(resumed, 80_000)).toBe(40)
  })

  it('recovers a running timer using its persisted timestamp', () => {
    const snapshot: ActiveTimer = {
      subjectId: 'biology',
      startedAt: 1_700_000_000_000,
      accumulatedSeconds: 125,
      pausedAt: null,
    }

    const recovered = recoverTimer(snapshot, 1_700_000_060_000)

    expect(recovered).toMatchObject(snapshot)
    expect(recovered?.sessionId).toBeTruthy()
    expect(elapsedSeconds(recovered!, 1_700_000_060_000)).toBe(185)
  })

  it('keeps a recovered paused timer frozen until explicitly resumed', () => {
    const snapshot: ActiveTimer = {
      subjectId: 'biology',
      startedAt: 5_000,
      accumulatedSeconds: 12,
      pausedAt: 8_000,
    }

    const recovered = recoverTimer(snapshot, 90_000)

    expect(recovered).not.toBeNull()
    expect(elapsedSeconds(recovered!, 200_000)).toBe(15)
  })

  it('rejects invalid timestamps and missing subjects during recovery', () => {
    expect(
      recoverTimer(
        {
          subjectId: '',
          startedAt: Number.NaN,
          accumulatedSeconds: -1,
          pausedAt: null,
        },
        10,
      ),
    ).toBeNull()
  })

  it('does not report negative time when the device clock moves backward', () => {
    expect(elapsedSeconds(startTimer('math', 10_000), 2_000)).toBe(0)
  })

  it('keeps elapsed time accurate when the wall clock moves backward', () => {
    const timer = startTimer('math', 10_000, 500, 1_000)

    expect(elapsedSeconds(timer, 2_000, 6_500, 1_000)).toBe(6)
  })

  it('uses monotonic time across pause and resume cycles', () => {
    const running = startTimer('math', 10_000, 500, 1_000)
    const paused = pauseTimer(running, 20_000, 10_500, 1_000)
    const resumed = resumeTimer(paused, 2_000, 30_000, 1_000)

    expect(elapsedSeconds(paused, 100_000, 50_000, 1_000)).toBe(10)
    expect(elapsedSeconds(resumed, 3_000, 35_000, 1_000)).toBe(15)
  })

  it('re-establishes a monotonic baseline when recovering after a page reload', () => {
    const snapshot = startTimer('math', 10_000, 500, 1_000)
    const recovered = recoverTimer(snapshot, 15_000, 100, 2_000)

    expect(recovered).toMatchObject({
      startedAt: 15_000,
      accumulatedSeconds: 5,
      startedMonotonicAt: 100,
      monotonicOrigin: 2_000,
    })
    expect(elapsedSeconds(recovered!, 16_000, 1_100, 2_000)).toBe(6)
    expect(elapsedSeconds(recovered!, 2_000, 1_100, 2_000)).toBe(6)
  })

  it('rejects recovered timers with an invalid session start timestamp', () => {
    const timer = { ...startTimer('math', 10_000), sessionStartedAt: Number.NaN }

    expect(recoverTimer(timer, 20_000)).toBeNull()
  })
})
