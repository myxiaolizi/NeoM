/**
 * recorder — MediaRecorder audio capture → `/api/storage/upload` → inserts an
 * `<audio>` tag (or markdown link) into the document, plus one-click ASR via
 * `/api/ai/asr` to insert the transcript.
 */
import React, { useEffect, useRef, useState } from 'react'
import { Icon } from '@/components/Icon'
import type { PanelProps } from '../types'
import { Btn, Empty, Head, Panel, Segmented } from '../ui'
import { fmtTime, truncate } from '../utils'

interface Recording {
  id: string
  url: string
  name: string
  size: number
  duration: number
  at: number
  text?: string
}

const LS_KEY = 'neom.recorder.history'

const loadHistory = (): Recording[] => {
  try {
    const raw = localStorage.getItem(LS_KEY)
    return raw ? (JSON.parse(raw) as Recording[]) : []
  } catch { return [] }
}

const saveHistory = (rows: Recording[]) => {
  try { localStorage.setItem(LS_KEY, JSON.stringify(rows.slice(0, 30))) } catch { /* quota */ }
}

const fmtSize = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)

const RecorderPanel: React.FC<PanelProps> = ({ context }) => {
  const [recording, setRecording] = useState(false)
  const [paused, setPaused] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [level, setLevel] = useState(0)
  const [history, setHistory] = useState<Recording[]>(loadHistory)
  const [busy, setBusy] = useState(false)
  const [asrBusy, setAsrBusy] = useState<string | null>(null)
  const [insertMode, setInsertMode] = useState<'audio' | 'link'>('audio')
  const [err, setErr] = useState<string | null>(null)

  const recRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const timerRef = useRef(0)
  const rafRef = useRef(0)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const startedAt = useRef(0)

  useEffect(() => () => stopAll(), [])

  const stopAll = () => {
    window.clearInterval(timerRef.current)
    cancelAnimationFrame(rafRef.current)
    try { recRef.current?.state !== 'inactive' && recRef.current?.stop() } catch { /* noop */ }
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') void audioCtxRef.current.close().catch(() => {})
    audioCtxRef.current = null
  }

  const start = async () => {
    setErr(null)
    if (!navigator.mediaDevices?.getUserMedia) { setErr('当前环境不支持录音（需要 HTTPS 或桌面端）'); return }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg']
        .find((m) => (window as any).MediaRecorder?.isTypeSupported?.(m)) || ''
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream)
      recRef.current = rec
      chunksRef.current = []
      rec.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data) }
      rec.onstop = () => void onStop(mime)
      rec.start(400)
      setRecording(true)
      setPaused(false)
      setSeconds(0)
      startedAt.current = Date.now()
      timerRef.current = window.setInterval(() => setSeconds(Math.floor((Date.now() - startedAt.current) / 1000)), 250)

      // live level meter
      const ac = new (window.AudioContext || (window as any).webkitAudioContext)()
      audioCtxRef.current = ac
      const analyser = ac.createAnalyser()
      analyser.fftSize = 512
      ac.createMediaStreamSource(stream).connect(analyser)
      const buf = new Uint8Array(analyser.frequencyBinCount)
      const loop = () => {
        analyser.getByteTimeDomainData(buf)
        let sum = 0
        for (let i = 0; i < buf.length; i++) { const d = (buf[i] - 128) / 128; sum += d * d }
        setLevel(Math.min(1, Math.sqrt(sum / buf.length) * 4))
        rafRef.current = requestAnimationFrame(loop)
      }
      loop()
    } catch (e: any) {
      setErr(e?.name === 'NotAllowedError' ? '麦克风权限被拒绝' : e?.message || '无法开始录音')
      stopAll()
      setRecording(false)
    }
  }

  const onStop = async (mime: string) => {
    const blob = new Blob(chunksRef.current, { type: mime || 'audio/webm' })
    const duration = Math.floor((Date.now() - startedAt.current) / 1000)
    stopAll()
    setRecording(false)
    setPaused(false)
    setLevel(0)
    if (!blob.size) { setErr('没有录到音频'); return }
    setBusy(true)
    try {
      const name = `录音-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')}.webm`
      const form = new FormData()
      form.append('file', new File([blob], name, { type: blob.type }))
      form.append('kind', 'ot')
      const res = await context.api.post('/api/storage/upload', form)
      const url = res?.url || res?.data?.url
      if (!url) throw new Error('上传未返回地址')
      const item: Recording = {
        id: `${Date.now()}`,
        url,
        name,
        size: blob.size,
        duration,
        at: Date.now()
      }
      const next = [item, ...history]
      setHistory(next)
      saveHistory(next)
      insertAudio(item)
      ;(window as any).__neomLastRecording = { blob, item }
    } catch (e: any) {
      // offline / unauthenticated: keep a local blob URL so the panel still works
      const localUrl = URL.createObjectURL(blob)
      const item: Recording = { id: `${Date.now()}`, url: localUrl, name: '本地录音.webm', size: blob.size, duration, at: Date.now() }
      const next = [item, ...history]
      setHistory(next)
      saveHistory(next)
      setErr(`上传失败：${e?.message || '未知错误'}（已保留本地临时录音）`)
      ;(window as any).__neomLastRecording = { blob, item }
    } finally {
      setBusy(false)
    }
  }

  const insertAudio = (rec: Recording) => {
    const snippet = insertMode === 'audio'
      ? `\n\n<audio controls src="${rec.url}"></audio>\n`
      : `\n\n[🎙 录音 ${fmtTime(rec.at)}](${rec.url})\n`
    context.insertText(snippet)
    context.toast('音频已插入文档', 'ok')
  }

  const transcribe = async (rec: Recording) => {
    setAsrBusy(rec.id)
    try {
      const blob: Blob | undefined = (window as any).__neomLastRecording?.item?.id === rec.id
        ? (window as any).__neomLastRecording.blob
        : await fetch(rec.url).then((r) => r.blob())
      if (!blob) throw new Error('无法读取音频数据')
      const form = new FormData()
      form.append('file', new File([blob], rec.name || 'audio.webm', { type: blob.type || 'audio/webm' }))
      const res = await context.api.post('/api/ai/asr', form)
      const text = res?.text || res?.data?.text || ''
      if (!text.trim()) throw new Error('语音识别没有返回文本')
      const next = history.map((h) => (h.id === rec.id ? { ...h, text } : h))
      setHistory(next)
      saveHistory(next)
      context.insertText(`\n\n> 🎙 语音转写（${fmtTime(rec.at)}）\n\n${text.trim()}\n`)
      context.toast('语音已转文字并插入', 'ok')
    } catch (e: any) {
      context.toast(e?.message || '语音识别失败（请检查 ASR 配置）', 'error')
    } finally {
      setAsrBusy(null)
    }
  }

  const remove = (id: string) => {
    const next = history.filter((h) => h.id !== id)
    setHistory(next)
    saveHistory(next)
  }

  const mmss = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`

  return (
    <Panel>
      <Head
        icon="mic"
        title="录音机"
        sub={recording ? `录音中 ${mmss}` : `${history.length} 条录音`}
        actions={
          <Segmented
            value={insertMode}
            options={[{ value: 'audio', label: 'audio 标签' }, { value: 'link', label: '链接' }]}
            onChange={(v) => setInsertMode(v as 'audio' | 'link')}
          />
        }
      />
      <div className="plg-pad col">
        <div className={'plg-rec' + (recording ? ' on' : '')}>
          <div className="plg-rec-visual">
            <span className="plg-rec-dot" style={{ opacity: recording && !paused ? 1 : 0.25 }} />
            <div className="plg-rec-bars">
              {Array.from({ length: 28 }).map((_, i) => (
                <i
                  key={i}
                  style={{
                    height: recording && !paused
                      ? `${8 + Math.abs(Math.sin((i + 1) * (seconds + 1) * 0.6)) * level * 46}px`
                      : '8px'
                  }}
                />
              ))}
            </div>
          </div>
          <div className="plg-rec-time">{mmss}</div>
          <div className="row center" style={{ gap: 8 }}>
            {!recording ? (
              <Btn icon="mic" primary onClick={start} disabled={busy}>开始录音</Btn>
            ) : (
              <>
                <Btn
                  icon={paused ? 'play' : 'pause'}
                  onClick={() => {
                    const rec = recRef.current
                    if (!rec) return
                    if (paused) { rec.resume(); setPaused(false) } else { rec.pause(); setPaused(true) }
                  }}
                >
                  {paused ? '继续' : '暂停'}
                </Btn>
                <Btn icon="stop" danger onClick={() => { try { recRef.current?.stop() } catch { /* noop */ } }}>停止并上传</Btn>
              </>
            )}
          </div>
          {busy && <div className="plg-loading"><span className="spinner" />上传中…</div>}
          {err && <div className="plg-error">{err}</div>}
        </div>
      </div>
      <div className="plg-divider" />
      <div className="plg-sub-title">录音历史</div>
      <div className="plg-scroll">
        {!history.length && <Empty icon="mic" text="还没有录音。点击「开始录音」，停止后自动上传并插入文档" />}
        {history.map((rec) => (
          <div key={rec.id} className="plg-rec-item">
            <Icon name="volume" size={13} />
            <div className="grow">
              <div className="plg-row-title ellipsis">{rec.name}</div>
              <div className="plg-row-sub">
                {fmtTime(rec.at)} · {fmtSize(rec.size)} · {Math.max(1, rec.duration)} 秒
                {rec.text ? ` · 已转写 ${rec.text.length} 字` : ''}
              </div>
              {rec.text && <div className="plg-rec-text">{truncate(rec.text, 110)}</div>}
            </div>
            <Btn icon="paste" onClick={() => insertAudio(rec)}>插入</Btn>
            <Btn icon="robot" disabled={asrBusy === rec.id} onClick={() => void transcribe(rec)}>
              {asrBusy === rec.id ? '识别中…' : '转文字'}
            </Btn>
            <audio src={rec.url} controls preload="none" style={{ display: 'none' }} />
            <button type="button" className="plg-icon-btn" title="播放" onClick={() => { const a = new Audio(rec.url); void a.play() }}>
              <Icon name="play" size={12} />
            </button>
            <button type="button" className="plg-icon-btn" title="删除" onClick={() => remove(rec.id)}>
              <Icon name="trash" size={12} />
            </button>
          </div>
        ))}
      </div>
      <div className="plg-foot"><Icon name="info" size={11} /><span>录音上传至 /api/storage/upload，转写调用 /api/ai/asr</span></div>
    </Panel>
  )
}

export default RecorderPanel
