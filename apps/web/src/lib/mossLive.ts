/**
 * MOSS-Live 全双工语音。
 *
 * 链路：
 *   麦克风 → AudioContext(16k) → Int16 PCM → WebSocket 二进制帧 → 本机后端 → MOSS
 *   MOSS → 48k PCM 二进制帧 → 本机后端 → 这里 → Web Audio 排队播放 → 播放回执
 *
 * 为什么要回执：MOSS 靠 playback.chunk.completed / playback.completed 判断"这段话真的被听到了"，
 * 不回它就不往下走；打断时要发 playback.stopped 并带上已播毫秒数。
 */

export type LiveHandlers = {
  onState: (s: LiveState) => void
  /** 学生说的 */
  onUserText: (text: string) => void
  /** 模型说的 */
  onAiText: (text: string) => void
  onError: (msg: string) => void
  onConnected?: () => void
  /** 一句话说完（input.transcript.done），把整句交出去 */
  onUtteranceEnd?: (text: string) => void
  /** 麦克风实时音量 0-1，给界面一个"确实在进音"的证据 */
  onLevel?: (v: number) => void
}

export type LiveState = 'connecting' | 'listening' | 'speaking' | 'idle' | 'closed'

type ChunkMeta = { runId: string; turnId: string; chunkId: string }

const IN_RATE = 16000

export class MoshLiveSession {
  private ws: WebSocket | null = null
  private micCtx: AudioContext | null = null
  private playCtx: AudioContext | null = null
  private stream: MediaStream | null = null
  private proc: ScriptProcessorNode | null = null
  private srcNode: MediaStreamAudioSourceNode | null = null

  /** 当前待播音频所属的块信息 */
  private pendingMeta: ChunkMeta | null = null
  /** 队列里还没播完的块：用于回执 */
  private queued: (ChunkMeta & { startedAt: number; durationMs: number })[]
  private stopped = false
  private attached = false
  private preCtx: AudioContext | null = null
  /** 下一块音频该从什么时候开始，排队用 */
  private nextPlayTime = 0
  private silentOutput = false
  private instructions = ''
  /** 上次连接的 URL，诊断用 */
  lastUrl = ''
  get url(): string { return this.lastUrl }
  private silentGain: GainNode | null = null
  /** 最近一次音量，诊断用 */
  lastRms = 0
  private attachTimer: number | null = null

  private handlers: LiveHandlers

  /** silent = 只借它听，不听它说（回答由我们自己合成） */
  constructor(handlers: LiveHandlers, opts: { silentOutput?: boolean } = {}) {
    this.silentOutput = Boolean(opts.silentOutput)
    this.handlers = handlers
    this.queued = []
  }

