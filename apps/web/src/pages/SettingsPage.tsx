import { useCallback, useEffect, useState } from 'react'
import {
  Volume2,
  FileText,
  VolumeX,
  Mic,
  Check,
  Loader2,
  FolderOpen,
  Cpu,
  Database,
  Info,
  RotateCcw,
  Download,
  Copy,
  Trash2,
  AlertTriangle,
  ChevronDown,
} from 'lucide-react'
import { api, mossApi, diagnosticsApi, type DiagnosticsInfo, type LogFileInfo } from '../lib/api'
import { WelcomeEntry, WelcomeModal } from '../components/WelcomeModal'
import {
  loadRadialConfig,
  saveRadialConfig,
  RADIAL_DEFAULT,
  type RadialConfig,
  type MarkColor,
  COLOR_META,
} from '../components/RadialMark'
import { PromptSettings } from '../components/PromptSettings'
import { downloadText } from '../lib/download'
import {
  asrSupported,
  loadVoiceSettings,
  saveVoiceSettings,
  setMossVoice as setMossVoiceGlobal,
  type VoiceSettings,
} from '../lib/voice'

type Tab = 'model' | 'voice' | 'prompts' | 'data' | 'about'

const TABS: { k: Tab; label: string; icon: typeof Cpu }[] = [
  { k: 'model', label: '模型', icon: Cpu },
  { k: 'voice', label: '语音', icon: Volume2 },
  { k: 'prompts', label: '提示词', icon: FileText },
  { k: 'data', label: '数据', icon: Database },
  { k: 'about', label: '关于', icon: Info },
]

