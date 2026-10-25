export interface Subject {
  id: string
  name: string
  color: string
}

export interface StudySession {
  id?: string
  subjectId: string
  startedAt: number
  endedAt: number
  focusSeconds: number
  mode: 'free'
  completed: boolean
}
