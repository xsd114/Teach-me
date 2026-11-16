import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Library, BookOpen, PlayCircle, Highlighter, Database, MessagesSquare,
  Sparkles, Terminal, Volume2, ChevronLeft, ChevronRight, X, MousePointerClick,
} from 'lucide-react'

/**
 * 第一次打开软件时的介绍。
 * 设置里也能随时打开（「关于」那一栏）。
 */

const KEY = 'alp.welcomed'

export function shouldWelcome(): boolean {
  try {
    return !localStorage.getItem(KEY)
  } catch {
    return false
  }
}

export function markWelcomed(): void {
  try {
    localStorage.setItem(KEY, '1')
  } catch {
    /* ignore */
  }
}

type Page = {
  icon: typeof Library
  title: string
  lead: string
  points: { k: string; v: string }[]
  tip?: string
}

const PAGES: Page[] = [
  {
    icon: Library,
    title: 'Teach me：一个会教你的图书馆',
    lead: '不是网盘，不是问答机器人。你丢进来一门课，它先摸清你的底子，再写一本只给你的书，然后一节一节带你读。',
    points: [
      { k: '数据在本机', v: '课、书、标记、记忆全存在你自己硬盘上，不上云' },
      { k: '两步走', v: '先建课，再上课。建课时它会问你几个问题，问完才知道该怎么写' },
      { k: '两种课', v: '「看书」是照你的水平写一本新书；「学习」是你有现成的书，它只拆章不改写' },
    ],
    tip: '右上角「添加」是唯一的入口，里面就这两个选项。',
  },
  {
    icon: BookOpen,
    title: '教材是为你写的',
    lead: '每一节都不少于三千字，从定义讲起——先给严格定义，再说为什么要它，然后一步步带你推，最后留一个变体让你自己动手。',
    points: [
      { k: '七块结构', v: '定义 → 为什么要有 → 怎么来的 → 跟着走一遍 → 你自己试 → 两个坑 → 条件不够怎么办' },
      { k: '配图', v: '每节至少一张。函数图可以拖参数，看着曲线怎么动' },
      { k: '公式排版', v: '公式居中放大，定义单独做金框，英语单词居中突出' },
    ],
    tip: '生成一本八章的书大概十分钟。不用等，进度条会走。',
  },
  {
    icon: PlayCircle,
    title: '上课是它讲、你听、随时打断',
    lead: '把教材拆成一步步的课，每讲完一步就停下来等你说。听懂了就下一步，没懂就让它再简单点。',
    points: [
      { k: '五个动作', v: '下一步 / 展开讲 / 换个例子 / 再简单点 / 没懂' },
      { k: '它会记', v: '每次课都记下你哪卡住了，下次自动往回补' },
      { k: '问答不断线', v: '上课中途问什么都可以，问完接着讲' },
    ],
  },
  {
    icon: Highlighter,
    title: '划重点：选完松开，长按右键',
    lead: '看到要紧的一句话，左键拖选，松开，然后长按右键——屏幕上会弹出一个圆盘，滑到哪个颜色松开，那句话就是哪个颜色。',
    points: [
      { k: '黄', v: '定义、关键结论' },
      { k: '白', v: '自己没想通的地方' },
      { k: '蓝', v: '待查、待补' },
      { k: '换色', v: '点一下已经标过的字，下面弹出色点，点一下就换' },
    ],
    tip: '鼠标按不出中键没关系，默认就是右键。设置里能改成侧键，也能调长按时长。',
  },
  {
    icon: Database,
    title: '你标的每一笔都会变成它的记忆',
    lead: '重点标记不只是好看。点「更多 · 纳入记忆库」，它会读完你所有标记，总结出你关注什么、哪类东西老出错，然后写进知识库——以后讲课会照着这个走。',
    points: [
      { k: '资料也会进来', v: 'PDF / Word / PPT / Markdown 导进来会被切开、向量化，随时能检索' },
      { k: '标记栏', v: '「标记」那一栏能按颜色筛，左边条目、中间原文、右边看它出自哪' },
      { k: '错题本', v: '自习时答错或说没懂，连问题带答案一起存下来' },
    ],
    tip: '删课的时候会问你：要不要连记忆库一起删。不删的话它会变成公共资料。',
  },
  {
    icon: MessagesSquare,
    title: '自习：左边第二个入口，问什么都在里面',
    lead: '左边栏的「自习」把原来的问答和自习合成了一页。先选一门科目，或者「全部科目」，然后直接问——它手上就是你的那本书，会指到具体哪一段回答你。',
    points: [
      { k: '两种范围', v: '选一门课能按 A1-3 / Q1 定位到段落；选「全部科目」就跨所有课检索，答案标来源' },
      { k: '引用一句来问', v: '在教材里选一句话，「问 AI」或「引用」，位置会跟着问题一起发过去' },
      { k: '贴图直接问', v: 'Ctrl+V 把图贴到输入框上方，看对了再发；答完能进错题本、进记忆库' },
      { k: '语音默认关着', v: '右下角点「语音」才知道怎么配 MOSS；不配也能用，只是不出声' },
    ],
    tip: '右侧抽屉右上角有「全屏」：点一下切到自习页接着聊，之前的对话记录一起带过去。',
  },
  {
    icon: Sparkles,
    title: '提示词是开放的',
    lead: '写教材、出题、讲课、答疑——每一条提示词都在设置里摊开给你看，也能改。改了之后所有人格、语气、结构都跟着变。',
    points: [
      { k: '七条提示词', v: '大纲 / 章节 / 出题 / 答疑 / 追问 / 扩写 / 拆节' },
      { k: '默认内置', v: '不改就是编译在程序里的默认值，换台电脑也一样' },
      { k: '随时还原', v: '改坏了一键恢复默认' },
    ],
    tip: '想让它讲课再啰嗦点、例子再多点，改「章节」那条就行。',
  },
  {
    icon: Terminal,
    title: '几个要知道的',
    lead: '',
    points: [
      { k: '模型', v: '设置 → 模型，填 API Key。DeepSeek / 火山方舟 / 本地 Ollama 都行，只要兼容 OpenAI 格式' },
      { k: '语音', v: '设置 → 语音，填 MOSS 的 Key 才有朗读；不填就是静音，不会用系统那种机器音' },
      { k: '全屏阅读', v: '课程右上角「全屏阅读」，左边有进度标尺，适合一次读很久' },
      { k: '数据在哪', v: '设置 → 数据，能看到数据库、上传文件、模型缓存的路径，也能一键备份' },
      { k: '崩了怎么办', v: '设置 → 关于 → 生成并导出日志，把那份 txt 发我就行（不含你的教材和 Key）' },
    ],
    tip: '第一次用完，这个介绍还能在「设置 → 关于」里随时打开。',
  },
]

