# Study Garden first-slice TDD evidence

## User journeys

- A learner can keep studying with browser storage and later migrate subjects and sessions to Firebase without losing local data or overwriting cloud records.
- A learner's timer keeps accurate focus time across pause/resume, wall-clock changes, and page reloads.
- A learner can retry a session save without creating duplicate records.
- Invalid local data remains untouched and produces a visible diagnostic instead of being silently replaced.

## RED/GREEN evidence

| Guarantee | Test target | RED evidence | GREEN evidence |
|---|---|---|---|
| Local subjects and sessions migrate idempotently; cloud subject IDs win conflicts; failed migration retains local data | `src/services/studyService.test.ts` | The initial migration tests failed because local records were absent from Firebase-backed results and failed writes were not attempted. | Included in `npm run test:coverage`: 23 tests passed. |
| Duplicate local session IDs are repaired before migration | `src/services/studyService.test.ts` | `npm test -- src/services/studyService.test.ts -t "assigns stable distinct IDs"` returned one session instead of two. | Included in `npm run test:coverage`: 23 tests passed. |
| Local retries with a stable ID do not append duplicate sessions | `src/services/studyService.test.ts` | `npm test -- src/services/studyService.test.ts -t "upserts local sessions"` stored two copies. | Included in `npm run test:coverage`: 23 tests passed. |
| Concurrent initialization shares the same Firebase sign-in; malformed browser data is preserved and explained | `src/services/studyService.test.ts` | The reproducer observed two sign-ins and an unreported malformed local value. | Included in `npm run test:coverage`: 23 tests passed. |
| Timer time stays monotonic through clock changes and recovery; invalid session timestamps are rejected | `src/domain/timer.test.ts`, `src/App.test.tsx` | The initial clock-rollback test measured zero focus seconds instead of 60; recovery and timestamp cases also failed. | Included in `npm run test:coverage`: 23 tests passed. |
| Concurrent subject submissions preserve both results; retrying a session save reuses its ID | `src/App.test.tsx` | The initial repro lost one subject and created a session without a stable ID. | Included in `npm run test:coverage`: 23 tests passed. |
| Firestore ownership and session rules remain enforced | `src/services/firestore.rules.test.ts` | Existing negative rule cases assert rejection. | `npm run test:rules`: 3 tests passed. |

## Final validation

- `npm run test:coverage`: 23 tests passed; timer-domain coverage was 90.47% statements, 82.6% branches, 100% functions, and 100% lines.
- `npm run build`: passed. Vite reports a 1,039.53 kB JavaScript chunk warning.
- `npm run test:rules`: passed, 3 tests. On this Windows environment the Firestore Java emulator process remained after Firebase CLI shutdown and was stopped by PID after confirming its command line.
- `npm audit --omit=dev --audit-level=moderate`: 0 production vulnerabilities.
- `npm audit`: 5 moderate advisories remain in the Firebase CLI development-tool dependency tree; applying `npm audit fix --force` would downgrade the CLI and is not included.

## Known follow-ups

- Multiple tabs can still contend over the same active-timer snapshot.
- The Firestore rule caps a saved focus session at 48 hours; the UI does not yet enforce that limit.
