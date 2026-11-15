import { useCallback, useEffect, useState } from 'react'
import { ChevronDown, RotateCcw, Save, Loader2, AlertCircle, Check } from 'lucide-react'
import { promptApi, type PromptView } from '../lib/api'

/**
 * 提示词管理。
 *
 * 这个软件"怎么写教材、怎么出题、怎么答疑"全在这里能看见。
 * 默认值编译在程序里，别人装同一个版本，开箱效果一致；
 * 改了才存库，改坏了能一键恢复。
 */
export function PromptSettings() {
  const [items, setItems] = useState<PromptView[]>([])
  const [overridden, setOverridden] = useState(0)
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [draft, setDraft] = useState<{ system: string; body: string }>({ system: '', body: '' })
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await promptApi.list()
      setItems(r.prompts)
      setOverridden(r.stats.overridden)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const open = (p: PromptView) => {
    if (openKey === p.key) {
      setOpenKey(null)
      return
    }
    setOpenKey(p.key)
    setDraft({ system: p.system, body: p.body })
  }

  const save = async (key: string) => {
    setBusy(key)
    try {
      const r = await promptApi.save(key, draft)
      setItems(r.prompts)
      setOverridden(r.prompts.filter((x) => x.overridden).length)
      setNote('已保存，下一次生成就用新提示词')
      setTimeout(() => setNote(''), 3000)
    } finally {
      setBusy(null)
    }
  }

  const reset = async (key: string) => {
    setBusy(key)
    try {
      const r = await promptApi.reset(key)
      setItems(r.prompts)
      setOverridden(r.prompts.filter((x) => x.overridden).length)
      const back = r.prompts.find((x) => x.key === key)
      if (back) setDraft({ system: back.system, body: back.body })
      setNote('已恢复内置默认')
      setTimeout(() => setNote(''), 3000)
    } finally {
      setBusy(null)
    }
  }

  const resetAll = async () => {
    setBusy('all')
    try {
      const r = await promptApi.resetAll()
      setItems(r.prompts)
      setOverridden(0)
      setOpenKey(null)
      setNote('全部恢复默认')
      setTimeout(() => setNote(''), 3000)
    } finally {
      setBusy(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-10 text-xs text-ink-mute">
        <Loader2 size={12} className="animate-spin" />
        读取提示词…
      </div>
    )
  }

  const groups = [...new Set(items.map((i) => i.group))]

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 rounded-md border border-line bg-surface-2 px-3 py-2.5">
        <AlertCircle size={13} className="mt-0.5 shrink-0 text-ink-mute" />
        <div className="text-2xs leading-relaxed text-ink-dim">
          这 {items.length} 条提示词决定了这个软件怎么写教材、怎么出题、怎么答疑。
          <br />
          <span className="text-ink-mute">
            默认值是<b>内置</b>的（编译在程序里）——别人装同一个版本，开箱效果和这里完全一致。
            你改了才存进数据库；改坏了点「恢复默认」就回去。
          </span>
          {overridden > 0 && (
            <span className="ml-1 text-accent">当前有 {overridden} 条被改过。</span>
          )}
        </div>
        {overridden > 0 && (
          <button
            onClick={resetAll}
            disabled={busy === 'all'}
            className="ml-auto shrink-0 rounded-sm bg-surface-3 px-2 py-1 text-2xs text-ink-dim hover:text-danger"
          >
            全部恢复
          </button>
        )}
      </div>

      {note && <p className="text-2xs text-ok">{note}</p>}

      {groups.map((g) => (
        <div key={g}>
          <div className="mb-1.5 text-2xs font-medium tracking-wide text-ink-mute">{g}</div>
          <div className="space-y-1">
            {items
              .filter((i) => i.group === g)
              .map((p) => {
                const isOpen = openKey === p.key
                return (
                  <div key={p.key} className="overflow-hidden rounded-md border border-line bg-surface">
                    <button
                      onClick={() => open(p)}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-surface-2"
                    >
                      <ChevronDown
                        size={11}
                        className={`shrink-0 text-ink-mute transition-transform ${isOpen ? '' : '-rotate-90'}`}
                      />
                      <span className="text-xs text-ink">{p.name}</span>
                      {p.overridden && (
                        <span className="rounded-sm bg-accent-soft px-1 py-0.5 text-[9px] text-accent">改过</span>
                      )}
                      <span className="ml-auto shrink-0 text-[10px] text-ink-mute">
                        {p.body.length} 字
                      </span>
                    </button>

                    {isOpen && (
                      <div className="border-t border-line px-3 py-2.5">
                        <p className="mb-2 text-2xs leading-relaxed text-ink-mute">{p.desc}</p>

                        <label className="mb-1 block text-[10px] text-ink-mute">
                          人物设定（system，一般不用改）
                        </label>
                        <textarea
                          value={draft.system}
                          onChange={(e) => setDraft((d) => ({ ...d, system: e.target.value }))}
                          rows={3}
                          className="mb-2 w-full resize-y rounded border border-line bg-surface-2 px-2 py-1.5 font-mono text-[11px] leading-relaxed text-ink-dim focus:border-line-strong focus:outline-none"
                        />

                        <label className="mb-1 block text-[10px] text-ink-mute">
                          正文模板（<code className="text-accent">{'{{变量}}'}</code> 会被替换）
                        </label>
                        <textarea
                          value={draft.body}
                          onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
                          rows={12}
                          className="w-full resize-y rounded border border-line bg-surface-2 px-2 py-1.5 font-mono text-[11px] leading-relaxed text-ink-dim focus:border-line-strong focus:outline-none"
                        />

                        <div className="mt-2 flex items-center gap-1.5">
                          <button
                            onClick={() => void save(p.key)}
                            disabled={busy === p.key}
                            className="flex items-center gap-1 rounded bg-accent px-2.5 py-1 text-2xs font-medium text-accent-fg disabled:opacity-50"
                          >
                            {busy === p.key ? <Loader2 size={10} className="animate-spin" /> : <Save size={10} />}
                            保存
                          </button>
                          <button
                            onClick={() => void reset(p.key)}
                            disabled={busy === p.key || !p.overridden}
                            className="flex items-center gap-1 rounded border border-line px-2.5 py-1 text-2xs text-ink-dim hover:text-ink disabled:opacity-40"
                          >
                            <RotateCcw size={10} />
                            恢复默认
                          </button>
                          {!p.overridden && (
                            <span className="flex items-center gap-1 text-[10px] text-ink-mute">
                              <Check size={9} />
                              用的就是内置默认
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
          </div>
        </div>
      ))}
    </div>
  )
}
