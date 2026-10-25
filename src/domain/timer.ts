export interface ActiveTimer {
  subjectId: string
  sessionId?: string
  startedAt: number
  accumulatedSeconds: number
  pausedAt: number | null
  sessionStartedAt?: number
  startedMonotonicAt?: number
  pausedMonotonicAt?: number
  monotonicOrigin?: number
}

export function startTimer(
  subjectId: string,
  now: number,
  monotonicNow = now,
  monotonicOrigin?: number,
): ActiveTimer {
  return {
    subjectId,
    sessionId: crypto.randomUUID(),
    startedAt: now,
    sessionStartedAt: now,
    startedMonotonicAt: monotonicOrigin === undefined ? undefined : monotonicNow,
    accumulatedSeconds: 0,
    pausedAt: null,
    monotonicOrigin,
  }
}

export function elapsedSeconds(
  timer: ActiveTimer,
  now: number,
  monotonicNow = now,
  monotonicOrigin?: number,
): number {
  const canUseMonotonicClock =
    monotonicOrigin !== undefined &&
    timer.monotonicOrigin === monotonicOrigin &&
    Number.isFinite(timer.startedMonotonicAt)
  const monotonicEnd =
    timer.pausedAt === null ? monotonicNow : timer.pausedMonotonicAt
  const segmentSeconds =
    canUseMonotonicClock &&
    typeof monotonicEnd === 'number' &&
    typeof timer.startedMonotonicAt === 'number'
      ? Math.max(0, Math.floor((monotonicEnd - timer.startedMonotonicAt) / 1000))
      : Math.max(0, Math.floor(((timer.pausedAt ?? now) - timer.startedAt) / 1000))

  return timer.accumulatedSeconds + segmentSeconds
}

export function pauseTimer(
  timer: ActiveTimer,
  now: number,
  monotonicNow = now,
  monotonicOrigin?: number,
): ActiveTimer {
  if (timer.pausedAt !== null) return timer

  return {
    ...timer,
    accumulatedSeconds: elapsedSeconds(timer, now, monotonicNow, monotonicOrigin),
    startedAt: now,
    startedMonotonicAt:
      monotonicOrigin === undefined ? undefined : monotonicNow,
    pausedAt: now,
    pausedMonotonicAt: monotonicOrigin === undefined ? undefined : monotonicNow,
    monotonicOrigin,
  }
}

export function resumeTimer(
  timer: ActiveTimer,
  now: number,
  monotonicNow = now,
  monotonicOrigin?: number,
): ActiveTimer {
  if (timer.pausedAt === null) return timer

  return {
    ...timer,
    accumulatedSeconds: elapsedSeconds(timer, now, monotonicNow, monotonicOrigin),
    startedAt: now,
    pausedAt: null,
    startedMonotonicAt: monotonicOrigin === undefined ? undefined : monotonicNow,
    pausedMonotonicAt: undefined,
    monotonicOrigin,
  }
}

export function recoverTimer(
  snapshot: ActiveTimer,
  now: number,
  monotonicNow?: number,
  monotonicOrigin?: number,
): ActiveTimer | null {
  if (
    !snapshot ||
    typeof snapshot.subjectId !== 'string' ||
    snapshot.subjectId.trim().length === 0 ||
    (snapshot.sessionId !== undefined &&
      (typeof snapshot.sessionId !== 'string' || snapshot.sessionId.trim().length === 0)) ||
    !Number.isFinite(snapshot.startedAt) ||
    (snapshot.sessionStartedAt !== undefined &&
      !Number.isFinite(snapshot.sessionStartedAt)) ||
    !Number.isFinite(snapshot.accumulatedSeconds) ||
    snapshot.accumulatedSeconds < 0 ||
    (snapshot.pausedAt !== null && !Number.isFinite(snapshot.pausedAt)) ||
    (snapshot.startedMonotonicAt !== undefined &&
      !Number.isFinite(snapshot.startedMonotonicAt)) ||
    (snapshot.pausedMonotonicAt !== undefined &&
      !Number.isFinite(snapshot.pausedMonotonicAt)) ||
    (snapshot.monotonicOrigin !== undefined && !Number.isFinite(snapshot.monotonicOrigin))
  ) {
    return null
  }

  const sessionId = snapshot.sessionId ?? crypto.randomUUID()
  if (monotonicOrigin !== undefined && Number.isFinite(monotonicNow)) {
    const recoveredSeconds = elapsedSeconds(snapshot, now)
    const {
      pausedAt,
      ...rest
    } = snapshot
    const samePage = snapshot.monotonicOrigin === monotonicOrigin
    return {
      ...rest,
      sessionId,
      accumulatedSeconds: samePage ? snapshot.accumulatedSeconds : recoveredSeconds,
      startedAt: samePage ? snapshot.startedAt : now,
      pausedAt: pausedAt === null ? null : samePage ? pausedAt : now,
      startedMonotonicAt: samePage
        ? snapshot.startedMonotonicAt
        : monotonicNow,
      pausedMonotonicAt:
        pausedAt === null
          ? undefined
          : samePage
            ? snapshot.pausedMonotonicAt
            : monotonicNow,
      monotonicOrigin,
    }
  }

  const {
    startedMonotonicAt: _startedMonotonicAt,
    pausedMonotonicAt: _pausedMonotonicAt,
    monotonicOrigin: _previousOrigin,
    ...wallClockSnapshot
  } = snapshot
  return { ...wallClockSnapshot, sessionId }
}
