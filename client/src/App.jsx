import { useState, useEffect, useRef, useCallback } from 'react'
import { Room, RoomEvent, createLocalAudioTrack, Track, ParticipantEvent } from 'livekit-client'

// ── Sound effects ─────────────────────────────────────────────────────────────
function playChime(type) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain); gain.connect(ctx.destination)
    if (type === 'connect') {
      osc.frequency.setValueAtTime(660, ctx.currentTime)
      osc.frequency.setValueAtTime(880, ctx.currentTime + 0.12)
      osc.frequency.setValueAtTime(1100, ctx.currentTime + 0.24)
      gain.gain.setValueAtTime(0.07, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5)
      osc.start(); osc.stop(ctx.currentTime + 0.5)
    } else {
      osc.frequency.setValueAtTime(880, ctx.currentTime)
      osc.frequency.setValueAtTime(550, ctx.currentTime + 0.18)
      gain.gain.setValueAtTime(0.06, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5)
      osc.start(); osc.stop(ctx.currentTime + 0.5)
    }
  } catch(e) {}
}

// ── Floating petals background ────────────────────────────────────────────────
function Petals() {
  const canvasRef = useRef(null)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    let W, H, t = 0

    const resize = () => { W = canvas.width = window.innerWidth; H = canvas.height = window.innerHeight }
    resize()
    window.addEventListener('resize', resize)

    const petals = Array.from({ length: 28 }, () => ({
      x: Math.random() * window.innerWidth,
      y: Math.random() * window.innerHeight,
      size: Math.random() * 6 + 2,
      opacity: Math.random() * 0.18 + 0.04,
      vx: (Math.random() - 0.5) * 0.3,
      vy: Math.random() * 0.4 + 0.1,
      rotation: Math.random() * Math.PI * 2,
      vr: (Math.random() - 0.5) * 0.02,
    }))

    const raf = { id: null }
    const draw = () => {
      t += 0.004
      ctx.clearRect(0, 0, W, H)

      const bg = ctx.createLinearGradient(0, 0, W * 0.3, H)
      bg.addColorStop(0, '#1a0a0f')
      bg.addColorStop(0.5, '#120810')
      bg.addColorStop(1, '#0a0814')
      ctx.fillStyle = bg
      ctx.fillRect(0, 0, W, H)

      const bloom1 = ctx.createRadialGradient(W * 0.25, H * 0.35, 0, W * 0.25, H * 0.35, W * 0.45)
      bloom1.addColorStop(0, 'rgba(160, 60, 80, 0.12)')
      bloom1.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = bloom1; ctx.fillRect(0, 0, W, H)

      const bloom2 = ctx.createRadialGradient(W * 0.75, H * 0.6, 0, W * 0.75, H * 0.6, W * 0.35)
      bloom2.addColorStop(0, 'rgba(120, 40, 100, 0.09)')
      bloom2.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = bloom2; ctx.fillRect(0, 0, W, H)

      petals.forEach(p => {
        p.x += p.vx + Math.sin(t + p.y * 0.01) * 0.15
        p.y += p.vy
        p.rotation += p.vr
        if (p.y > H + 20) { p.y = -20; p.x = Math.random() * W }
        if (p.x < -20) p.x = W + 20
        if (p.x > W + 20) p.x = -20

        ctx.save()
        ctx.translate(p.x, p.y)
        ctx.rotate(p.rotation)
        ctx.globalAlpha = p.opacity
        ctx.beginPath()
        ctx.ellipse(0, 0, p.size * 1.4, p.size * 0.7, 0, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(210, 150, 160, 1)`
        ctx.fill()
        ctx.restore()
      })

      raf.id = requestAnimationFrame(draw)
    }
    draw()
    return () => { cancelAnimationFrame(raf.id); window.removeEventListener('resize', resize) }
  }, [])

  return <canvas ref={canvasRef} style={{ position:'fixed', inset:0, width:'100%', height:'100%', pointerEvents:'none', zIndex:0 }} />
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [status, setStatus]               = useState('idle')
  const [agentSpeaking, setAgentSpeaking] = useState(false)
  const [callDuration, setCallDuration]   = useState(0)
  const [transcript, setTranscript]       = useState([])
  const [showTranscript, setShowTranscript] = useState(false)
  const [error, setError]                 = useState(null)

  const roomRef          = useRef(null)
  const audioElemsRef    = useRef([])
  const transcriptEndRef = useRef(null)
  const callDurationRef  = useRef(0)
  const transcriptRef    = useRef([])

  useEffect(() => { callDurationRef.current = callDuration }, [callDuration])
  useEffect(() => { transcriptRef.current = transcript }, [transcript])

  useEffect(() => {
    let timer = null, checker = null
    if (status === 'connected') {
      timer = setInterval(() => setCallDuration(p => p + 1), 1000)
      checker = setInterval(() => {
        const r = roomRef.current
        if (r && (r.state === 'disconnected' || r.state === 'failed')) handleDisconnect()
      }, 2000)
    } else if (status !== 'ended') {
      setCallDuration(0)
    }
    return () => { clearInterval(timer); clearInterval(checker) }
  }, [status])

  useEffect(() => { transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [transcript])

  function formatTime(s) {
    return `${Math.floor(s/60).toString().padStart(2,'0')}:${(s%60).toString().padStart(2,'0')}`
  }

  function cleanupAudio() {
    audioElemsRef.current.forEach(el => {
      el.pause(); el.srcObject = null; el.src = ''
      if (el.parentNode) el.parentNode.removeChild(el)
    })
    audioElemsRef.current = []
  }

  function handleDisconnect() {
    cleanupAudio()
    playChime('disconnect')
    setStatus('ended')
    setAgentSpeaking(false)
    roomRef.current = null
    setTimeout(() => {
      setStatus('idle'); setTranscript([]); setShowTranscript(false); setCallDuration(0)
    }, 5000)
  }

  function addMessage(role, text) {
    if (!text?.trim()) return
    setTranscript(prev => {
      const last = prev[prev.length - 1]
      if (last?.role === role) return [...prev.slice(0, -1), { ...last, text: last.text + ' ' + text.trim() }]
      return [...prev, { role, text: text.trim(), id: Date.now() + Math.random() }]
    })
  }

  async function startCall() {
    setStatus('connecting'); setTranscript([]); setError(null)
    try {
      const res = await fetch(`${import.meta.env.VITE_TOKEN_SERVER_URL}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(8000),
      })
      if (!res.ok) throw new Error('Token server error')
      const { token, url } = await res.json()

      const room = new Room({ reconnectPolicy: { nextRetryDelayInMs: () => null } })
      roomRef.current = room

      room.on(RoomEvent.Disconnected, () => setTimeout(() => handleDisconnect(), 300))
      room.on(RoomEvent.Connected, () => { setStatus('connected'); playChime('connect') })
      room.on(RoomEvent.TrackSubscribed, (track, _, participant) => {
        if (track.kind === Track.Kind.Audio) {
          const el = track.attach(); el.autoplay = true
          document.body.appendChild(el); audioElemsRef.current.push(el)
          participant.on(ParticipantEvent.IsSpeakingChanged, s => setAgentSpeaking(s))
        }
      })
      room.on(RoomEvent.TranscriptionReceived, (segments, participant) => {
        segments.forEach(seg => {
          if (!seg.final) return
          addMessage(participant?.identity !== 'customer-1' ? 'agent' : 'user', seg.text)
        })
      })
      room.on(RoomEvent.DataReceived, (payload, participant) => {
        try {
          const msg = JSON.parse(new TextDecoder().decode(payload))
          const c = msg?.text || msg?.transcript || ''
          if (c) addMessage(participant?.identity !== 'customer-1' ? 'agent' : 'user', c)
        } catch {}
      })

      await room.connect(url, token)
      await room.localParticipant.publishTrack(await createLocalAudioTrack())
    } catch(e) {
      console.error(e)
      cleanupAudio()
      roomRef.current = null
      if (e.name === 'TimeoutError' || e.name === 'AbortError') {
        setError('Connection timed out. Please try again.')
      } else {
        setError('Could not connect. Please try again.')
      }
      setStatus('idle')
    }
  }

  async function endCall() {
    const room = roomRef.current; roomRef.current = null
    handleDisconnect(); if (room) await room.disconnect()
  }

  const isIdle       = status === 'idle'
  const isConnecting = status === 'connecting'
  const isConnected  = status === 'connected'
  const isEnded      = status === 'ended'

  return (
    <div className="root">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;1,300;1,400&family=Jost:wght@200;300;400&display=swap');

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html, body { background: #0f0810; height: 100%; overflow: hidden; }

        .root {
          min-height: 100vh; width: 100%;
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          position: relative; overflow: hidden;
          font-family: 'Jost', sans-serif;
        }

        .nav {
          position: fixed; top: 0; left: 0; right: 0;
          padding: 22px 48px;
          display: flex; justify-content: space-between; align-items: center;
          z-index: 30;
          border-bottom: 1px solid rgba(210,150,160,0.06);
        }
        .nav-brand {
          font-family: 'Cormorant Garamond', serif;
          font-size: 15px; font-weight: 300; letter-spacing: 0.22em;
          text-transform: uppercase; color: rgba(220,185,185,0.75);
        }
        .nav-brand em { font-style: italic; color: rgba(220,155,165,0.95); }
        .nav-right {
          font-family: 'Jost', sans-serif;
          font-size: 9px; letter-spacing: 0.38em; text-transform: uppercase;
          font-weight: 200; color: rgba(210,150,160,0.22);
        }

        .main {
          position: relative; z-index: 2;
          display: flex; flex-direction: column; align-items: center;
          width: 100%; padding: 0 24px;
        }

        .eyebrow {
          font-size: 9px; letter-spacing: 0.5em; text-transform: uppercase;
          font-weight: 200; color: rgba(210,150,160,0.35);
          margin-bottom: 16px;
        }

        .title {
          font-family: 'Cormorant Garamond', serif;
          font-size: clamp(26px, 3.5vw, 52px);
          font-weight: 300; letter-spacing: 0.06em;
          color: rgba(240, 220, 220, 0.92);
          text-align: center; line-height: 1.15;
          margin-bottom: 6px;
        }
        .title em { font-style: italic; color: rgba(220, 155, 165, 1); }
        .subtitle {
          font-size: 11px; letter-spacing: 0.3em; text-transform: uppercase;
          font-weight: 200; color: rgba(210,150,160,0.28);
          margin-bottom: 52px;
        }

        .ring-system {
          position: relative;
          display: flex; align-items: center; justify-content: center;
          margin-bottom: 36px;
        }
        .ring {
          position: absolute; border-radius: 50%; pointer-events: none;
        }
        .ring-1 {
          width: clamp(280px, 38vw, 360px); height: clamp(280px, 38vw, 360px);
          border: 1px solid rgba(210,150,160,0.08);
          animation: spin1 55s linear infinite;
        }
        .ring-1::before {
          content: ''; position: absolute; top: -3px; left: 50%;
          width: 5px; height: 5px; border-radius: 50%;
          background: rgba(220,155,165,0.7);
          transform: translateX(-50%);
          box-shadow: 0 0 10px rgba(220,155,165,1);
        }
        .ring-2 {
          width: clamp(230px, 31vw, 300px); height: clamp(230px, 31vw, 300px);
          border: 1px solid rgba(180,120,140,0.06);
          animation: spin1 38s linear infinite reverse;
        }
        .ring-2::after {
          content: ''; position: absolute; bottom: -2.5px; right: 25%;
          width: 3.5px; height: 3.5px; border-radius: 50%;
          background: rgba(200,140,155,0.5);
          box-shadow: 0 0 7px rgba(200,140,155,0.8);
        }
        .ring-3 {
          width: clamp(170px, 23vw, 244px); height: clamp(170px, 23vw, 244px);
          border: 1px solid rgba(210,150,160,0.12);
          transition: all 0.8s ease;
        }
        .ring-3.speaking {
          border-color: rgba(220,155,165,0.55);
          box-shadow: 0 0 50px rgba(200,100,120,0.2), 0 0 100px rgba(200,100,120,0.1);
          animation: glowPulse 2s ease-in-out infinite;
        }
        @keyframes spin1 { to { transform: rotate(360deg); } }
        @keyframes glowPulse {
          0%, 100% { box-shadow: 0 0 40px rgba(200,100,120,0.15), 0 0 80px rgba(200,100,120,0.07); }
          50% { box-shadow: 0 0 70px rgba(200,100,120,0.3), 0 0 140px rgba(200,100,120,0.15); }
        }

        .orb {
          position: relative; z-index: 5;
          width: clamp(150px, 19vw, 200px); height: clamp(150px, 19vw, 200px);
          border-radius: 50%;
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          cursor: pointer; transition: transform 0.3s ease;
        }
        .orb:hover { transform: scale(1.04); }
        .orb:active { transform: scale(0.97); }
        .orb-bg {
          position: absolute; inset: 0; border-radius: 50%;
          background: radial-gradient(circle at 38% 32%, rgba(180,80,100,0.38) 0%, rgba(100,30,50,0.6) 45%, rgba(30,8,16,0.9) 100%);
          border: 1px solid rgba(210,150,160,0.22);
          transition: all 0.6s ease;
        }
        .orb.speaking .orb-bg {
          background: radial-gradient(circle at 38% 32%, rgba(210,100,120,0.5) 0%, rgba(140,40,65,0.72) 45%, rgba(40,10,20,0.95) 100%);
          border-color: rgba(220,155,165,0.65);
          box-shadow: 0 0 50px rgba(200,80,100,0.25), inset 0 0 30px rgba(200,80,100,0.1);
        }
        .orb-shine {
          position: absolute; width: 55%; height: 42%; top: 9%; left: 22%;
          border-radius: 50%;
          background: radial-gradient(ellipse, rgba(240,200,210,0.1) 0%, transparent 70%);
          pointer-events: none;
        }
        .orb-content {
          position: relative; z-index: 2;
          text-align: center; padding: 10px;
        }
        .orb-icon { font-size: 22px; margin-bottom: 8px; }
        .orb-label {
          font-family: 'Cormorant Garamond', serif;
          font-size: clamp(13px, 1.6vw, 17px);
          font-weight: 300; letter-spacing: 0.06em;
          color: rgba(240,215,218,0.95); line-height: 1.3;
        }
        .orb-hint {
          font-size: 9px; letter-spacing: 0.3em; text-transform: uppercase;
          font-weight: 200; color: rgba(210,150,160,0.5); margin-top: 6px;
        }
        .orb-timer {
          font-family: 'Jost', sans-serif;
          font-size: clamp(20px, 2.4vw, 26px); letter-spacing: 0.14em;
          font-weight: 200; color: rgba(240,215,218,0.95);
          margin-bottom: 4px; font-variant-numeric: tabular-nums;
        }
        .orb-status {
          font-size: 9px; letter-spacing: 0.28em; text-transform: uppercase;
          font-weight: 200; transition: color 0.5s;
        }
        .orb-spinner {
          width: 26px; height: 26px; border-radius: 50%;
          border: 1.5px solid rgba(210,150,160,0.15);
          border-top-color: rgba(210,150,160,0.8);
          animation: spin1 1s linear infinite; margin-bottom: 8px;
        }

        .bars {
          display: flex; align-items: center; gap: 3px;
          height: 32px; margin-bottom: 8px; justify-content: center;
        }
        .bar {
          width: 2.5px; border-radius: 3px;
          background: linear-gradient(180deg, rgba(240,200,210,0.95), rgba(180,100,120,0.6));
          box-shadow: 0 0 4px rgba(210,150,160,0.5);
          transform-origin: center;
        }
        .bar.off { height: 3px; opacity: 0.15; }
        .bar.on  { animation: barWave 0.75s ease-in-out infinite; }
        @keyframes barWave { 0%, 100% { transform: scaleY(0.12); } 50% { transform: scaleY(1); } }

        .connected-header {
          display: flex; align-items: center; gap: 14px;
          margin-bottom: 18px; animation: fadeUp 0.5s ease;
          flex-wrap: wrap; justify-content: center;
        }
        .avatar {
          width: 44px; height: 44px; border-radius: 50%;
          background: radial-gradient(circle at 38% 35%, rgba(180,80,100,0.55), rgba(80,20,40,0.9));
          border: 1px solid rgba(210,150,160,0.3);
          display: flex; align-items: center; justify-content: center;
          font-family: 'Cormorant Garamond', serif; font-size: 17px;
          font-style: italic; color: rgba(240,215,218,0.9);
          box-shadow: 0 0 18px rgba(180,80,100,0.15);
          transition: all 0.4s ease; flex-shrink: 0;
        }
        .avatar.speaking {
          border-color: rgba(220,155,165,0.7);
          box-shadow: 0 0 28px rgba(200,80,100,0.3);
          animation: avatarPulse 2s ease-in-out infinite;
        }
        @keyframes avatarPulse {
          0%, 100% { box-shadow: 0 0 18px rgba(200,80,100,0.2); }
          50% { box-shadow: 0 0 34px rgba(200,80,100,0.45); }
        }
        .connected-title {
          font-family: 'Cormorant Garamond', serif;
          font-size: clamp(16px, 2vw, 22px); font-weight: 300;
          color: rgba(220,195,198,0.72); letter-spacing: 0.04em;
        }
        .connected-title em { font-style: italic; color: rgba(220,155,165,0.95); }

        .speaking-dots {
          display: flex; align-items: center; gap: 5px;
          justify-content: center; margin-top: 3px; animation: fadeUp 0.3s ease;
        }
        .s-dot {
          width: 4px; height: 4px; border-radius: 50%;
          background: rgba(210,150,160,0.8);
          animation: dotBounce 0.6s ease-in-out infinite;
        }
        .s-label {
          font-size: 9px; letter-spacing: 0.2em; text-transform: uppercase;
          font-weight: 200; color: rgba(210,150,160,0.55);
        }
        @keyframes dotBounce {
          0%, 100% { transform: translateY(0); opacity: 0.35; }
          50% { transform: translateY(-4px); opacity: 1; }
        }

        .ended-screen {
          display: flex; flex-direction: column; align-items: center;
          animation: fadeUp 0.6s ease; gap: 12px;
        }
        .ended-icon {
          width: 58px; height: 58px; border-radius: 50%;
          background: radial-gradient(circle, rgba(180,80,100,0.25), rgba(60,15,30,0.7));
          border: 1px solid rgba(210,150,160,0.3);
          display: flex; align-items: center; justify-content: center;
          font-size: 22px; margin-bottom: 8px;
          box-shadow: 0 0 30px rgba(180,80,100,0.12);
        }
        .ended-title {
          font-family: 'Cormorant Garamond', serif;
          font-size: 28px; font-weight: 300; letter-spacing: 0.06em;
          color: rgba(240,215,218,0.88); text-align: center;
        }
        .ended-title em { font-style: italic; color: rgba(220,155,165,0.95); }
        .ended-sub {
          font-size: 10px; letter-spacing: 0.35em; text-transform: uppercase;
          font-weight: 200; color: rgba(210,150,160,0.28);
        }
        .ended-bar {
          width: 100px; height: 1px; border-radius: 1px;
          background: rgba(210,150,160,0.15); margin-top: 12px; overflow: hidden;
        }
        .ended-bar-fill {
          height: 100%; background: rgba(210,150,160,0.5);
          animation: drain 5s linear forwards;
        }
        @keyframes drain { from { width: 100%; } to { width: 0%; } }

        .bottom-panel {
          width: 100%; max-width: 380px;
          display: flex; flex-direction: column; align-items: center; gap: 12px;
        }
        .status-pill {
          display: inline-flex; align-items: center; gap: 8px;
          padding: 7px 18px; border-radius: 20px;
          border: 1px solid rgba(210,150,160,0.09);
          background: rgba(210,150,160,0.03); margin-top: 8px;
        }
        .pill-dot { width: 5px; height: 5px; border-radius: 50%; flex-shrink: 0; }
        .pill-text {
          font-size: 9px; letter-spacing: 0.3em; text-transform: uppercase; font-weight: 200;
        }

        .t-toggle {
          background: none; border: none; cursor: pointer;
          font-family: 'Jost', sans-serif;
          font-size: 9px; letter-spacing: 0.28em; text-transform: uppercase;
          font-weight: 200; color: rgba(210,150,160,0.28);
          display: flex; align-items: center; gap: 10px;
          padding: 4px 0; transition: color 0.3s;
        }
        .t-toggle:hover { color: rgba(210,150,160,0.65); }
        .tl { width: 22px; height: 1px; background: currentColor; opacity: 0.5; }

        .t-drawer {
          width: 100%; max-height: 160px; overflow-y: auto;
          display: flex; flex-direction: column; gap: 8px;
          border-top: 1px solid rgba(210,150,160,0.07);
          padding-top: 12px; animation: fadeUp 0.3s ease;
        }
        .t-drawer::-webkit-scrollbar { width: 1px; }
        .t-drawer::-webkit-scrollbar-thumb { background: rgba(210,150,160,0.2); }
        .msg { display: flex; flex-direction: column; animation: fadeUp 0.2s ease; }
        .msg.a { align-items: flex-start; }
        .msg.u { align-items: flex-end; }
        .msg-lbl {
          font-size: 8px; letter-spacing: 0.22em; text-transform: uppercase;
          font-weight: 300; color: rgba(210,150,160,0.3);
          margin-bottom: 3px; padding: 0 4px;
        }
        .msg-txt {
          font-size: 12px; line-height: 1.6; font-weight: 300;
          padding: 7px 12px; max-width: 85%;
        }
        .msg.a .msg-txt {
          color: rgba(225,200,205,0.85);
          background: rgba(210,150,160,0.07);
          border: 1px solid rgba(210,150,160,0.12);
          border-radius: 0 10px 10px 10px;
        }
        .msg.u .msg-txt {
          color: rgba(255,240,242,0.7);
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.07);
          border-radius: 10px 0 10px 10px;
        }

        .end-btn {
          background: none;
          border: 1px solid rgba(180,60,70,0.3);
          cursor: pointer; font-family: 'Jost', sans-serif;
          font-size: 9px; letter-spacing: 0.4em; text-transform: uppercase;
          font-weight: 300; color: rgba(220,100,110,0.5);
          padding: 11px 36px; border-radius: 3px;
          transition: all 0.3s ease;
        }
        .end-btn:hover {
          color: rgba(230,110,120,0.9);
          border-color: rgba(200,70,80,0.65);
          background: rgba(180,60,70,0.06);
        }

        .error-banner {
          position: fixed; top: 72px; left: 50%; transform: translateX(-50%);
          background: rgba(140,30,40,0.9); border: 1px solid rgba(200,80,90,0.25);
          color: rgba(255,210,215,0.95);
          padding: 10px 18px; border-radius: 4px;
          font-size: 11px; letter-spacing: 0.06em; font-weight: 200;
          display: flex; align-items: center; gap: 12px;
          z-index: 100; animation: fadeUp 0.3s ease; white-space: nowrap;
        }
        .error-dismiss {
          background: none; border: none; cursor: pointer;
          color: rgba(255,180,185,0.55); font-size: 14px; padding: 0; line-height: 1;
          transition: color 0.2s;
        }
        .error-dismiss:hover { color: rgba(255,180,185,1); }

        .footer {
          position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%);
          font-size: 9px; letter-spacing: 0.28em; text-transform: uppercase;
          font-weight: 200; color: rgba(210,150,160,0.08);
          white-space: nowrap; pointer-events: none; z-index: 2;
        }

        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(-8px); }
          to { opacity: 1; transform: translateY(0); }
        }

        @media (max-width: 600px) {
          .nav { padding: 16px 22px; }
          .nav-right { display: none; }
          .ring-1 { width: 290px !important; height: 290px !important; }
          .ring-2 { width: 240px !important; height: 240px !important; }
          .ring-3 { width: 180px !important; height: 180px !important; }
          .orb { width: 158px !important; height: 158px !important; }
          .error-banner { white-space: normal; max-width: 90vw; text-align: center; }
        }
      `}</style>

      <Petals />

      <nav className="nav">
        <div className="nav-brand">Bridal <em>Traditions</em></div>
        <div className="nav-right">Voice Assistant · AI Powered</div>
      </nav>

      {error && (
        <div className="error-banner">
          <span>⚠ {error}</span>
          <button className="error-dismiss" onClick={() => setError(null)}>✕</button>
        </div>
      )}

      <div className="main">

        {isEnded && (
          <div className="ended-screen">
            <div className="ended-icon">✦</div>
            <h2 className="ended-title">Thank you for<br/><em>calling</em></h2>
            <p className="ended-sub">Call ended · {formatTime(callDuration)}</p>
            <div className="ended-bar"><div className="ended-bar-fill" /></div>
          </div>
        )}

        {(isIdle || isConnecting) && (
          <>
            <p className="eyebrow">Bridal Boutique · North Carolina</p>
            <h1 className="title">Bridal <em>Traditions</em></h1>
            <p className="subtitle">Ask us anything about our collections</p>
          </>
        )}

        {isConnected && (
          <div className="connected-header">
            <div className={`avatar ${agentSpeaking ? 'speaking' : ''}`}>A</div>
            <div>
              <div className="connected-title">Speaking with <em>your assistant</em></div>
              {agentSpeaking && (
                <div className="speaking-dots">
                  <span className="s-dot" style={{animationDelay:'0s'}} />
                  <span className="s-dot" style={{animationDelay:'0.2s'}} />
                  <span className="s-dot" style={{animationDelay:'0.4s'}} />
                  <span className="s-label">speaking...</span>
                </div>
              )}
            </div>
          </div>
        )}

        {!isEnded && (
          <div className="ring-system">
            <div className="ring ring-1" />
            <div className="ring ring-2" />
            <div className={`ring ring-3 ${agentSpeaking ? 'speaking' : ''}`}
              style={agentSpeaking ? {
                background: 'radial-gradient(circle, rgba(180,80,100,0.35) 0%, rgba(100,30,50,0.08) 60%, transparent 100%)',
                transform: 'scale(1.08)', transition: 'all 0.4s ease',
              } : { transition: 'all 0.4s ease' }}
            />

            {isIdle && (
              <div className="orb" onClick={startCall}>
                <div className="orb-bg" /><div className="orb-shine" />
                <div className="orb-content">
                  <div className="orb-icon">🌸</div>
                  <p className="orb-label">Ask<br/>anything</p>
                  <p className="orb-hint">Tap to speak</p>
                </div>
              </div>
            )}

            {isConnecting && (
              <div className="orb" style={{cursor:'default'}}>
                <div className="orb-bg" /><div className="orb-shine" />
                <div className="orb-content">
                  <div className="orb-spinner" />
                  <p className="orb-hint">Connecting...</p>
                </div>
              </div>
            )}

            {isConnected && (
              <div className={`orb ${agentSpeaking ? 'speaking' : ''}`} style={{cursor:'default'}}>
                <div className="orb-bg" style={agentSpeaking ? {
                  background: 'radial-gradient(circle at 38% 32%, rgba(220,110,130,0.55) 0%, rgba(150,45,70,0.78) 45%, rgba(40,10,20,0.96) 100%)',
                  borderColor: 'rgba(220,155,165,0.75)',
                  boxShadow: '0 0 55px rgba(200,80,100,0.28), inset 0 0 35px rgba(200,80,100,0.1)',
                  transition: 'all 0.4s ease',
                } : { transition: 'all 0.4s ease' }} />
                <div className="orb-shine" />
                <div className="orb-content">
                  <div className="bars">
                    {[1,2,4,7,11,15,11,7,4,2,1].map((h,i) => (
                      <div key={i} className={`bar ${agentSpeaking ? 'on' : 'off'}`}
                        style={{height:`${h*2.6}px`, animationDelay:`${i*0.08}s`}} />
                    ))}
                  </div>
                  <p className="orb-timer">{formatTime(callDuration)}</p>
                  <p className="orb-status" style={{
                    color: agentSpeaking ? 'rgba(210,150,160,0.9)' : 'rgba(255,255,255,0.22)',
                    transition: 'color 0.4s ease',
                  }}>
                    {agentSpeaking ? 'Speaking' : 'Listening'}
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="bottom-panel">
          {isIdle && (
            <div className="status-pill">
              <div className="pill-dot" style={{background:'rgba(255,255,255,0.15)'}} />
              <span className="pill-text" style={{color:'rgba(255,255,255,0.15)'}}>Ready</span>
            </div>
          )}

          {isConnecting && (
            <div className="status-pill">
              <div className="pill-dot" style={{background:'rgba(210,150,160,0.8)', boxShadow:'0 0 6px rgba(210,150,160,0.8)', animation:'glowPulse 1s ease-in-out infinite'}} />
              <span className="pill-text" style={{color:'rgba(210,150,160,0.55)'}}>Connecting</span>
            </div>
          )}

          {isConnected && (
            <>
              {transcript.length > 0 && (
                <button className="t-toggle" onClick={() => setShowTranscript(p => !p)}>
                  <div className="tl" />
                  {showTranscript ? 'Hide conversation' : 'View conversation'}
                  <div className="tl" />
                </button>
              )}
              {showTranscript && transcript.length > 0 && (
                <div className="t-drawer">
                  {transcript.map(msg => (
                    <div key={msg.id} className={`msg ${msg.role === 'agent' ? 'a' : 'u'}`}>
                      {msg.role === 'agent' && <span className="msg-lbl">Assistant</span>}
                      <div className="msg-txt">{msg.text}</div>
                    </div>
                  ))}
                  <div ref={transcriptEndRef} />
                </div>
              )}
              <button className="end-btn" onClick={endCall}>End Call</button>
            </>
          )}
        </div>
      </div>

      <p className="footer">Powered by AI · Available 24 / 7</p>
    </div>
  )
}