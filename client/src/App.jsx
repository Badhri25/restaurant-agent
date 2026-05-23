import { useState, useEffect, useRef, useCallback } from 'react'
import { Room, RoomEvent, createLocalAudioTrack, Track, ParticipantEvent } from 'livekit-client'

// Particle canvas component
function ParticleCanvas({ active }) {
  const canvasRef = useRef(null)
  const animRef = useRef(null)
  const particles = useRef([])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    let W = canvas.width = window.innerWidth
    let H = canvas.height = window.innerHeight

    const resize = () => {
      W = canvas.width = window.innerWidth
      H = canvas.height = window.innerHeight
    }
    window.addEventListener('resize', resize)

    const COUNT = 55
    particles.current = Array.from({ length: COUNT }, () => ({
      x: Math.random() * W,
      y: Math.random() * H,
      r: Math.random() * 1.2 + 0.2,
      alpha: Math.random() * 0.35 + 0.05,
      dx: (Math.random() - 0.5) * 0.18,
      dy: -(Math.random() * 0.22 + 0.04),
      pulse: Math.random() * Math.PI * 2,
      pulseSpeed: Math.random() * 0.008 + 0.003,
    }))

    const draw = () => {
      ctx.clearRect(0, 0, W, H)

      const grd = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W * 0.45)
      grd.addColorStop(0, 'rgba(160,120,40,0.07)')
      grd.addColorStop(0.5, 'rgba(120,90,30,0.03)')
      grd.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = grd
      ctx.fillRect(0, 0, W, H)

      particles.current.forEach(p => {
        p.pulse += p.pulseSpeed
        p.x += p.dx
        p.y += p.dy
        if (p.y < -5) { p.y = H + 5; p.x = Math.random() * W }
        if (p.x < -5) p.x = W + 5
        if (p.x > W + 5) p.x = -5

        const alpha = p.alpha * (0.6 + 0.4 * Math.sin(p.pulse)) * (active ? 1.6 : 1)
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(200,165,70,${Math.min(alpha, 0.55)})`
        ctx.fill()
      })

      animRef.current = requestAnimationFrame(draw)
    }
    draw()

    return () => {
      cancelAnimationFrame(animRef.current)
      window.removeEventListener('resize', resize)
    }
  }, [active])

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed', inset: 0,
        width: '100%', height: '100%',
        pointerEvents: 'none',
        zIndex: 0,
      }}
    />
  )
}

export default function App() {
  const [status, setStatus] = useState('idle')
  const [agentSpeaking, setAgentSpeaking] = useState(false)
  const [callDuration, setCallDuration] = useState(0)
  const [transcript, setTranscript] = useState([])
  const [showTranscript, setShowTranscript] = useState(false)
  const roomRef = useRef(null)
  const audioElemsRef = useRef([])
  const transcriptEndRef = useRef(null)

  useEffect(() => {
    let timer = null, checker = null
    if (status === 'connected') {
      timer = setInterval(() => setCallDuration(p => p + 1), 1000)
      checker = setInterval(() => {
        const room = roomRef.current
        if (!room) return
        if (room.state === 'disconnected' || room.state === 'failed') resetUI()
      }, 2000)
    } else setCallDuration(0)
    return () => { clearInterval(timer); clearInterval(checker) }
  }, [status])

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [transcript])

  function formatTime(s) {
    return `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`
  }

  function cleanupAudio() {
    audioElemsRef.current.forEach(el => {
      el.pause(); el.srcObject = null; el.src = ''
      if (el.parentNode) el.parentNode.removeChild(el)
    })
    audioElemsRef.current = []
  }

  function resetUI() {
    cleanupAudio()
    setStatus('idle'); setAgentSpeaking(false)
    setCallDuration(0); setTranscript([]); setShowTranscript(false)
    roomRef.current = null
  }

  function addMessage(role, text) {
    if (!text?.trim()) return
    setTranscript(prev => {
      const last = prev[prev.length - 1]
      if (last?.role === role)
        return [...prev.slice(0, -1), { ...last, text: last.text + ' ' + text.trim() }]
      return [...prev, { role, text: text.trim(), id: Date.now() + Math.random() }]
    })
  }

  async function startCall() {
    setStatus('connecting'); setTranscript([])
    try {
      const room = new Room({ reconnectPolicy: { nextRetryDelayInMs: () => null } })
      roomRef.current = room
      room.on(RoomEvent.Disconnected, () => setTimeout(() => resetUI(), 500))
      room.on(RoomEvent.Connected, () => setStatus('connected'))
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
          const content = msg?.text || msg?.transcript || ''
          if (content) addMessage(participant?.identity !== 'customer-1' ? 'agent' : 'user', content)
        } catch {}
      })
      const res = await fetch(`${import.meta.env.VITE_TOKEN_SERVER_URL}/token`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }
      })
      const { token, url } = await res.json()
      await room.connect(url, token)
      await room.localParticipant.publishTrack(await createLocalAudioTrack())
    } catch (e) { console.error(e); resetUI() }
  }

  async function endCall() {
    const room = roomRef.current; roomRef.current = null
    resetUI(); if (room) await room.disconnect()
  }

  const isIdle = status === 'idle'
  const isConnecting = status === 'connecting'
  const isConnected = status === 'connected'

  return (
    <div className="root">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant:ital,wght@0,300;0,400;0,600;1,300;1,400;1,600&family=Tenor+Sans&family=Jost:wght@200;300;400&display=swap');

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html, body { background: #060606; height: 100%; }

        .root {
          min-height: 100vh; width: 100%;
          background: radial-gradient(ellipse 80% 60% at 50% 50%, #0e0c09 0%, #060606 100%);
          display: flex; flex-direction: column;
          align-items: center; justify-content: center;
          position: relative; overflow: hidden;
          font-family: 'Jost', sans-serif;
        }

        .frame-h {
          position: fixed; left: 0; right: 0; height: 1px;
          background: linear-gradient(90deg, transparent 5%, rgba(180,140,50,0.18) 30%, rgba(200,165,70,0.35) 50%, rgba(180,140,50,0.18) 70%, transparent 95%);
          pointer-events: none; z-index: 5;
        }
        .frame-h.top { top: 0; }
        .frame-h.bottom { bottom: 0; }
        .frame-v {
          position: fixed; top: 0; bottom: 0; width: 1px;
          background: linear-gradient(180deg, transparent 5%, rgba(180,140,50,0.12) 30%, rgba(200,165,70,0.2) 50%, rgba(180,140,50,0.12) 70%, transparent 95%);
          pointer-events: none; z-index: 5;
        }
        .frame-v.left { left: 0; }
        .frame-v.right { right: 0; }

        .crn { position: fixed; width: 32px; height: 32px; z-index: 5; pointer-events: none; }
        .crn::before, .crn::after { content: ''; position: absolute; background: rgba(200,165,70,0.55); }
        .crn::before { width: 1px; height: 100%; top: 0; }
        .crn::after  { height: 1px; width: 100%; left: 0; }
        .crn.tl { top: 24px; left: 24px; }
        .crn.tr { top: 24px; right: 24px; transform: scaleX(-1); }
        .crn.bl { bottom: 24px; left: 24px; transform: scaleY(-1); }
        .crn.br { bottom: 24px; right: 24px; transform: scale(-1); }

        .topbar {
          position: fixed; top: 0; left: 0; right: 0;
          padding: 20px 56px;
          display: flex; justify-content: space-between; align-items: center;
          z-index: 10; pointer-events: none;
        }
        .topbar span { font-size: 9px; letter-spacing: 0.38em; text-transform: uppercase; font-weight: 300; }
        .topbar .left { color: rgba(200,165,70,0.45); }
        .topbar .right { color: rgba(255,255,255,0.1); }

        .gold-text {
          background: linear-gradient(135deg,
            #8B6914 0%, #C9A84C 20%, #F0D060 38%,
            #FFE87A 50%, #F0D060 62%, #C9A84C 80%, #8B6914 100%
          );
          background-size: 300% auto;
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          animation: goldShimmer 5s linear infinite;
        }
        @keyframes goldShimmer {
          0%   { background-position: 0% center; }
          100% { background-position: 300% center; }
        }

        .main {
          position: relative; z-index: 2;
          display: flex; flex-direction: column;
          align-items: center; width: 100%;
          max-width: 700px; padding: 0 32px;
        }

        .orn { display: flex; align-items: center; gap: 10px; margin-bottom: 28px; }
        .orn-line { height: 1px; width: 52px; background: linear-gradient(90deg, transparent, rgba(200,165,70,0.4)); }
        .orn-line.r { background: linear-gradient(270deg, transparent, rgba(200,165,70,0.4)); }
        .orn-diamond {
          width: 6px; height: 6px;
          background: linear-gradient(135deg, #C9A84C, #FFE87A);
          transform: rotate(45deg); flex-shrink: 0;
          box-shadow: 0 0 8px rgba(200,165,70,0.4);
        }
        .orn-dot { width: 2px; height: 2px; background: rgba(200,165,70,0.4); transform: rotate(45deg); flex-shrink: 0; }

        .eyebrow {
          font-size: 10px; letter-spacing: 0.45em;
          text-transform: uppercase; font-weight: 300;
          color: rgba(200,165,70,0.45);
          margin-bottom: 20px; text-align: center;
        }

        .title-wrap { text-align: center; margin-bottom: 8px; }
        .title-line1 {
          font-family: 'Cormorant', serif;
          font-size: clamp(54px, 8vw, 96px);
          font-weight: 300; letter-spacing: 0.04em;
          line-height: 0.95; display: block;
        }
        .title-line2 {
          font-family: 'Cormorant', serif;
          font-size: clamp(54px, 8vw, 96px);
          font-weight: 600; font-style: italic;
          letter-spacing: 0.06em; line-height: 1.0; display: block;
        }
        .title-line3 {
          font-family: 'Cormorant', serif;
          font-size: clamp(36px, 5vw, 62px);
          font-weight: 300; letter-spacing: 0.18em;
          line-height: 1.2; display: block;
          color: rgba(240,230,200,0.45); margin-top: 4px;
        }

        .subtitle {
          font-size: 10px; letter-spacing: 0.42em;
          text-transform: uppercase; font-weight: 200;
          color: rgba(255,255,255,0.12);
          margin-top: 24px; margin-bottom: 52px; text-align: center;
        }

        .status-row { display: flex; align-items: center; gap: 10px; margin-bottom: 40px; }
        .s-pip { width: 5px; height: 5px; border-radius: 50%; flex-shrink: 0; }
        .s-text { font-size: 10px; letter-spacing: 0.32em; text-transform: uppercase; font-weight: 300; }

        .begin-btn {
          position: relative; cursor: pointer;
          background: transparent; border: none;
          padding: 22px 80px;
          display: flex; flex-direction: column;
          align-items: center; gap: 7px; outline: none;
        }
        .bb-border { position: absolute; inset: 0; border: 1px solid rgba(200,165,70,0.3); transition: border-color 0.4s; }
        .bb-inner  { position: absolute; inset: 4px; border: 1px solid rgba(200,165,70,0.1); transition: border-color 0.4s; }
        .bb-c { position: absolute; width: 10px; height: 10px; pointer-events: none; }
        .bb-c::before, .bb-c::after { content: ''; position: absolute; background: rgba(200,165,70,0.8); transition: background 0.3s; }
        .bb-c::before { width: 1px; height: 100%; }
        .bb-c::after  { width: 100%; height: 1px; }
        .bb-c.tl { top: -1px; left: -1px; }
        .bb-c.tr { top: -1px; right: -1px; transform: scaleX(-1); }
        .bb-c.bl { bottom: -1px; left: -1px; transform: scaleY(-1); }
        .bb-c.br { bottom: -1px; right: -1px; transform: scale(-1); }
        .bb-shimmer { position: absolute; inset: 0; overflow: hidden; }
        .bb-shimmer::after {
          content: ''; position: absolute; top: 0; left: -100%;
          width: 60%; height: 100%;
          background: linear-gradient(105deg, transparent, rgba(200,165,70,0.08), transparent);
          animation: btnSweep 3s ease-in-out infinite;
        }
        @keyframes btnSweep { 0% { left: -80%; } 60% { left: 140%; } 100% { left: 140%; } }
        .bb-label {
          position: relative; font-size: 11px; letter-spacing: 0.45em;
          text-transform: uppercase; font-weight: 300;
          font-family: 'Jost', sans-serif; transition: all 0.3s;
        }
        .bb-sub {
          position: relative; font-size: 9px; letter-spacing: 0.22em;
          text-transform: uppercase; font-weight: 200;
          color: rgba(200,165,70,0.25); font-family: 'Jost', sans-serif; transition: color 0.3s;
        }
        .begin-btn:hover .bb-border { border-color: rgba(200,165,70,0.7); }
        .begin-btn:hover .bb-inner  { border-color: rgba(200,165,70,0.2); }
        .begin-btn:hover .bb-sub    { color: rgba(200,165,70,0.5); }

        .conn-ring {
          width: 64px; height: 64px; border-radius: 50%;
          border: 1px solid rgba(200,165,70,0.1);
          display: flex; align-items: center; justify-content: center; position: relative;
        }
        .conn-ring::before {
          content: ''; position: absolute; inset: -1px; border-radius: 50%;
          border: 1px solid transparent; border-top-color: rgba(200,165,70,0.7);
          animation: spin 1.1s linear infinite;
        }
        .conn-ring::after {
          content: ''; position: absolute; inset: 6px; border-radius: 50%;
          border: 1px solid transparent; border-bottom-color: rgba(200,165,70,0.25);
          animation: spin 1.8s linear infinite reverse;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        .conn-dot {
          width: 6px; height: 6px; border-radius: 50%;
          background: rgba(200,165,70,0.6);
          animation: orbPop 1.1s ease-in-out infinite;
        }
        @keyframes orbPop { 0%,100% { transform: scale(0.6); opacity: 0.3; } 50% { transform: scale(1.2); opacity: 1; } }
        .conn-label { font-size: 10px; letter-spacing: 0.3em; text-transform: uppercase; font-weight: 300; color: rgba(200,165,70,0.35); margin-top: 18px; }

        .voice-section {
          display: flex; flex-direction: column; align-items: center; width: 100%;
          animation: riseIn 0.8s cubic-bezier(0.16,1,0.3,1) forwards;
        }
        @keyframes riseIn { from { opacity: 0; transform: translateY(30px); } to { opacity: 1; transform: translateY(0); } }

        .v-name { font-family: 'Cormorant', serif; font-size: 18px; font-weight: 300; font-style: italic; letter-spacing: 0.14em; color: rgba(240,230,200,0.15); margin-bottom: 24px; }
        .v-timer { font-size: 11px; letter-spacing: 0.5em; font-weight: 200; font-variant-numeric: tabular-nums; color: rgba(255,255,255,0.1); margin-bottom: 48px; }

        .orb-outer { position: relative; width: 160px; height: 160px; margin-bottom: 28px; display: flex; align-items: center; justify-content: center; }
        .orb-r { position: absolute; border-radius: 50%; border: 1px solid rgba(200,165,70,0.08); transition: border-color 0.7s, box-shadow 0.7s; }
        .orb-r.r1 { inset: 0; }
        .orb-r.r2 { inset: 18px; }
        .orb-r.r3 { inset: 36px; }
        .orb-r.r1.on { border-color: rgba(200,165,70,0.3); animation: ring1 2s ease-in-out infinite; box-shadow: 0 0 30px rgba(200,165,70,0.06); }
        .orb-r.r2.on { border-color: rgba(200,165,70,0.2); animation: ring2 2s ease-in-out 0.2s infinite; }
        .orb-r.r3.on { border-color: rgba(200,165,70,0.35); animation: ring3 2s ease-in-out 0.1s infinite; }
        @keyframes ring1 { 0%,100% { transform: scale(1); opacity: 0.3; } 50% { transform: scale(1.06); opacity: 0.9; } }
        @keyframes ring2 { 0%,100% { transform: scale(1); opacity: 0.2; } 50% { transform: scale(1.04); opacity: 0.7; } }
        @keyframes ring3 { 0%,100% { transform: scale(1); opacity: 0.35; } 50% { transform: scale(1.08); opacity: 1; } }

        .orb-core {
          position: absolute; inset: 48px; border-radius: 50%;
          background: radial-gradient(circle at 38% 30%, rgba(220,185,80,0.12), rgba(180,140,50,0.05) 55%, transparent);
          border: 1px solid rgba(200,165,70,0.12);
          display: flex; align-items: center; justify-content: center;
          transition: all 0.7s ease;
        }
        .orb-core.on {
          background: radial-gradient(circle at 38% 30%, rgba(220,185,80,0.28), rgba(180,140,50,0.1) 55%, transparent);
          border-color: rgba(200,165,70,0.5);
          box-shadow: 0 0 40px rgba(200,165,70,0.1), 0 0 12px rgba(200,165,70,0.06), inset 0 0 20px rgba(200,165,70,0.04);
        }

        .bars { display: flex; align-items: center; gap: 3px; height: 28px; }
        .bar { width: 2px; border-radius: 2px; transform-origin: center; transition: opacity 0.5s; background: linear-gradient(180deg, #FFE87A, #C9A84C); }
        .bar.off { opacity: 0.1; transform: scaleY(0.15); }
        .bar.on  { animation: barAnim 0.85s ease-in-out infinite; }
        @keyframes barAnim { 0%,100% { transform: scaleY(0.15); } 50% { transform: scaleY(1); } }

        .v-label { font-size: 10px; letter-spacing: 0.34em; text-transform: uppercase; font-weight: 300; margin-bottom: 40px; transition: color 0.6s; }

        .t-toggle {
          background: none; border: none; cursor: pointer; font-family: 'Jost', sans-serif;
          font-size: 9px; letter-spacing: 0.26em; text-transform: uppercase; font-weight: 300;
          color: rgba(255,255,255,0.1); display: flex; align-items: center; gap: 10px;
          padding: 8px 0; margin-bottom: 14px; transition: color 0.3s;
        }
        .t-toggle:hover { color: rgba(200,165,70,0.4); }
        .tl { width: 24px; height: 1px; background: currentColor; opacity: 0.4; }

        .t-drawer {
          width: 100%; max-height: 240px; overflow-y: auto;
          display: flex; flex-direction: column; gap: 10px;
          border-top: 1px solid rgba(200,165,70,0.06);
          padding-top: 20px; margin-bottom: 36px;
          animation: riseIn 0.3s ease-out;
        }
        .t-drawer::-webkit-scrollbar { width: 1px; }
        .t-drawer::-webkit-scrollbar-thumb { background: rgba(200,165,70,0.15); }

        .msg { display: flex; flex-direction: column; animation: riseIn 0.25s ease-out; }
        .msg.a { align-items: flex-start; }
        .msg.u { align-items: flex-end; }
        .msg-lbl { font-size: 8px; letter-spacing: 0.22em; text-transform: uppercase; font-weight: 300; color: rgba(200,165,70,0.3); margin-bottom: 4px; padding: 0 4px; }
        .msg-txt { font-size: 13.5px; line-height: 1.65; font-weight: 300; padding: 10px 14px; max-width: 86%; border-radius: 1px; font-family: 'Cormorant', serif; letter-spacing: 0.01em; }
        .msg.a .msg-txt { color: rgba(240,230,200,0.6); background: rgba(255,255,255,0.02); border-left: 1px solid rgba(200,165,70,0.2); }
        .msg.u .msg-txt { color: rgba(200,165,70,0.65); background: rgba(200,165,70,0.04); border-right: 1px solid rgba(200,165,70,0.15); }

        .end-btn {
          background: none; border: none; cursor: pointer; font-family: 'Jost', sans-serif;
          font-size: 9px; letter-spacing: 0.4em; text-transform: uppercase; font-weight: 300;
          color: rgba(160,70,70,0.28); padding: 12px 28px; position: relative; transition: color 0.3s;
        }
        .end-btn::after {
          content: ''; position: absolute; bottom: 5px; left: 50%; transform: translateX(-50%);
          width: 0; height: 1px; background: rgba(180,80,80,0.4); transition: width 0.35s ease;
        }
        .end-btn:hover { color: rgba(200,100,100,0.6); }
        .end-btn:hover::after { width: 52%; }

        .footer {
          position: fixed; bottom: 34px; left: 50%; transform: translateX(-50%);
          font-size: 9px; letter-spacing: 0.22em; color: rgba(255,255,255,0.04);
          text-transform: uppercase; font-weight: 200; white-space: nowrap; pointer-events: none; z-index: 2;
        }
      `}</style>

      <ParticleCanvas active={agentSpeaking} />

      <div className="frame-h top" /><div className="frame-h bottom" />
      <div className="frame-v left" /><div className="frame-v right" />
      <div className="crn tl" /><div className="crn tr" />
      <div className="crn bl" /><div className="crn br" />

      <div className="topbar">
        <span className="left">Peppers</span>
        <span className="right">Est. Tamilnadu</span>
      </div>

      <div className="main">
        {(isIdle || isConnecting) && (
          <>
            <div className="orn">
              <div className="orn-line" /><div className="orn-dot" />
              <div className="orn-diamond" />
              <div className="orn-dot" /><div className="orn-line r" />
            </div>
            <p className="eyebrow">Fine Dining · Tamilnadu</p>
            <div className="title-wrap">
              <span className="title-line1 gold-text">Peppers</span>
              <span className="title-line2 gold-text">Family</span>
              <span className="title-line3">Restaurant</span>
            </div>
            <p className="subtitle">Voice Order System</p>
          </>
        )}

        {isIdle && (
          <>
            <div className="status-row">
              <div className="s-pip" style={{ background: 'rgba(255,255,255,0.1)' }} />
              <span className="s-text" style={{ color: 'rgba(255,255,255,0.1)' }}>Not Connected</span>
            </div>
            <button className="begin-btn" onClick={startCall}>
              <div className="bb-border" /><div className="bb-inner" />
              <div className="bb-c tl" /><div className="bb-c tr" />
              <div className="bb-c bl" /><div className="bb-c br" />
              <div className="bb-shimmer" />
              <span className="bb-label gold-text">Begin Your Order</span>
              <span className="bb-sub">Speak with Priya</span>
            </button>
          </>
        )}

        {isConnecting && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div className="status-row">
              <span className="s-text" style={{ color: 'rgba(200,165,70,0.35)' }}>Connecting</span>
            </div>
            <div className="conn-ring"><div className="conn-dot" /></div>
            <p className="conn-label">Preparing your experience</p>
          </div>
        )}

        {isConnected && (
          <div className="voice-section">
            <p className="v-name">Peppers</p>
            <p className="v-timer">{formatTime(callDuration)}</p>
            <div className="orb-outer">
              <div className={`orb-r r1 ${agentSpeaking ? 'on' : ''}`} />
              <div className={`orb-r r2 ${agentSpeaking ? 'on' : ''}`} />
              <div className={`orb-r r3 ${agentSpeaking ? 'on' : ''}`} />
              <div className={`orb-core ${agentSpeaking ? 'on' : ''}`}>
                <div className="bars">
                  {[1,2,4,6,9,11,9,6,4,2,1].map((h, i) => (
                    <div key={i} className={`bar ${agentSpeaking ? 'on' : 'off'}`}
                      style={{ height: `${h * 2.2}px`, animationDelay: agentSpeaking ? `${i * 0.08}s` : '0s' }} />
                  ))}
                </div>
              </div>
            </div>
            <p className="v-label" style={{ color: agentSpeaking ? 'rgba(200,165,70,0.6)' : 'rgba(255,255,255,0.14)' }}>
              {agentSpeaking ? 'Priya is speaking' : 'Listening'}
            </p>
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
                    {msg.role === 'agent' && <span className="msg-lbl">Priya</span>}
                    <div className="msg-txt">{msg.text}</div>
                  </div>
                ))}
                <div ref={transcriptEndRef} />
              </div>
            )}
            <button className="end-btn" onClick={endCall}>End Call</button>
          </div>
        )}
      </div>

      <p className="footer">Powered by AI &nbsp;·&nbsp; Available 24 / 7</p>
    </div>
  )
}