export function WelcomeModal({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const [i, setI] = useState(0)
  const p = PAGES[i]
  const last = i === PAGES.length - 1
  const Icon = p.icon

  const close = () => {
    markWelcomed()
    onClose()
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm"
        >
          <motion.div
            initial={{ scale: 0.96, y: 12 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.97, y: 8 }}
            transition={{ duration: 0.22 }}
            className="flex max-h-[86vh] w-full max-w-[620px] flex-col overflow-hidden rounded-2xl border border-line-strong bg-surface shadow-[0_30px_80px_-20px_rgba(0,0,0,0.9)]"
          >
            {/* 顶部 */}
            <div className="flex shrink-0 items-center gap-2 border-b border-line px-6 py-4">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-soft">
                <Icon size={15} className="text-accent" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-semibold text-ink">{p.title}</div>
                <div className="text-[10px] text-ink-mute">
                  第 {i + 1} / {PAGES.length} 页
                </div>
              </div>
              <button
                onClick={close}
                className="rounded p-1.5 text-ink-mute transition-colors hover:bg-surface-2 hover:text-ink"
                title={last ? '开始使用' : '跳过'}
              >
                <X size={15} />
              </button>
            </div>

            {/* 内容 */}
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
              <AnimatePresence mode="wait">
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: 14 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  transition={{ duration: 0.18 }}
                >
                  {p.lead && (
                    <p className="mb-4 text-[13.5px] leading-[1.85] text-ink-dim">{p.lead}</p>
                  )}

                  <div className="space-y-2.5">
                    {p.points.map((pt) => (
                      <div key={pt.k} className="flex gap-2.5">
                        <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-accent/70" />
                        <div className="min-w-0">
                          <span className="text-[13px] font-medium text-ink">{pt.k}</span>
                          <span className="ml-1.5 text-[13px] leading-[1.8] text-ink-dim">{pt.v}</span>
                        </div>
                      </div>
                    ))}
                  </div>

                  {p.tip && (
                    <div className="mt-4 flex items-start gap-2 rounded-lg border border-accent/25 bg-accent-soft/40 px-3 py-2">
                      <MousePointerClick size={12} className="mt-0.5 shrink-0 text-accent" />
                      <p className="text-[11.5px] leading-relaxed text-ink-dim">{p.tip}</p>
                    </div>
                  )}
                </motion.div>
              </AnimatePresence>
            </div>

            {/* 底部 */}
            <div className="flex shrink-0 items-center gap-2 border-t border-line px-6 py-3.5">
              {/* 进度点 */}
              <div className="flex items-center gap-1">
                {PAGES.map((_, k) => (
                  <button
                    key={k}
                    onClick={() => setI(k)}
                    className={`h-1.5 rounded-full transition-all ${
                      k === i ? 'w-5 bg-accent' : 'w-1.5 bg-line-strong hover:bg-ink-mute'
                    }`}
                  />
                ))}
              </div>

              <div className="ml-auto flex items-center gap-1.5">
                <button
                  onClick={() => setI((v) => Math.max(0, v - 1))}
                  disabled={i === 0}
                  className="flex h-8 items-center gap-1 rounded-md border border-line px-2.5 text-xs text-ink-dim transition-colors hover:text-ink disabled:opacity-30"
                >
                  <ChevronLeft size={12} />
                  上一页
                </button>
                {last ? (
                  <button
                    onClick={close}
                    className="flex h-8 items-center gap-1.5 rounded-md bg-accent px-4 text-xs font-medium text-accent-fg hover:brightness-110"
                  >
                    开始使用
                  </button>
                ) : (
                  <button
                    onClick={() => setI((v) => Math.min(PAGES.length - 1, v + 1))}
                    className="flex h-8 items-center gap-1.5 rounded-md bg-accent px-3.5 text-xs font-medium text-accent-fg hover:brightness-110"
                  >
                    下一页
                    <ChevronRight size={12} />
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** 设置页里那一行「再看一遍」 */
export function WelcomeEntry({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className="flex w-full items-center gap-2.5 rounded-lg border border-line bg-surface-2 px-3.5 py-3 text-left transition-colors hover:border-accent/40 hover:bg-accent-soft/30"
    >
      <Volume2 size={15} className="text-accent" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm text-ink">功能介绍</span>
        <span className="mt-0.5 block text-2xs text-ink-mute">
          八页，把每个功能都过一遍。随时能再看
        </span>
      </span>
      <ChevronRight size={13} className="text-ink-mute" />
    </button>
  )
}