export function SettingsPage() {
  const [tab, setTab] = useState<Tab>('model')

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 shrink-0 items-center gap-1 border-b border-line px-5">
        <span className="mr-3 text-sm font-medium text-ink">设置</span>
        {TABS.map(({ k, label, icon: Icon }) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs transition-colors ${
              tab === k ? 'bg-surface-3 text-ink' : 'text-ink-mute hover:text-ink-dim'
            }`}
          >
            <Icon size={13} />
            {label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[72ch] px-6 py-5">
          {tab === 'model' && <ModelSettings />}
          {tab === 'voice' && <VoiceSettingsPanel />}
        {tab === 'prompts' && <PromptSettings />}
          {tab === 'data' && <DataSettings />}
          {tab === 'about' && <AboutPanel />}
        </div>
      </div>
    </div>
  )
}

/* ───────────────────────── 模型 ───────────────────────── */

function ModelSettings() {
  const [radial, setRadial] = useState<RadialConfig>(loadRadialConfig())
  const [cfg, setCfg] = useState<{
    provider: string
    baseUrl: string
    model: string
    apiKey: string
    hasKey: boolean
    keyHint: string
    temperature: number
  } | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const load = useCallback(async () => {
    const c = await api.llmConfig()
    setCfg({ ...c, apiKey: '' })
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const save = async () => {
    if (!cfg) return
    // 填了 key 就先看看长得对不对 —— 少一位都会 401，报错信息又不说是长度问题
    if (cfg.apiKey && cfg.apiKey.trim()) {
      const k = cfg.apiKey.trim()
      if (k.length < 20) {
        setMsg({ ok: false, text: `这个 Key 只有 ${k.length} 位，太短了。DeepSeek 的是 sk- 开头、共 35 位，检查一下是不是没复制全。` })
        return
      }
      if (!/^[A-Za-z0-9_-]+$/.test(k)) {
        setMsg({ ok: false, text: '这个 Key 里有空格或换行。重新复制一次，粘贴前别带多余字符。' })
        return
      }
    }
    setBusy(true)
    setMsg(null)
    try {
      await api.patchLlm({
        provider: cfg.provider,
        baseUrl: cfg.baseUrl,
        model: cfg.model,
        apiKey: cfg.apiKey || undefined,
        temperature: cfg.temperature,
      })
      await load()
      setMsg({ ok: true, text: '已保存' })
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : '保存失败' })
    } finally {
      setBusy(false)
    }
  }

  const test = async () => {
    setBusy(true)
    setMsg(null)
    try {
      const r = await api.testLlm()
      setMsg({
        ok: r.ok,
        text: r.ok ? `通了（${r.ms}ms）· 模型回了「${r.reply}」` : (r.error ?? '不通'),
      })
    } finally {
      setBusy(false)
    }
  }

  if (!cfg) return <div className="text-sm text-ink-mute">读取配置…</div>

  return (
    <div className="space-y-5">
      
      <Section
        title="划词标记"
        hint="选中文字后长按鼠标键，滑到某个颜色松开就给这段文字打上那个颜色"
      >
        <div className="space-y-3">
          <div>
            <div className="mb-1.5 text-2xs text-ink-mute">用哪个键长按</div>
            <div className="flex flex-wrap gap-1.5">
              {[
                { v: 1, label: '中键（滚轮按下）' },
                { v: 2, label: '右键' },
                { v: 3, label: '侧键后' },
                { v: 4, label: '侧键前' },
                { v: 0, label: '关掉' },
              ].map((o) => (
                <button
                  key={o.v}
                  onClick={() => {
                    const next = { ...radial, button: o.v }
                    setRadial(next)
                    saveRadialConfig(next)
                  }}
                  className={`rounded-md border px-2.5 py-1 text-2xs transition-colors ${
                    radial.button === o.v
                      ? 'border-accent/50 bg-accent-soft text-accent'
                      : 'border-line text-ink-mute hover:text-ink'
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[10px] leading-relaxed text-ink-mute">
              很多无线鼠标没有真中键，按下去只是滚轮，那就换成右键。
            </p>
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between text-2xs">
              <span className="text-ink-mute">长按多久弹出来</span>
              <span className="tabular-nums text-ink-dim">{radial.holdMs} ms</span>
            </div>
            <input
              type="range"
              min={150}
              max={900}
              step={10}
              value={radial.holdMs}
              onChange={(e) => {
                const next = { ...radial, holdMs: Number(e.target.value) }
                setRadial(next)
                saveRadialConfig(next)
              }}
              className="w-full accent-[var(--color-accent)]"
            />
          </div>

          <div>
            <div className="mb-1.5 text-2xs text-ink-mute">圆盘上放几个颜色（至少两个）</div>
            <div className="flex gap-1.5">
              {(['yellow', 'white', 'blue'] as MarkColor[]).map((c) => {
                const on = radial.colors.includes(c)
                return (
                  <button
                    key={c}
                    onClick={() => {
                      const next = on
                        ? radial.colors.filter((x) => x !== c)
                        : [...radial.colors, c]
                      if (next.length < 2) return
                      const conf = { ...radial, colors: next }
                      setRadial(conf)
                      saveRadialConfig(conf)
                    }}
                    className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-2xs transition-colors ${
                      on ? 'border-accent/50 bg-accent-soft text-ink' : 'border-line text-ink-mute'
                    }`}
                  >
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ background: COLOR_META[c].hex }}
                    />
                    {COLOR_META[c].label}
                  </button>
                )
              })}
            </div>
          </div>

          <button
            onClick={() => {
              setRadial(RADIAL_DEFAULT)
              saveRadialConfig(RADIAL_DEFAULT)
            }}
            className="rounded-md border border-line px-2.5 py-1 text-[10px] text-ink-mute hover:text-ink"
          >
            恢复默认
          </button>
        </div>
      </Section>

<Section title="接口地址" hint="任何 OpenAI 兼容的端点都行：DeepSeek / 火山方舟 / 本地 vLLM / one-api">
        <input
          value={cfg.baseUrl}
          onChange={(e) => setCfg({ ...cfg, baseUrl: e.target.value })}
          placeholder="https://api.deepseek.com"
          className={inputCls}
        />
        <div className="mt-2 flex flex-wrap gap-1.5">
          {[
            { name: 'DeepSeek', url: 'https://api.deepseek.com', model: 'deepseek-chat' },
            { name: '火山方舟', url: 'https://ark.cn-beijing.volces.com/api/v3', model: 'doubao-pro-32k' },
            { name: '本地 Ollama', url: 'http://127.0.0.1:11434/v1', model: 'qwen2.5:7b' },
          ].map((p) => (
            <button
              key={p.name}
              onClick={() => setCfg({ ...cfg, baseUrl: p.url, model: p.model })}
              className="rounded-sm bg-surface-3 px-2 py-1 text-2xs text-ink-dim hover:text-ink"
            >
              {p.name}
            </button>
          ))}
        </div>
      </Section>

      <Section title="模型名" hint="按接口商的写法填">
        <input
          value={cfg.model}
          onChange={(e) => setCfg({ ...cfg, model: e.target.value })}
          placeholder="deepseek-chat"
          className={inputCls}
        />
      </Section>

      <Section
        title="API Key"
        hint={
          <>
            存在本机数据库；也支持环境变量 <code className="text-accent">DEEPSEEK_API_KEY</code> /{' '}
            <code className="text-accent">ALP_LLM_KEY</code>
          </>
        }
      >
        <div className="flex gap-2">
          <input
            type="password"
            value={cfg.apiKey}
            onChange={(e) => setCfg({ ...cfg, apiKey: e.target.value })}
            placeholder={cfg.hasKey ? `已保存（${cfg.keyHint}），留空则不修改` : 'sk-…'}
            className={inputCls}
          />
        </div>
      </Section>

      <Section title="温度" hint="越低越稳，越高越发散。教学建议 0.5–0.7">
        <input
          type="range"
          min={0}
          max={1.2}
          step={0.05}
          value={cfg.temperature}
          onChange={(e) => setCfg({ ...cfg, temperature: Number(e.target.value) })}
          className="w-full accent-[var(--color-accent)]"
        />
        <span className="text-2xs tabular-nums text-ink-mute">{cfg.temperature.toFixed(2)}</span>
      </Section>

      <div className="flex items-center gap-2">
        <button
          onClick={save}
          disabled={busy}
          className="flex h-9 items-center gap-1.5 rounded-md bg-accent px-4 text-sm font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-40"
        >
          {busy && <Loader2 size={13} className="animate-spin" />}
          保存
        </button>
        <button
          onClick={test}
          disabled={busy}
          className="h-9 rounded-md border border-line bg-surface px-4 text-sm text-ink-dim hover:bg-surface-2 hover:text-ink disabled:opacity-40"
        >
          测试连接
        </button>
      </div>

      {msg && (
        <div
          className={`rounded-md border px-3 py-2 text-xs ${
            msg.ok
              ? 'border-ok/40 bg-ok/10 text-ok'
              : 'border-danger/40 bg-danger/10 text-danger'
          }`}
        >
          {msg.text}
        </div>
      )}
    </div>
  )
}

/* ───────────────────────── 语音 ───────────────────────── */

function VoiceSettingsPanel() {
  const [v, setV] = useState<VoiceSettings>(loadVoiceSettings())
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [micId, setMicId] = useState(localStorage.getItem('alp.micId') ?? '')
  const [spkId, setSpkId] = useState(localStorage.getItem('alp.speakerId') ?? '')
  const [camId, setCamId] = useState(localStorage.getItem('alp.camId') ?? '')
  const [permMsg, setPermMsg] = useState('')
  const [mossVoices, setMossVoices] = useState<{ id: string; name: string }[]>([])
  const [mossVoice, setMossVoice] = useState('')
  const [, setNote] = useState('')

  const refreshDevices = useCallback(async () => {
    try {
      const list = await navigator.mediaDevices.enumerateDevices()
      setDevices(list)
    } catch {
      setDevices([])
    }
  }, [])

  useEffect(() => {
    void (async () => {
      try {
        const r = await mossApi.voices()
        setMossVoices(r.voices)
        const st = await mossApi.status()
        setMossVoice(st.voiceId ?? '')
        if (st.voiceId) setMossVoiceGlobal(st.voiceId)
      } catch {
        /* ignore */
      }
    })()
    void refreshDevices()
    navigator.mediaDevices?.addEventListener?.('devicechange', refreshDevices)
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', refreshDevices)
  }, [refreshDevices])

  const update = (patch: Partial<VoiceSettings>) => {
    const next = { ...v, ...patch }
    setV(next)
    saveVoiceSettings(next)
  }

  return (
    <div className="space-y-5">
      <Toggle
        icon={Volume2}
        title="朗读讲解"
        desc={
          true
            ? '把每段讲解读出来。中文音色取决于系统（Win11 自带 Huihui / Xiaoxiao）'
            : '当前环境不支持语音合成'
        }
        checked={v.ttsEnabled}
        disabled={!true}
        onChange={(b) => update({ ttsEnabled: b })}
      />

      <Toggle
        icon={Mic}
        title="语音输入"
        desc={
          asrSupported()
            ? '按住麦克风说话转文字。注意：浏览器语音识别走在线服务，断网不可用'
            : '当前浏览器不支持语音识别（Edge/Chrome 可用）'
        }
        checked={v.asrEnabled}
        disabled={!asrSupported()}
        onChange={(b) => update({ asrEnabled: b })}
      />

      

      <div className="rounded-lg border border-line bg-surface p-3">
        <div className="mb-2 flex items-center gap-1.5">
          <Volume2 size={12} className="text-accent" />
          <span className="text-xs font-medium text-ink">MOSS 语音</span>
          <span className="text-2xs text-ink-mute">朗读讲解用的音色（按字符计费）</span>
        </div>

        <div className="flex items-center gap-2">
          <span className="w-10 shrink-0 text-2xs text-ink-mute">音色</span>
          <select
            value={mossVoice}
            onChange={async (e) => {
              const id = e.target.value
              setMossVoice(id)
              setMossVoiceGlobal(id)
              await mossApi.config({ voiceId: id })
              setNote('音色已保存')
              setTimeout(() => setNote(''), 2000)
            }}
            className="min-w-0 flex-1 rounded-md border border-line bg-surface-2 px-2 py-1.5 text-2xs text-ink focus:outline-none"
          >
            <option value="">（未选：不朗读）</option>
            {mossVoices.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
          <button
            onClick={async () => {
              setNote('拉取音色列表…')
              const r = await mossApi.voices()
              setMossVoices(r.voices)
              setNote(r.ok ? `拿到 ${r.voices.length} 个音色` : (r.error ?? '失败'))
              setTimeout(() => setNote(''), 3500)
            }}
            className="shrink-0 rounded-sm bg-surface-3 px-2 py-1 text-2xs text-ink-dim hover:text-ink"
          >
            刷新
          </button>
        </div>

        <p className="mt-2 text-[10px] leading-relaxed text-ink-mute">
          朗读只走 MOSS。没配置或余额不足就不出声，不会退回到任何其它声音。
        </p>
      </div>

      <div className="rounded-lg border border-line bg-surface p-3">
        <div className="mb-2 flex items-center gap-1.5">
          <Mic size={12} className="text-ink-mute" />
          <span className="text-xs font-medium text-ink">设备</span>
          <span className="text-2xs text-ink-mute">麦克风 / 扬声器 / 摄像头</span>
          <button
            onClick={async () => {
              try {
                await navigator.mediaDevices.getUserMedia({ audio: true, video: true })
                setPermMsg('权限已授予，设备列表已刷新')
                await refreshDevices()
              } catch (e) {
                setPermMsg(`授权失败：${e instanceof Error ? e.message : '浏览器拒绝'}`)
              }
              setTimeout(() => setPermMsg(''), 4000)
            }}
            className="ml-auto rounded-sm bg-surface-3 px-2 py-1 text-2xs text-ink-dim hover:text-ink"
          >
            请求权限
          </button>
        </div>

        {permMsg && <p className="mb-2 text-2xs text-accent">{permMsg}</p>}

        <div className="space-y-2">
          <DeviceRow
            label="麦克风"
            devices={devices.filter((d) => d.kind === 'audioinput')}
            value={micId}
            onChange={(id) => {
              setMicId(id)
              localStorage.setItem('alp.micId', id)
            }}
          />
          <DeviceRow
            label="扬声器"
            devices={devices.filter((d) => d.kind === 'audiooutput')}
            value={spkId}
            onChange={(id) => {
              setSpkId(id)
              localStorage.setItem('alp.speakerId', id)
            }}
          />
          <DeviceRow
            label="摄像头"
            devices={devices.filter((d) => d.kind === 'videoinput')}
            value={camId}
            onChange={(id) => {
              setCamId(id)
              localStorage.setItem('alp.camId', id)
            }}
          />
        </div>
        <p className="mt-2 text-[10px] leading-relaxed text-ink-mute">
          设备名字要授权后才显示（浏览器的规矩）。自习模式开语音对话时按这里的设置选用。
        </p>
      </div>

      <Section title="语速" hint={`${v.rate.toFixed(2)}×`}>
        <input
          type="range"
          min={0.6}
          max={1.6}
          step={0.05}
          value={v.rate}
          onChange={(e) => update({ rate: Number(e.target.value) })}
          className="w-full accent-[var(--color-accent)]"
        />
      </Section>

      <div className="rounded-md border border-line bg-surface-2 px-3 py-2.5">
        <p className="text-2xs leading-relaxed text-ink-mute">
          想换成完全离线的语音（sherpa-onnx），在 `TASKS.md` 里有单独的后续项：
          朗读统一走 MOSS 云端合成。识别用浏览器自带，不联网也不花钱。
        </p>
      </div>
    </div>
  )
}

/* ───────────────────────── 数据 ───────────────────────── */

function DataSettings() {
  const [info, setInfo] = useState<{
    version: string
    node: string
    platform: string
    paths: { home: string; db: string; uploads: string; models: string }
  } | null>(null)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    void api.info().then(setInfo)
  }, [])

  return (
    <div className="space-y-5">
      <Section title="数据目录" hint="所有课程、资料、向量、教学记录都在这里；可以整体拷走备份">
        <div className="space-y-1.5">
          <PathRow label="根目录" value={info?.paths.home ?? '…'} />
          <PathRow label="数据库" value={info?.paths.db ?? '…'} />
          <PathRow label="导入的文件" value={info?.paths.uploads ?? '…'} />
          <PathRow label="模型缓存" value={info?.paths.models ?? '…'} />
        </div>
      </Section>

      <Section title="记忆库维护">
        <div className="flex flex-wrap gap-2">
          <button
            onClick={async () => {
              setMsg('正在预热…')
              const r = await api.warmupEmbedding()
              setMsg(r.ok ? `预热完成：${r.model}（${r.dims} 维，${r.ms}ms）` : `预热失败：${r.error}`)
            }}
            className="h-8 rounded-md border border-line bg-surface px-3 text-xs text-ink-dim hover:bg-surface-2 hover:text-ink"
          >
            预热嵌入模型
          </button>
          <button
            onClick={async () => {
              const r = await api.reindexMemory(null)
              setMsg(`已把 ${r.queued} 份资料排进重建队列`)
            }}
            className="h-8 rounded-md border border-line bg-surface px-3 text-xs text-ink-dim hover:bg-surface-2 hover:text-ink"
          >
            全库重建索引
          </button>
        </div>
        {msg && <p className="mt-2 text-2xs text-ink-mute">{msg}</p>}
      </Section>

      <Section title="导出" hint="M8 的 .alp 包会在这里">
        <p className="text-2xs leading-relaxed text-ink-mute">
          当前版本可直接拷走上表「根目录」做备份。一键导出 `.alp` 包（含课程+资料+记录，向量索引自动重建）
          在 M8 完成。
        </p>
      </Section>
    </div>
  )
}

/* ───────────────────────── 关于 ───────────────────────── */

function AboutPanel() {
  const [welcome, setWelcome] = useState(false)
  const [info, setInfo] = useState<{ version: string; node: string; platform: string } | null>(null)
  useEffect(() => {
    void api.info().then(setInfo)
  }, [])

  return (
    <div className="space-y-5">
      <WelcomeEntry onOpen={() => setWelcome(true)} />

      <div className="flex items-center gap-3">
        <div className="h-12 w-12 overflow-hidden rounded-lg border border-line-strong/60 bg-surface-2">
          <img src="/icon-256.png" alt="Teach me" className="h-full w-full object-cover" />
        </div>
        <div>
          <div className="text-base font-semibold text-ink">Teach me · 你的私人教师</div>
          <div className="text-2xs text-ink-mute">v{info?.version ?? '…'} · MIT</div>
        </div>
      </div>

      <div className="space-y-1.5 text-2xs text-ink-dim">
        <div className="flex justify-between">
          <span className="text-ink-mute">Node</span>
          <span className="font-mono">{info?.node ?? '—'}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-ink-mute">平台</span>
          <span className="font-mono">{info?.platform ?? '—'}</span>
        </div>
      </div>

      <p className="text-2xs leading-relaxed text-ink-mute">
        本地优先的 AI 图书馆：一门课就是一本书，导入你的教材，它先建记忆库，再一节一节带着你走。
        教学会记录、会调速，每次开课前先读上一次留下的速览卡。
      </p>

      <div className="flex items-center gap-2 rounded-md border border-line bg-surface-2 px-3 py-2">
        <RotateCcw size={12} className="text-ink-mute" />
        <span className="text-2xs text-ink-mute">
          第三方许可见仓库根目录 NOTICE。MinerU 未包含在本项目中。
        </span>
      </div>

      <DiagnosticsPanel />

      <WelcomeModal open={welcome} onClose={() => setWelcome(false)} />
    </div>
  )
}

/* ───────────────────────── 日志与诊断 ───────────────────────── */

function HumanBytes({ n }: { n: number }) {
  if (!Number.isFinite(n)) return <>—</>
  const units = ['B', 'KB', 'MB', 'GB']
  let v = n
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i += 1
  }
  return <>{`${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`}</>
}

/**
 * 出问题时的出口。
 *
 * 用户原话：「软件出错了就可以直接导出日志找问题」——所以这里的主按钮只有两个：
 * 生成并导出、打开日志目录。其余（复制、清空、预览）是给会看日志的人留的。
 */
function DiagnosticsPanel() {
  const [info, setInfo] = useState<DiagnosticsInfo | null>(null)
  const [logsDir, setLogsDir] = useState('')
  const [files, setFiles] = useState<LogFileInfo[]>([])
  const [busy, setBusy] = useState<'bundle' | 'copy' | 'clear' | 'refresh' | null>(null)
  const [msg, setMsg] = useState('')
  const [savedPath, setSavedPath] = useState('')
  const [preview, setPreview] = useState<{ name: string; body: string } | null>(null)
  const [openList, setOpenList] = useState(false)

  const load = useCallback(async () => {
    try {
      const r = await diagnosticsApi.info()
      setInfo(r.info)
      setLogsDir(r.logsDir)
      setFiles(r.files)
    } catch (e) {
      setMsg(e instanceof Error ? `读不到诊断信息：${e.message}` : '读不到诊断信息')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const makeBundle = async () => {
    const r = await diagnosticsApi.bundle()
    setSavedPath(r.filePath)
    return r
  }

  const exportBundle = async () => {
    setBusy('bundle')
    setMsg('')
    try {
      const r = await makeBundle()
      downloadText(r.filename, r.text)
      setMsg(`已生成 ${r.filename}（${Math.round(r.bytes / 1024)} KB），下载也开始了`)
      await load()
    } catch (e) {
      setMsg(e instanceof Error ? `生成失败：${e.message}` : '生成失败')
    } finally {
      setBusy(null)
    }
  }

  const copyBundle = async () => {
    setBusy('copy')
    setMsg('')
    try {
      const r = await makeBundle()
      await navigator.clipboard?.writeText(r.text)
      setMsg('诊断信息已复制到剪贴板，直接粘到聊天/issue 里就行')
      await load()
    } catch (e) {
      setMsg(e instanceof Error ? `复制失败：${e.message}` : '复制失败')
    } finally {
      setBusy(null)
    }
  }

  const clearLogs = async () => {
    if (!window.confirm('清空所有日志文件？正在写的当天日志会保留。清空前建议先导出一次。')) return
    setBusy('clear')
    try {
      const r = await diagnosticsApi.clear()
      setMsg(`已删除 ${r.removed} 个日志文件，释放 ${Math.round(r.freedBytes / 1024)} KB`)
      setPreview(null)
      await load()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '清空失败')
    } finally {
      setBusy(null)
    }
  }

  const errors = info?.problems.recentErrors.length ?? 0
  const failed = info?.problems.failedMaterials.length ?? 0

  return (
    <Section title="日志与诊断" hint="出问题时点这里，把生成的文件发给我">
      <div className="rounded-lg border border-line bg-surface px-3.5 py-3">
        <p className="text-2xs leading-relaxed text-ink-dim">
          会打包这些东西：版本 / 系统 / 数据库状态 / 资料与标记数量 / 模型配置（
          <span className="text-ok">Key 已脱敏</span>）/ 解析器探测 / 向量索引状态 / 最近 1500 行日志 / 前端报错。
          <br />
          不含你的教材正文、聊天内容和任何 API Key。生成的是纯文本，直接发给我或贴进 issue 都行。
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            onClick={() => void exportBundle()}
            disabled={busy !== null}
            className="flex h-9 items-center gap-1.5 rounded-md bg-accent px-4 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-50"
          >
            {busy === 'bundle' ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            生成并导出日志
          </button>
          <button
            onClick={() => void copyBundle()}
            disabled={busy !== null}
            className="flex h-9 items-center gap-1.5 rounded-md border border-line bg-surface-2 px-3 text-xs text-ink-dim transition-colors hover:bg-surface-3 hover:text-ink disabled:opacity-50"
          >
            {busy === 'copy' ? <Loader2 size={13} className="animate-spin" /> : <Copy size={13} />}
            复制诊断信息
          </button>
          <button
            onClick={() => void diagnosticsApi.openFolder().catch(() => setMsg('打不开目录，手动去吧：' + logsDir))}
            className="flex h-9 items-center gap-1.5 rounded-md border border-line bg-surface-2 px-3 text-xs text-ink-dim transition-colors hover:bg-surface-3 hover:text-ink"
          >
            <FolderOpen size={13} />
            打开日志目录
          </button>
          <button
            onClick={() => void clearLogs()}
            disabled={busy !== null}
            className="ml-auto flex h-9 items-center gap-1.5 rounded-md border border-line bg-surface px-3 text-xs text-ink-mute transition-colors hover:border-danger/40 hover:text-danger disabled:opacity-50"
          >
            <Trash2 size={12} />
            清空日志
          </button>
        </div>

        {msg && <p className="mt-2 text-2xs leading-relaxed text-ink-dim">{msg}</p>}
        {savedPath && (
          <p className="mt-1 font-mono text-[10px] break-all text-ink-mute">{savedPath}</p>
        )}

        {/* 现在的状态：有错就直接顶到眼前，不用去翻日志 */}
        <div className="mt-3 grid gap-1.5 text-2xs sm:grid-cols-2">
          <StatusRow
            tone={errors > 0 ? 'warn' : 'ok'}
            label="最近的错误 / 警告"
            value={errors > 0 ? `${errors} 条` : '干净'}
          />
          <StatusRow
            tone={failed > 0 ? 'warn' : 'ok'}
            label="解析失败的资料"
            value={failed > 0 ? `${failed} 份` : '没有'}
          />
          <StatusRow label="日志目录" value={logsDir || '…'} mono />
          <StatusRow
            label="日志文件"
            value={files.length ? `${files.length} 个 · 共 ${Math.round(files.reduce((n, f) => n + f.bytes, 0) / 1024)} KB` : '还没有'}
          />
        </div>

        {errors > 0 && info && (
          <details className="mt-2">
            <summary className="cursor-pointer text-2xs text-warn hover:underline">
              <AlertTriangle size={10} className="mr-1 inline" />
              看看是哪几条
            </summary>
            <pre className="mt-1 max-h-32 overflow-auto rounded-md border border-line bg-surface-2 px-2.5 py-2 font-mono text-[10px] leading-relaxed whitespace-pre-wrap text-ink-mute">
              {info.problems.recentErrors.join('\n')}
            </pre>
          </details>
        )}

        {failed > 0 && info && (
          <details className="mt-2">
            <summary className="cursor-pointer text-2xs text-warn hover:underline">哪几份资料解析失败了</summary>
            <ul className="mt-1 space-y-0.5 text-[10px] leading-relaxed text-ink-mute">
              {info.problems.failedMaterials.map((m) => (
                <li key={m.name}>
                  · {m.name} → {m.error}
                </li>
              ))}
            </ul>
          </details>
        )}

        {/* 日志文件列表 + 尾巴预览 */}
        <div className="mt-3">
          <button
            onClick={() => setOpenList((v) => !v)}
            className="flex items-center gap-1 text-2xs text-ink-mute transition-colors hover:text-ink"
          >
            <ChevronDown size={10} className={`transition-transform ${openList ? '' : '-rotate-90'}`} />
            日志与诊断文件（{files.length}）
          </button>
          {openList && (
            <div className="mt-1.5 max-h-52 space-y-1 overflow-y-auto">
              {files.length === 0 && (
                <p className="text-2xs text-ink-mute">还没有日志文件。日志从 v1.2 起会自动写到这里。</p>
              )}
              {files.map((f) => (
                <div
                  key={f.name}
                  className="flex items-center gap-2 rounded-md border border-line bg-surface-2/60 px-2.5 py-1.5"
                >
                  <FileText size={11} className="shrink-0 text-ink-mute" />
                  <button
                    onClick={async () => {
                      try {
                        const r = await diagnosticsApi.tail(f.name, 200)
                        setPreview({ name: f.name, body: r.body || '（空）' })
                      } catch {
                        setPreview({ name: f.name, body: '读不出来' })
                      }
                    }}
                    className="min-w-0 flex-1 truncate text-left font-mono text-[11px] text-ink-dim hover:text-accent"
                    title="点开看最后 200 行"
                  >
                    {f.name}
                  </button>
                  <span className="shrink-0 text-[10px] text-ink-mute">
                    <HumanBytes n={f.bytes} />
                  </span>
                  <span className="shrink-0 text-[10px] text-ink-mute">
                    {new Date(f.mtime).toLocaleString('zh-CN', {
                      month: 'numeric',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {preview && (
          <div className="mt-2">
            <div className="mb-1 flex items-center gap-2">
              <span className="truncate font-mono text-[11px] text-ink-dim">{preview.name}</span>
              <button
                onClick={() => setPreview(null)}
                className="ml-auto text-2xs text-ink-mute hover:text-ink"
              >
                收起
              </button>
            </div>
            <pre className="max-h-64 overflow-auto rounded-md border border-line bg-surface-2 px-2.5 py-2 font-mono text-[10px] leading-relaxed whitespace-pre-wrap text-ink-mute">
              {preview.body}
            </pre>
          </div>
        )}
      </div>
    </Section>
  )
}

function StatusRow({
  label,
  value,
  tone = 'ok',
  mono,
}: {
  label: string
  value: string
  tone?: 'ok' | 'warn'
  mono?: boolean
}) {
  return (
    <div className="flex items-baseline gap-2">
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${tone === 'warn' ? 'bg-warn' : 'bg-ok'}`} />
      <span className="shrink-0 text-ink-mute">{label}</span>
      <span
        className={`min-w-0 flex-1 truncate text-right ${mono ? 'font-mono text-[10px]' : ''} ${
          tone === 'warn' ? 'text-warn' : 'text-ink-dim'
        }`}
        title={value}
      >
        {value}
      </span>
    </div>
  )
}

/* ───────────────────────── 小组件 ───────────────────────── */

function Section({
  title,
  hint,
  children,
}: {
  title: string
  hint?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline gap-2">
        <span className="text-xs font-medium text-ink">{title}</span>
        {hint && <span className="text-2xs text-ink-mute">{hint}</span>}
      </div>
      {children}
    </div>
  )
}

function Toggle({
  icon: Icon,
  title,
  desc,
  checked,
  disabled,
  onChange,
}: {
  icon: typeof Volume2
  title: string
  desc: string
  checked: boolean
  disabled?: boolean
  onChange: (b: boolean) => void
}) {
  return (
    <button
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      className={`flex w-full items-start gap-3 rounded-lg border px-4 py-3 text-left transition-colors ${
        disabled
          ? 'cursor-not-allowed border-line bg-surface-2/40 opacity-60'
          : checked
            ? 'border-accent/50 bg-accent-soft'
            : 'border-line bg-surface-2 hover:bg-surface-3'
      }`}
    >
      <span className={`mt-0.5 ${checked ? 'text-accent' : 'text-ink-mute'}`}>
        {checked ? <Icon size={15} /> : <VolumeX size={15} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-medium text-ink">{title}</span>
        <span className="mt-0.5 block text-2xs leading-relaxed text-ink-mute">{desc}</span>
      </span>
      <span
        className={`mt-0.5 flex h-4 w-7 shrink-0 items-center rounded-full px-0.5 transition-colors ${
          checked ? 'justify-end bg-accent' : 'justify-start bg-line-strong'
        }`}
      >
        <span className="h-3 w-3 rounded-full bg-white/90" />
      </span>
    </button>
  )
}

function PathRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-line bg-surface-2 px-3 py-1.5">
      <FolderOpen size={11} className="shrink-0 text-ink-mute" />
      <span className="w-16 shrink-0 text-2xs text-ink-mute">{label}</span>
      <span className="min-w-0 flex-1 truncate font-mono text-2xs text-ink-dim" title={value}>
        {value}
      </span>
    </div>
  )
}

const inputCls =
  'w-full rounded-md border border-line bg-surface-2 px-3 py-2 text-sm text-ink placeholder:text-ink-mute focus:border-line-strong focus:outline-none'

void Check

function DeviceRow({
  label,
  devices,
  value,
  onChange,
}: {
  label: string
  devices: MediaDeviceInfo[]
  value: string
  onChange: (id: string) => void
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-14 shrink-0 text-2xs text-ink-mute">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-w-0 flex-1 rounded-md border border-line bg-surface-2 px-2 py-1.5 text-2xs text-ink focus:border-line-strong focus:outline-none"
      >
        <option value="">（默认设备）</option>
        {devices.map((d, i) => (
          <option key={d.deviceId || i} value={d.deviceId}>
            {d.label || `设备 ${i + 1}`}
          </option>
        ))}
      </select>
      <span className="w-8 shrink-0 text-right text-[10px] tabular-nums text-ink-mute">
        {devices.length}
      </span>
    </div>
  )
}