export type CourseKind = 'skill' | 'academic'
export type MemoryMode = 'auto' | 'on' | 'off'
export type CourseStatus = 'active' | 'archived'

export type CourseStats = {
  lessonTotal: number
  lessonDone: number
  mastery: number
  lastStudiedAt: string | null
}

export type Course = {
  id: string
  title: string
  kind: CourseKind
  goal: string
  baseline: string
  cover: string
  perDayMinutes: number
  perDayItems: number
  deadline: string | null
  memoryMode: MemoryMode
  verbosity: number
  status: CourseStatus
  sortIndex: number
  createdAt: string
  updatedAt: string
  stats: CourseStats
}

export type CourseOptions = {
  mode?: 'course' | 'book'
  searchMore?: boolean
  withKeywords?: boolean
}

export type CreateCourseInput = {
  options?: CourseOptions
  title: string
  kind: CourseKind
  goal?: string
  baseline?: string
  cover?: string
  perDayMinutes?: number
  perDayItems?: number
  deadline?: string | null
  memoryMode?: MemoryMode
  verbosity?: number
}

export type LessonState = 'todo' | 'doing' | 'review' | 'done'

export type Material = {
  id: string
  courseId: string | null
  name: string
  kind: string
  origin: 'local' | 'web' | 'generated'
  sourceUrl: string | null
  filePath: string | null
  byteSize: number
  charCount: number
  parser: string | null
  degraded: boolean
  inMemory: boolean
  status: 'pending' | 'parsed' | 'indexed' | 'failed' | 'excluded'
  stage: string
  progress: number
  chunkCount: number
  error: string | null
  createdAt: string
  updatedAt: string
}

export type SearchHit = {
  chunkId: number
  materialId: string
  materialName: string
  courseId: string | null
  headingPath: string
  text: string
  score: number
  via: 'vector' | 'fulltext' | 'both'
  distance?: number
}

export type Lesson = {
  id: string
  courseId: string
  orderIndex: number
  title: string
  summary: string
  state: LessonState
  mastery: number
  createdAt: string
  updatedAt: string
}
