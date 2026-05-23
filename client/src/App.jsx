import { useState, useEffect, useRef } from 'react'
import { Room, RoomEvent, createLocalAudioTrack, Track, ParticipantEvent } from 'livekit-client'

export default function App() {
  const [status, setStatus] = useState('idle')
  const [agentSpeaking, setAgentSpeaking] = useState(false)
  const [callDuration, setCallDuration] = useState(0)
  const [transcript, setTranscript] = useState([])
  const [showTranscript, setShowTranscript] = useState(false)
  const roomRef = useRef(null)
  const audioElemsRef = useRef([])
  const transcriptEndRef = useRef(null)
  const canvasRef = useRef(null)
  const animRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    let W, H, t = 0

    const resize = () => {
      W = canvas.width = window.innerWidth
      H = canvas.height = window.innerHeight
    }
    resize()
    window.addEventListener('resize', resize)

    const draw = () => {
      t += 0.003
      ctx.clearRect(0, 0, W, H)

      ctx.fillStyle = '#050A18'
      ctx.fillRect(0, 0, W, H)

      const orbs = [
        { x: W * 0.5 + Math.sin(t * 0.7) * W * 0.12, y: H * 0.45 + Math.cos(t * 0.5) * H * 0.08, r: W * 0.38, c1: 'rgba(30,60,140,0.18)', c2: 'rgba(10,20,60,0)' },
        { x: W * 0.3 + Math.cos(t * 0.4) * W * 0.08, y: H * 0.55 + Math.sin(t * 0.6) * H * 0.1,  r: W * 0.28, c1: 'rgba(80,120,200,0.08)', c2: 'rgba(0,0,0,0)' },
        { x: W * 0.7 + Math.sin(t * 0.5) * W * 0.06, y: H * 0.4  + Math.cos(t * 0.8) * H * 0.07, r: W * 0.22, c1: 'rgba(140,160,220,0.06)', c2: 'rgba(0,0,0,0)' },
      ]
      orbs.forEach(o => {
        const g = ctx.createRadialGradient(o.x, o.y, 0, o.x, o.y, o.r)
        g.addColorStop(0, o.c1); g.addColorStop(1, o.c2)
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)
      })

      if (!canvas._stars) {
        canvas._stars = Array.from({ length: 120 }, () => ({
          x: Math.random() * W, y: Math.random() * H,
          r: Math.random() * 0.8 + 0.1,
          a: Math.random() * 0.5 + 0.1,
          sp: Math.random() * 0.02 + 0.005,
          ph: Math.random() * Math.PI * 2,
        }))
      }
      canvas._stars.forEach(s => {
        s.ph += s.sp
        const alpha = s.a * (0.5 + 0.5 * Math.sin(s.ph))
        ctx.beginPath()
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(200,210,255,${alpha})`
        ctx.fill()
      })

      animRef.current = requestAnimationFrame(draw)
    }
    draw()
    return () => { cancelAnimationFrame(animRef.current); window.removeEventListener('resize', resize) }
  }, [])

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

  function resetUI() {
    cleanupAudio(); setStatus('idle'); setAgentSpeaking(false)
    setCallDuration(0); setTranscript([]); setShowTranscript(false); roomRef.current = null
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
          const c = msg?.text || msg?.transcript || ''
          if (c) addMessage(participant?.identity !== 'customer-1' ? 'agent' : 'user', c)
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
    const room = roomRef.current; roomRef.current = null; resetUI()
    if (room) await room.disconnect()
  }

  const isIdle = status === 'idle'
  const isConnecting = status === 'connecting'
  const isConnected = status === 'connected'

  return (
    <div className="root">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Sans:wght@200;300;400;500&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html, body { background: #050A18; height: 100%; overflow: hidden; }

        .root {
          min-height: 100vh; width: 100%;
          display: flex; flex-direction: column;
          align-items: center; justify-content: center;
          position: relative; overflow: hidden;
          font-family: 'DM Sans', sans-serif;
        }

        .nav {
          position: fixed; top: 0; left: 0; right: 0;
          padding: 28px 48px;
          display: flex; justify-content: space-between; align-items: center;
          z-index: 20;
        }
        .nav-logo {
          font-family: 'DM Serif Display', serif;
          font-size: 15px; letter-spacing: 0.12em;
          color: rgba(255,255,255,0.9); font-weight: 400;
        }
        .nav-logo span { color: #7EB3FF; }
        .nav-tag {
          font-size: 10px; letter-spacing: 0.3em; text-transform: uppercase;
          color: rgba(255,255,255,0.25); font-weight: 300;
        }
        .nav-line {
          position: absolute; bottom: 0; left: 48px; right: 48px; height: 1px;
          background: linear-gradient(90deg, transparent, rgba(126,179,255,0.15), rgba(255,255,255,0.08), rgba(126,179,255,0.15), transparent);
        }

        .main {
          position: relative; z-index: 2;
          display: flex; flex-direction: column;
          align-items: center; width: 100%; padding: 0 24px;
        }

        .ring-system {
          position: relative;
          display: flex; align-items: center; justify-content: center;
          margin-bottom: 40px;
        }

        .ring-outer {
          position: absolute; border-radius: 50%;
          border: 1px solid transparent; pointer-events: none;
        }
        .ring-d1 {
          width: 380px; height: 380px;
          border-color: rgba(126,179,255,0.08);
          animation: rotateSlow 40s linear infinite;
        }
        .ring-d1::before {
          content: ''; position: absolute; top: -3px; left: 50%;
          width: 6px; height: 6px; border-radius: 50%;
          background: rgba(126,179,255,0.5); transform: translateX(-50%);
          box-shadow: 0 0 8px rgba(126,179,255,0.8);
        }
        .ring-d2 {
          width: 320px; height: 320px;
          border-color: rgba(200,215,255,0.06);
          animation: rotateSlow 28s linear infinite reverse;
        }
        .ring-d2::before {
          content: ''; position: absolute; bottom: -3px; left: 50%;
          width: 4px; height: 4px; border-radius: 50%;
          background: rgba(200,215,255,0.4); transform: translateX(-50%);
          box-shadow: 0 0 6px rgba(200,215,255,0.6);
        }
        .ring-d3 {
          width: 440px; height: 440px; border: none;
          background: radial-gradient(circle, transparent 45%, rgba(126,179,255,0.03) 50%, transparent 55%);
        }
        @keyframes rotateSlow { to { transform: rotate(360deg); } }

        .ring-ticks {
          position: absolute; width: 380px; height: 380px;
          border-radius: 50%; pointer-events: none;
        }
        .tick {
          position: absolute; width: 1px; height: 8px;
          background: rgba(126,179,255,0.15);
          left: 50%; top: 0;
          transform-origin: 50% 190px;
        }
        .tick.major { height: 14px; background: rgba(126,179,255,0.35); width: 1.5px; }

        .ring-glow {
          position: absolute; width: 270px; height: 270px;
          border-radius: 50%; border: 1px solid rgba(126,179,255,0.12);
          transition: all 0.8s ease; pointer-events: none;
        }
        .ring-glow.speaking {
          border-color: rgba(126,179,255,0.5);
          box-shadow: 0 0 60px rgba(80,140,255,0.15), 0 0 120px rgba(80,140,255,0.08), inset 0 0 60px rgba(80,140,255,0.05);
          animation: glowPulse 2s ease-in-out infinite;
        }
        @keyframes glowPulse {
          0%,100% { box-shadow: 0 0 40px rgba(80,140,255,0.12), 0 0 80px rgba(80,140,255,0.06); }
          50%      { box-shadow: 0 0 80px rgba(80,140,255,0.25), 0 0 160px rgba(80,140,255,0.12); }
        }

        .center-orb {
          position: relative; width: 200px; height: 200px;
          border-radius: 50%;
          display: flex; flex-direction: column;
          align-items: center; justify-content: center;
          cursor: pointer; z-index: 5;
          transition: transform 0.3s ease;
        }
        .center-orb:hover { transform: scale(1.03); }
        .center-orb:active { transform: scale(0.97); }

        .orb-bg {
          position: absolute; inset: 0; border-radius: 50%;
          background: radial-gradient(circle at 40% 35%,
            rgba(80,120,220,0.35) 0%, rgba(30,60,140,0.6) 40%, rgba(10,20,70,0.85) 100%
          );
          border: 1px solid rgba(126,179,255,0.25);
          transition: all 0.6s ease;
        }
        .center-orb.speaking .orb-bg {
          background: radial-gradient(circle at 40% 35%,
            rgba(100,160,255,0.45) 0%, rgba(50,100,200,0.7) 40%, rgba(15,35,100,0.9) 100%
          );
          border-color: rgba(126,179,255,0.6);
          box-shadow: 0 0 50px rgba(80,140,255,0.2), inset 0 0 30px rgba(80,140,255,0.08);
        }
        .orb-shine {
          position: absolute; width: 60%; height: 45%; top: 8%; left: 20%;
          border-radius: 50%;
          background: radial-gradient(ellipse, rgba(200,220,255,0.12) 0%, transparent 70%);
          pointer-events: none;
        }

        .orb-content { position: relative; text-align: center; z-index: 2; padding: 16px; }
        .orb-icon { font-size: 22px; margin-bottom: 8px; }
        .orb-main-text {
          font-family: 'DM Serif Display', serif;
          font-size: 18px; letter-spacing: 0.04em;
          color: rgba(255,255,255,0.95); line-height: 1.25;
        }
        .orb-sub-text {
          font-size: 10px; letter-spacing: 0.22em; text-transform: uppercase;
          font-weight: 300; color: rgba(126,179,255,0.55); margin-top: 7px;
        }

        .orb-bars {
          display: flex; align-items: center; justify-content: center;
          gap: 3px; height: 32px; margin-bottom: 8px;
        }
        .obar {
          width: 2.5px; border-radius: 2px; transform-origin: center;
          background: linear-gradient(180deg, rgba(200,220,255,0.9), rgba(126,179,255,0.5));
        }
        .obar.off { height: 4px; opacity: 0.2; }
        .obar.on { animation: obarWave 0.75s ease-in-out infinite; }
        @keyframes obarWave { 0%,100% { transform: scaleY(0.15); } 50% { transform: scaleY(1); } }

        .orb-timer {
          font-size: 22px; letter-spacing: 0.12em; font-weight: 200;
          font-variant-numeric: tabular-nums; color: rgba(255,255,255,0.9); margin-bottom: 6px;
        }
        .orb-status { font-size: 10px; letter-spacing: 0.28em; text-transform: uppercase; font-weight: 300; transition: color 0.5s; }

        .orb-spinner {
          width: 32px; height: 32px; border-radius: 50%;
          border: 1.5px solid rgba(126,179,255,0.15);
          border-top-color: rgba(126,179,255,0.8);
          animation: spin 1s linear infinite; margin-bottom: 10px;
        }
        @keyframes spin { to { transform: rotate(360deg); } }

        .title-section { text-align: center; margin-bottom: 28px; }
        .title-eyebrow {
          font-size: 10px; letter-spacing: 0.5em; text-transform: uppercase;
          font-weight: 300; color: rgba(126,179,255,0.45); margin-bottom: 14px;
        }
        .title-main {
          font-family: 'DM Serif Display', serif;
          font-size: clamp(36px, 5vw, 66px);
          color: #FFFFFF; letter-spacing: 0.02em; line-height: 1.05; font-weight: 400;
        }
        .title-main em { font-style: italic; color: #7EB3FF; }
        .title-sub {
          font-size: 11px; letter-spacing: 0.38em; text-transform: uppercase;
          font-weight: 300; color: rgba(255,255,255,0.2); margin-top: 14px;
        }

        .connected-title { text-align: center; margin-bottom: 20px; animation: fadeIn 0.6s ease; }
        .connected-title h2 {
          font-family: 'DM Serif Display', serif;
          font-size: 24px; color: rgba(255,255,255,0.7);
          letter-spacing: 0.08em; font-weight: 400;
        }
        .connected-title h2 em { font-style: italic; color: #7EB3FF; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(-10px); } to { opacity: 1; transform: translateY(0); } }

        .bottom-panel { width: 100%; max-width: 520px; display: flex; flex-direction: column; align-items: center; }

        .status-badge {
          display: inline-flex; align-items: center; gap: 8px;
          padding: 6px 18px; border-radius: 20px;
          border: 1px solid rgba(126,179,255,0.12);
          background: rgba(126,179,255,0.04); margin-bottom: 28px;
        }
        .badge-dot { width: 5px; height: 5px; border-radius: 50%; flex-shrink: 0; }
        .badge-text { font-size: 10px; letter-spacing: 0.28em; text-transform: uppercase; font-weight: 300; }

        .t-toggle {
          background: none; border: none; cursor: pointer;
          font-family: 'DM Sans', sans-serif; font-size: 10px; letter-spacing: 0.22em;
          text-transform: uppercase; font-weight: 300; color: rgba(126,179,255,0.3);
          display: flex; align-items: center; gap: 10px;
          padding: 8px 0; margin-bottom: 12px; transition: color 0.3s;
        }
        .t-toggle:hover { color: rgba(126,179,255,0.65); }
        .tl { width: 28px; height: 1px; background: currentColor; opacity: 0.5; }

        .t-drawer {
          width: 100%; max-height: 200px; overflow-y: auto;
          display: flex; flex-direction: column; gap: 8px;
          border-top: 1px solid rgba(126,179,255,0.08);
          padding-top: 16px; margin-bottom: 24px; animation: fadeIn 0.3s ease;
        }
        .t-drawer::-webkit-scrollbar { width: 1px; }
        .t-drawer::-webkit-scrollbar-thumb { background: rgba(126,179,255,0.2); }

        .msg { display: flex; flex-direction: column; animation: fadeIn 0.2s ease; }
        .msg.a { align-items: flex-start; }
        .msg.u { align-items: flex-end; }
        .msg-lbl {
          font-size: 8px; letter-spacing: 0.22em; text-transform: uppercase;
          font-weight: 400; color: rgba(126,179,255,0.35); margin-bottom: 3px; padding: 0 4px;
        }
        .msg-txt {
          font-size: 13px; line-height: 1.6; font-weight: 300;
          padding: 9px 14px; max-width: 85%;
        }
        .msg.a .msg-txt {
          color: rgba(220,230,255,0.85);
          background: rgba(126,179,255,0.07);
          border: 1px solid rgba(126,179,255,0.12);
          border-radius: 0 10px 10px 10px;
        }
        .msg.u .msg-txt {
          color: rgba(255,255,255,0.75);
          background: rgba(255,255,255,0.05);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 10px 0 10px 10px;
        }

        .end-btn {
          background: none; border: 1px solid rgba(220,80,80,0.2);
          cursor: pointer; font-family: 'DM Sans', sans-serif;
          font-size: 10px; letter-spacing: 0.35em; text-transform: uppercase;
          font-weight: 300; color: rgba(220,100,100,0.35);
          padding: 10px 32px; border-radius: 2px; transition: all 0.3s ease;
        }
        .end-btn:hover {
          color: rgba(240,120,120,0.7);
          border-color: rgba(220,80,80,0.45);
          background: rgba(220,80,80,0.04);
        }

        .footer {
          position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
          font-size: 9px; letter-spacing: 0.22em; text-transform: uppercase;
          font-weight: 300; color: rgba(126,179,255,0.12);
          white-space: nowrap; pointer-events: none; z-index: 2;
        }

        .side-label {
          position: fixed; top: 50%; writing-mode: vertical-rl;
          font-size: 9px; letter-spacing: 0.3em; text-transform: uppercase;
          font-weight: 300; color: rgba(255,255,255,0.06); transform: translateY(-50%);
        }
        .side-label.left { left: 24px; transform: translateY(-50%) rotate(180deg); }
        .side-label.right { right: 24px; }
      `}</style>

      <canvas ref={canvasRef} style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 0 }} />

      <nav className="nav">
        <div className="nav-logo">PEPPERS <span>·</span> FAMILY</div>
        <div className="nav-tag">Est. Tamilnadu</div>
        <div className="nav-line" />
      </nav>

      <span className="side-label left">Fine Dining</span>
      <span className="side-label right">Voice Order</span>

      <div className="main">

        {(isIdle || isConnecting) && (
          <div className="title-section">
            <p className="title-eyebrow">Michelin Inspired · Tamilnadu</p>
            <h1 className="title-main">The <em>Peppers</em><br />Experience</h1>
            <p className="title-sub">Voice Order System</p>
          </div>
        )}

        {isConnected && (
          <div className="connected-title">
            <h2>Speaking with <em>Priya</em></h2>
          </div>
        )}

        <div className="ring-system">
          <div className="ring-outer ring-d3" />
          <div className="ring-outer ring-d1" />
          <div className="ring-outer ring-d2" />

          <div className="ring-ticks">
            {Array.from({ length: 60 }, (_, i) => (
              <div key={i} className={`tick ${i % 5 === 0 ? 'major' : ''}`}
                style={{ transform: `rotate(${i * 6}deg) translateX(-50%)` }} />
            ))}
          </div>

          <div className={`ring-glow ${agentSpeaking ? 'speaking' : ''}`} />

          {isIdle && (
            <div className="center-orb" onClick={startCall}>
              <div className="orb-bg" /><div className="orb-shine" />
              <div className="orb-content">
                <div className="orb-icon">🎙️</div>
                <p className="orb-main-text">Begin<br />Order</p>
                <p className="orb-sub-text">Tap to start</p>
              </div>
            </div>
          )}

          {isConnecting && (
            <div className="center-orb" style={{ cursor: 'default' }}>
              <div className="orb-bg" /><div className="orb-shine" />
              <div className="orb-content">
                <div className="orb-spinner" />
                <p className="orb-sub-text">Connecting...</p>
              </div>
            </div>
          )}

          {isConnected && (
            <div className={`center-orb ${agentSpeaking ? 'speaking' : ''}`} style={{ cursor: 'default' }}>
              <div className="orb-bg" /><div className="orb-shine" />
              <div className="orb-content">
                <div className="orb-bars">
                  {[1,2,4,6,9,11,9,6,4,2,1].map((h, i) => (
                    <div key={i} className={`obar ${agentSpeaking ? 'on' : 'off'}`}
                      style={{ height: `${h * 2.5}px`, animationDelay: `${i * 0.08}s` }} />
                  ))}
                </div>
                <p className="orb-timer">{formatTime(callDuration)}</p>
                <p className="orb-status" style={{ color: agentSpeaking ? 'rgba(126,179,255,0.8)' : 'rgba(255,255,255,0.3)' }}>
                  {agentSpeaking ? 'Priya speaking' : 'Listening'}
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="bottom-panel">
          {!isConnected && (
            <div className="status-badge">
              <div className="badge-dot" style={{
                background: isConnecting ? '#7EB3FF' : 'rgba(255,255,255,0.2)',
                boxShadow: isConnecting ? '0 0 6px #7EB3FF' : 'none',
                animation: isConnecting ? 'glowPulse 1s ease-in-out infinite' : 'none',
              }} />
              <span className="badge-text" style={{ color: isConnecting ? 'rgba(126,179,255,0.6)' : 'rgba(255,255,255,0.2)' }}>
                {isConnecting ? 'Connecting' : 'Not Connected'}
              </span>
            </div>
          )}

          {isConnected && transcript.length > 0 && (
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

          {isConnected && (
            <button className="end-btn" onClick={endCall}>End Call</button>
          )}
        </div>
      </div>

      <p className="footer">Powered by AI &nbsp;·&nbsp; Available 24 / 7</p>
    </div>
  )
}