  /** preCtx 必须在 onClick 里同步创建 —— 浏览器只认用户手势 */
  async start(instructions?: string, preCtx?: AudioContext): Promise<void> {
    // 人设可能几千字，塞进 URL 会超长被网关拒（表现为连不上）
    // 改成连上之后用一条消息发过去，后端已经有 client.set_instructions 处理
    this.instructions = (instructions ?? "").slice(0, 3200)
    this.preCtx = preCtx ?? null
    this.handlers.onState('connecting')

    // 1. 先开麦（拿权限），失败就别连了
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })
    } catch (e) {
      this.handlers.onError(e instanceof Error ? `麦克风打不开：${e.message}` : '麦克风打不开')
      this.handlers.onState('closed')
      return
    }

    // 1.5 先把音频管线起起来：不等 MOSS attach。
    // 这样即使语音通道没连上，音量条也会动，能一眼看出"麦克风本身是好的"
    this.startMic()

    // 2. 连本机代理
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const url = `${proto}://${location.host}/ws/live`
    this.lastUrl = url
    const ws = new WebSocket(url)
    ws.binaryType = 'arraybuffer'
    this.ws = ws

    ws.onopen = () => {
      this.handlers.onState('listening')
    }

    // 8 秒还没 attach 上就当失败，别让界面一直转圈
    const attachTimer = window.setTimeout(() => {
      if (!this.attached) {
        this.handlers.onError('语音服务没响应（检查后端是否在跑、MOSS Key 是否配好）')
        this.handlers.onState('closed')
        ws.close()
      }
    }, 8000)
    this.attachTimer = attachTimer

    ws.onmessage = (ev) => {
      if (typeof ev.data === 'string') {
        this.handleEvent(JSON.parse(ev.data) as Record<string, unknown>)
      } else {
        this.handleAudio(ev.data as ArrayBuffer)
      }
    }

    ws.onerror = () => {
      this.handlers.onError(`连不上本机语音代理（${url}，readyState=${ws.readyState}）`)
    }

    ws.onclose = (ev: CloseEvent) => {
      if (!this.attached) {
        this.handlers.onError(`语音通道被关闭（code=${ev.code}${ev.reason ? ", " + ev.reason : ""}）`)
      }
      this.handlers.onState('closed')
      this.cleanup()
    }
  }

  /* ── 文本事件 ── */
  private handleEvent(msg: Record<string, unknown>) {
    const action = String(msg.action ?? '')
    const data = (msg.data ?? {}) as Record<string, unknown>

    switch (action) {
      case 'bridge.connected':
        break

      case 'session_attached':
        this.attached = true
        if (this.attachTimer) window.clearTimeout(this.attachTimer)
        if (this.instructions) {
          this.sendJson({ action: `client.set_instructions`, systemPrompt: this.instructions })
        }
        this.sendJson({ action: 'mic_state', enabled: true })
        this.handlers.onConnected?.()
        break

      case 'bridge.error':
        this.handlers.onError(String(data.message ?? '语音服务出错'))
        break

      case 'response.audio.started':
        this.handlers.onState('speaking')
        break

      case 'response.audio.context':
        // 下一条二进制音频属于这个块
        this.pendingMeta = {
          runId: String(data.run_id ?? ''),
          turnId: String(data.turn_id ?? ''),
          chunkId: String(data.chunk_id ?? ''),
        }
        break

      case 'response.audio.stop':
        // 被打断
        this.stopPlayback(String(data.run_id ?? ''), String(data.turn_id ?? ''), Number(data.played_audio_ms ?? 0))
        break

      case 'response.audio.done':
        break

      case 'response.interrupted':
      case 'response.ended':
        this.handlers.onState('listening')
        break

      case 'input.transcript.updated':
        this.handlers.onUserText(String(data.text ?? ""))
        break

      case 'input.transcript.done': {
        const full = String(data.text ?? "").trim()
        this.handlers.onUserText(full)
        if (full.length >= 2) this.handlers.onUtteranceEnd?.(full)
        break
      }
        this.handlers.onUserText(String(data.text ?? ''))
        break

      case 'output.transcript.updated':
      case 'output.transcript.done':
        this.handlers.onAiText(String(data.text ?? ''))
        break

      default:
        break
    }
  }

  /* ── 二进制音频（48k 单声道 S16LE）── */
  private handleAudio(buf: ArrayBuffer) {
    if (!this.playCtx) return
    const i16 = new Int16Array(buf)
    if (i16.length === 0) return

    const f32 = new Float32Array(i16.length)
    for (let i = 0; i < i16.length; i++) f32[i] = i16[i] / 0x8000

    // 用上下文自己的采样率建 buffer，避免被重采样
    const rate = this.playCtx.sampleRate
    const audioBuf = this.playCtx.createBuffer(1, f32.length, rate)
    audioBuf.copyToChannel(f32, 0)

    const meta = this.pendingMeta ?? { runId: '', turnId: '', chunkId: '' }
    this.pendingMeta = null

    const node = this.playCtx.createBufferSource()
    node.buffer = audioBuf
    if (this.silentOutput) {
      // 静音：仍然驱动播放节点（这样 onended 会照常触发、回执照发），
      // 但声音不进扬声器 —— 回答由我们自己的 TTS 念
      if (!this.silentGain) {
        this.silentGain = this.playCtx.createGain()
        this.silentGain.gain.value = 0
        this.silentGain.connect(this.playCtx.destination)
      }
      node.connect(this.silentGain)
    } else {
      node.connect(this.playCtx.destination)
    }

    const duration = audioBuf.duration
    const durationMs = duration * 1000

    // 关键：按时间轴排队。
    // 之前每块都 node.start()（不传时间＝立刻播），几十块同时发声，
    // 听起来就是"一秒内说完了"。现在下一块从上一块结束处接上。
    const now = this.playCtx.currentTime
    // 队列是空的时候多等 120ms 再开口：MOSS 的块来得不均匀，
    // 首块立刻播容易后面接不上，听起来一卡一卡的。
    const buffer = this.queued.length === 0 ? 0.12 : 0
    const startAt = Math.max(now + buffer, this.nextPlayTime)
    this.nextPlayTime = startAt + duration

    const entry = { ...meta, startedAt: startAt, durationMs }
    this.queued.push(entry)

    node.onended = () => {
      // 这块播完了 → 回执
      if (this.stopped) return
      this.sendJson({
        action: 'playback.chunk.completed',
        run_id: meta.runId,
        turn_id: meta.turnId,
        chunk_id: meta.chunkId,
      })
      this.queued = this.queued.filter((q) => q !== entry)
      if (this.queued.length === 0) {
        this.nextPlayTime = 0
        this.handlers.onState('listening')
        this.sendJson({ action: 'playback.completed', run_id: meta.runId, turn_id: meta.turnId })
      }
    }

    node.start(startAt)
  }

  /** 被打断：立刻停，回报已播时长 */
  private stopPlayback(runId: string, turnId: string, playedMs: number) {
    this.stopped = true
    try {
      this.playCtx?.suspend()
      void this.playCtx?.resume()
    } catch {
      /* ignore */
    }
    this.queued = []
    this.sendJson({
      action: 'playback.stopped',
      run_id: runId,
      turn_id: turnId,
      played_audio_ms: Math.max(0, Math.round(playedMs)),
    })
    this.stopped = false
    this.handlers.onState('listening')
  }

  /* ── 麦克风 → 16k PCM ── */
  private startMic() {
    if (!this.stream) return

    // 尽量让浏览器直接给 16k；给不了就自己重采样
    // 优先用调用方在手势里创建的那个；自己 new 的会落在 suspended 上
    let ctx: AudioContext
    try {
      ctx = new AudioContext({ sampleRate: IN_RATE })
    } catch {
      ctx = this.preCtx ?? new AudioContext()
    }
    this.micCtx = ctx
    // 浏览器要求音频上下文由用户手势唤醒；不 resume 它会一直 suspended，
    // onaudioprocess 一个字节都不出，表现就是"麦克风没进去"
    void ctx.resume().catch(() => {})

    this.srcNode = ctx.createMediaStreamSource(this.stream)
    const proc = ctx.createScriptProcessor(2048, 1, 1)
    this.proc = proc

    const ratio = ctx.sampleRate / IN_RATE

    proc.onaudioprocess = (e) => {
      const input = e.inputBuffer.getChannelData(0)

      // 采样率不对就线性插值降到 16k
      let samples: Float32Array
      if (Math.abs(ratio - 1) < 0.01) {
        samples = input
      } else {
        const outLen = Math.floor(input.length / ratio)
        samples = new Float32Array(outLen)
        for (let i = 0; i < outLen; i++) {
          const pos = i * ratio
          const i0 = Math.floor(pos)
          const i1 = Math.min(i0 + 1, input.length - 1)
          const frac = pos - i0
          samples[i] = input[i0] * (1 - frac) + input[i1] * frac
        }
      }

      // 音量先算 —— 不管 WS 通没通都要更新，否则界面看起来像"麦克风没进去"
      let sumSq = 0
      for (let i = 0; i < samples.length; i++) sumSq += samples[i] * samples[i]
      const rms = Math.sqrt(sumSq / samples.length)
      this.handlers.onLevel?.(Math.min(1, rms * 8))

      if (this.ws?.readyState !== WebSocket.OPEN) return

      const i16 = new Int16Array(samples.length)
      for (let i = 0; i < samples.length; i++) {
        const v = Math.max(-1, Math.min(1, samples[i]))
        i16[i] = v < 0 ? v * 0x8000 : v * 0x7fff
      }
      this.ws.send(i16.buffer)
    }

    this.srcNode.connect(proc)
    // 不直接接 destination（会把自己说的放出来），接一个 0 增益节点，
    // 图照样被驱动，但听不到回声
    const mute = ctx.createGain()
    mute.gain.value = 0
    proc.connect(mute)
    mute.connect(ctx.destination)

    if (!this.playCtx) {
      this.playCtx = new AudioContext()
      void this.playCtx.resume().catch(() => {})
    }
  }


  /** 诊断：把"到底哪一环没通"摊开给人看 */
  getDiag(): {
    ctxState: string
    trackState: string
    trackMuted: boolean
    trackEnabled: boolean
    label: string
    rms: number
  } {
    const track = this.stream?.getAudioTracks()[0]
    return {
      ctxState: this.micCtx?.state ?? 'none',
      trackState: track?.readyState ?? 'none',
      trackMuted: track?.muted ?? true,
      trackEnabled: track?.enabled ?? false,
      label: track?.label ?? '',
      rms: this.lastRms,
    }
  }

  /** 用户点"恢复音频"时调：必须在点击事件里跑 */
  async resumeAudio(): Promise<string> {
    try {
      if (this.micCtx) await this.micCtx.resume()
      if (this.playCtx) await this.playCtx.resume()
      return this.micCtx?.state ?? 'none'
    } catch {
      return 'error'
    }
  }
  private sendJson(obj: Record<string, unknown>) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj))
  }

  stop() {
    try {
      this.sendJson({ action: 'mic_state', enabled: false })
    } catch {
      /* ignore */
    }
    this.ws?.close()
    this.cleanup()
  }

  private cleanup() {
    try {
      this.proc?.disconnect()
      this.srcNode?.disconnect()
    } catch {
      /* ignore */
    }
    this.proc = null
    this.srcNode = null
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    void this.micCtx?.close().catch(() => {})
    void this.playCtx?.close().catch(() => {})
    this.micCtx = null
    this.playCtx = null
    this.ws = null
  }
}