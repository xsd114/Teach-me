/**
 * 语音：识别用浏览器自带（免费、本地），朗读只用 MOSS。
 *
 * 朗读只有一个来源：MOSS。合不出来就不出声，没有第二个选择。
 */
import { speechify } from './speech'

export type VoiceSettings = {
  ttsEnabled: boolean
  asrEnabled: boolean
  voiceName: string
  rate: number
}

export const DEFAULT: VoiceSettings = {
  ttsEnabled: true,
  asrEnabled: true,
  voiceName: '',
  rate: 1,
}

const KEY = 'alp.voice'

export function loadVoiceSettings(): VoiceSettings {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return { ...DEFAULT, ...(JSON.parse(raw) as Partial<VoiceSettings>) }
  } catch {
    /* ignore */
  }
  return { ...DEFAULT }
}

export function saveVoiceSettings(s: VoiceSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    /* ignore */
  }
}

/* ---------------- 洗文本 ---------------- */

export function toSpeakable(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, '（这里有一段代码）')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]*)\*\*/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*[-*]\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\n{2,}/g, '。 ')
    .replace(/\n/g, '，')
    .trim()
}

/* ---------------- 识别 ---------------- */

export function asrSupported(): boolean {
  if (typeof window === 'undefined') return false
  const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown }
  return Boolean(w.SpeechRecognition || w.webkitSpeechRecognition)
}

function getRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike
    webkitSpeechRecognition?: new () => SpeechRecognitionLike
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export type AsrHandle = { stop: () => void }

export function startAsr(cb: {
  onFinal: (text: string) => void
  onInterim?: (text: string) => void
  onError?: (msg: string) => void
  onEnd?: () => void
}): AsrHandle | null {
  const Ctor = getRecognitionCtor()
  if (!Ctor) {
    cb.onError?.('当前浏览器不支持语音识别')
    return null
  }
  const rec = new Ctor()
  rec.lang = 'zh-CN'
  rec.continuous = false
  rec.interimResults = true

  rec.onresult = (e) => {
    let interim = ''
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i]
      const text = res[0]?.transcript ?? ''
      if (res.isFinal) {
        cb.onFinal(text.trim())
        return
      }
      interim += text
    }
    if (interim) cb.onInterim?.(interim)
  }
  rec.onerror = (e) => cb.onError?.(String((e as { error?: string }).error ?? '识别出错'))
  rec.onend = () => cb.onEnd?.()
  rec.start()

  return { stop: () => rec.stop() }
}

/* ---------------- 朗读（只走 MOSS） ---------------- */

let mossVoiceId = ''
let currentAudio: HTMLAudioElement | null = null

export function setMossVoice(id: string): void {
  mossVoiceId = id
}

export function getSinkId(): string {
  try {
    return localStorage.getItem('alp.speakerId') ?? ''
  } catch {
    return ''
  }
}

export async function speakSmart(
  text: string,
  _opts: { voiceName?: string; rate?: number } = {},
): Promise<'moss' | 'none'> {
  const plain = speechify(toSpeakable(text))
  if (!plain) return 'none'

  try {
    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: plain.slice(0, 1500),
        voiceId: mossVoiceId || undefined,
      }),
    })
    if (!res.ok) return 'none'
    // 后端已经把音频中转成二进制了，直接收 blob 播，避免跨域和签名问题
    const blob = await res.blob()
    if (blob.size < 1000) return 'none'

    stopAll()
    const url = URL.createObjectURL(blob)
    const audio = new Audio(url)
    currentAudio = audio
    audio.onended = () => URL.revokeObjectURL(url)

    const sink = getSinkId()
    if (sink && 'setSinkId' in audio) {
      try {
        await (audio as HTMLAudioElement & { setSinkId: (id: string) => Promise<void> }).setSinkId(sink)
      } catch {
        /* 不支持就默认设备 */
      }
    }
    await audio.play()
    return 'moss'
  } catch {
    return 'none'
  }
}

export function stopAll(): void {
  if (currentAudio) {
    try {
      currentAudio.pause()
      currentAudio.src = ''
    } catch {
      /* ignore */
    }
    currentAudio = null
  }
}

export function isAnySpeaking(): boolean {
  return Boolean(currentAudio && !currentAudio.paused)
}

type SpeechAltLike = { transcript: string }
type SpeechResultLike = { isFinal: boolean; 0: SpeechAltLike; length: number }
type SpeechEventLike = {
  resultIndex: number
  results: { length: number } & Record<number, SpeechResultLike>
}
type SpeechRecognitionLike = {
  lang: string
  continuous: boolean
  interimResults: boolean
  start: () => void
  stop: () => void
  onresult: ((e: SpeechEventLike) => void) | null
  onerror: ((e: unknown) => void) | null
  onend: (() => void) | null
}