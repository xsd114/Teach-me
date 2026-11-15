import { CANTONESE, SICHUAN, type DemoDish } from '../demo/menu.js'
import { one, run } from '../db/index.js'
import { newId, nowIso } from '../lib/id.js'
import { createCourse, listCourses } from './course.js'

const KEY_LOADED_AT = 'demo.loadedAt'

export function demoStatus(): { loaded: boolean; loadedAt: string | null } {
  const r = one<{ value: string }>(`SELECT value FROM setting WHERE key = ?`, KEY_LOADED_AT)
  return { loaded: Boolean(r?.value), loadedAt: r?.value ?? null }
}

function addLessons(courseId: string, dishes: DemoDish[]): number {
  const ts = nowIso()
  dishes.forEach((d, i) => {
    const summary =
      `${d.focus}　·　${d.cuisine}　·　难度 ${d.difficulty}/5　·　约 ${d.timeMin} 分钟\n` +
      `成败关键：${d.keyPoints[0]}\n常见翻车：${d.pitfalls[0]}`
    run(
      `INSERT INTO lesson (id, course_id, order_index, title, summary, state, mastery, created_at, updated_at)
       VALUES (?,?,?,?,?, 'todo', 0, ?, ?)`,
      newId('lsn'),
      courseId,
      i,
      d.name,
      summary,
      ts,
      ts,
    )
  })
  return dishes.length
}

/**
 * 装载示例数据。幂等：已经装过就原样返回，不会重复创建。
 * 三处课程：粤菜 6 节、川菜 6 节、微积分 I（学业类，等 M2 填材料）
 */
export function loadDemo(force = false): { courses: number; lessons: number; skipped: boolean } {
  const st = demoStatus()
  if (st.loaded && !force) return { courses: 0, lessons: 0, skipped: true }

  let lessons = 0
  let courses = 0

  const yue = createCourse({
    title: '粤菜基础 · 火候与鲜',
    kind: 'skill',
    goal: '把「蒸、浸、灼、焯」四种粤菜基本功练到能稳定出菜',
    baseline: '会做家常菜，但火候靠感觉，出品不稳定',
    cover: '蒸',
    perDayMinutes: 45,
    perDayItems: 1,
    memoryMode: 'auto',
    verbosity: 3,
  })
  courses++
  lessons += addLessons(yue.id, CANTONESE)

  const chuan = createCourse({
    title: '川菜入门 · 麻辣与复合味',
    kind: 'skill',
    goal: '掌握麻辣、鱼香、荔枝三种复合味的配比与火候',
    baseline: '能吃辣，但不知道糖醋、豆瓣、泡椒之间怎么配',
    cover: '川',
    perDayMinutes: 40,
    perDayItems: 1,
    memoryMode: 'auto',
    verbosity: 3,
  })
  courses++
  lessons += addLessons(chuan.id, SICHUAN)

  const calc = createCourse({
    title: '微积分 I · 极限与导数',
    kind: 'academic',
    goal: '吃透极限的 ε-δ 定义，能独立完成求导与相关变化率',
    baseline: '高中函数基础，导数只背过公式',
    cover: '∫',
    perDayMinutes: 60,
    perDayItems: 8,
    memoryMode: 'on',
    verbosity: 3,
  })
  courses++
  // 课时由 M2 导入 OpenStax 第 1–2 章后自动生成，这里只放两个占位
  const ts = nowIso()
  for (const [i, t] of ['极限的直觉与定义', '导数的几何意义'].entries()) {
    run(
      `INSERT INTO lesson (id, course_id, order_index, title, summary, state, mastery, created_at, updated_at)
       VALUES (?,?,?,?,?, 'todo', 0, ?, ?)`,
      newId('lsn'),
      calc.id,
      i,
      t,
      '待导入教材后细化（M2）',
      ts,
      ts,
    )
    lessons++
  }

  run(
    `INSERT INTO setting(key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    KEY_LOADED_AT,
    nowIso(),
  )

  return { courses, lessons, skipped: false }
}

/** 清空全部示例课程（只删 title 以示例命名的课，不碰用户自己建的） */
export function clearDemo(): number {
  const titles = ['粤菜基础 · 火候与鲜', '川菜入门 · 麻辣与复合味', '微积分 I · 极限与导数']
  let n = 0
  for (const c of listCourses('all')) {
    if (titles.includes(c.title)) {
      run(`DELETE FROM course WHERE id = ?`, c.id)
      n++
    }
  }
  if (n > 0) run(`DELETE FROM setting WHERE key = ?`, KEY_LOADED_AT)
  return n
}
