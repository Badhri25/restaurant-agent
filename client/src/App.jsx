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

  useEffect(() => {
    let timer = null, checker = null
    if (status === 'connected') {
      timer = setInterval(() => setCallDuration(p => p + 1), 1000)
      checker = setInterval(() => {
        const room = roomRef.current
        if (!room) return
        if (room.state === 'disconnected' || room.state === 'failed') resetUI()
      }, 2000)
    } else {
      setCallDuration(0)
    }
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
    setStatus('idle')
    setAgentSpeaking(false)
    setCallDuration(0)
    setTranscript([])
    setShowTranscript(false)
    roomRef.current = null
  }

  function addMessage(role, text) {
    if (!text || !text.trim()) return
    setTranscript(prev => {
      const last = prev[prev.length - 1]
      if (last && last.role === role)
        return [...prev.slice(0, -1), { ...last, text: last.text + ' ' + text.trim() }]
      return [...prev, { role, text: text.trim(), id: Date.now() + Math.random() }]
    })
  }

  async function startCall() {
    setStatus('connecting')
    setTranscript([])
    try {
      const room = new Room({ reconnectPolicy: { nextRetryDelayInMs: () => null } })
      roomRef.current = room
      room.on(RoomEvent.Disconnected, () => setTimeout(() => resetUI(), 500))
      room.on(RoomEvent.Connected, () => setStatus('connected'))
      room.on(RoomEvent.TrackSubscribed, (track, _, participant) => {
        if (track.kind === Track.Kind.Audio) {
          const el = track.attach()
          el.autoplay = true
          document.body.appendChild(el)
          audioElemsRef.current.push(el)
          participant.on(ParticipantEvent.IsSpeakingChanged, s => setAgentSpeaking(s))
        }
      })
      room.on(RoomEvent.TranscriptionReceived, (segments, participant) => {
        segments.forEach(seg => {
          if (!seg.final) return
          const isAgent = participant?.identity !== 'customer-1'
          addMessage(isAgent ? 'agent' : 'user', seg.text)
        })
      })
      room.on(RoomEvent.DataReceived, (payload, participant) => {
        try {
          const msg = JSON.parse(new TextDecoder().decode(payload))
          const content = msg?.text || msg?.transcript || ''
          if (!content) return
          addMessage(participant?.identity !== 'customer-1' ? 'agent' : 'user', content)
        } catch {}
      })
      const res = await fetch(`${import.meta.env.VITE_TOKEN_SERVER_URL}/token`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }
      })
      const { token, url } = await res.json()
      await room.connect(url, token)
      const mic = await createLocalAudioTrack()
      await room.localParticipant.publishTrack(mic)
    } catch (e) {
      console.error(e)
      resetUI()
    }
  }

  async function endCall() {
    const room = roomRef.current
    roomRef.current = null
    resetUI()
    if (room) await room.disconnect()
  }

  const isIdle = status === 'idle'
  const isConnecting = status === 'connecting'
  const isConnected = status === 'connected'

  return (
    <div className="root">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,300;0,400;0,500;1,300;1,400&family=Jost:wght@200;300;400&display=swap');

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        body { background: #080808; }

        .root {
          min-height: 100vh;
          width: 100%;
          background: #080808;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          position: relative;
          overflow: hidden;
          font-family: 'Jost', sans-serif;
        }

        .root::before {
          content: '';
          position: fixed;
          width: 700px; height: 700px;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(180,140,60,0.045) 0%, transparent 65%);
          top: -200px; left: -200px;
          pointer-events: none;
        }
        .root::after {
          content: '';
          position: fixed;
          width: 600px; height: 600px;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(180,140,60,0.03) 0%, transparent 65%);
          bottom: -150px; right: -150px;
          pointer-events: none;
        }

        .frame-line-top, .frame-line-bottom {
          position: fixed;
          left: 48px; right: 48px;
          height: 1px;
          background: linear-gradient(90deg, transparent, rgba(180,140,60,0.25), transparent);
          pointer-events: none;
        }
        .frame-line-top { top: 28px; }
        .frame-line-bottom { bottom: 28px; }

        .corner {
          position: fixed;
          width: 20px; height: 20px;
          pointer-events: none;
        }
        .corner::before {
          content: '';
          position: absolute;
          width: 1px; height: 100%;
          background: rgba(180,140,60,0.35);
        }
        .corner::after {
          content: '';
          position: absolute;
          width: 100%; height: 1px;
          background: rgba(180,140,60,0.35);
        }
        .c-tl { top: 20px; left: 40px; }
        .c-tr { top: 20px; right: 40px; transform: scaleX(-1); }
        .c-bl { bottom: 20px; left: 40px; transform: scaleY(-1); }
        .c-br { bottom: 20px; right: 40px; transform: scale(-1); }

        .top-bar {
          position: fixed;
          top: 0; left: 0; right: 0;
          padding: 24px 64px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          z-index: 10;
        }
        .top-bar-left {
          font-size: 10px;
          letter-spacing: 0.3em;
          color: rgba(180,140,60,0.4);
          font-weight: 300;
          text-transform: uppercase;
        }
        .top-bar-right {
          font-size: 10px;
          letter-spacing: 0.3em;
          color: rgba(255,255,255,0.1);
          font-weight: 300;
          text-transform: uppercase;
        }

        .main {
          display: flex;
          flex-direction: column;
          align-items: center;
          width: 100%;
          max-width: 580px;
          padding: 0 32px;
          position: relative;
          z-index: 1;
        }

        .ornament {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 24px;
        }
        .orn-line {
          width: 44px; height: 1px;
          background: linear-gradient(90deg, transparent, rgba(180,140,60,0.45));
        }
        .orn-line.r {
          background: linear-gradient(270deg, transparent, rgba(180,140,60,0.45));
        }
        .orn-diamond {
          width: 5px; height: 5px;
          background: rgba(180,140,60,0.65);
          transform: rotate(45deg);
          flex-shrink: 0;
        }
        .orn-dot {
          width: 2px; height: 2px;
          background: rgba(180,140,60,0.35);
          transform: rotate(45deg);
          flex-shrink: 0;
        }

        .restaurant-eyebrow {
          font-size: 10px;
          letter-spacing: 0.42em;
          color: rgba(180,140,60,0.5);
          font-weight: 300;
          text-transform: uppercase;
          margin-bottom: 18px;
          text-align: center;
        }

        .restaurant-title {
          font-family: 'Playfair Display', serif;
          font-size: clamp(42px, 6.5vw, 68px);
          font-weight: 300;
          color: #F5EED8;
          letter-spacing: 0.04em;
          line-height: 1.05;
          text-align: center;
          margin-bottom: 4px;
        }
        .restaurant-title em {
          font-style: italic;
          color: #C9A84C;
          font-weight: 300;
        }

        .restaurant-subtitle {
          font-size: 10px;
          letter-spacing: 0.38em;
          color: rgba(255,255,255,0.15);
          font-weight: 200;
          text-transform: uppercase;
          text-align: center;
          margin-top: 22px;
          margin-bottom: 48px;
        }

        .status-line {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 44px;
        }
        .status-pip {
          width: 5px; height: 5px;
          border-radius: 50%;
          flex-shrink: 0;
        }
        .status-text {
          font-size: 10px;
          letter-spacing: 0.3em;
          text-transform: uppercase;
          font-weight: 300;
        }

        .begin-btn {
          position: relative;
          padding: 20px 72px;
          background: transparent;
          border: none;
          cursor: pointer;
          outline: none;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
        }
        .begin-btn-border {
          position: absolute;
          inset: 0;
          border: 1px solid rgba(180,140,60,0.4);
          transition: border-color 0.4s;
        }
        .begin-btn-corner {
          position: absolute;
          width: 8px; height: 8px;
        }
        .begin-btn-corner::before, .begin-btn-corner::after {
          content: '';
          position: absolute;
          background: rgba(180,140,60,0.7);
        }
        .begin-btn-corner::before { width: 1px; height: 100%; }
        .begin-btn-corner::after { width: 100%; height: 1px; }
        .bc-tl { top: -1px; left: -1px; }
        .bc-tr { top: -1px; right: -1px; transform: scaleX(-1); }
        .bc-bl { bottom: -1px; left: -1px; transform: scaleY(-1); }
        .bc-br { bottom: -1px; right: -1px; transform: scale(-1); }

        .begin-btn-shimmer {
          position: absolute;
          inset: 0;
          background: linear-gradient(105deg, transparent 35%, rgba(180,140,60,0.07) 50%, transparent 65%);
          background-size: 300% 100%;
          animation: shimmerMove 3.5s ease-in-out infinite;
        }
        @keyframes shimmerMove {
          0% { background-position: 200% center; }
          100% { background-position: -200% center; }
        }
        .begin-btn-text {
          font-size: 11px;
          letter-spacing: 0.4em;
          color: #C9A84C;
          font-weight: 300;
          text-transform: uppercase;
          position: relative;
          transition: color 0.3s;
        }
        .begin-btn-sub {
          font-size: 9px;
          letter-spacing: 0.22em;
          color: rgba(180,140,60,0.28);
          font-weight: 200;
          text-transform: uppercase;
          position: relative;
          transition: color 0.3s;
        }
        .begin-btn:hover .begin-btn-border { border-color: rgba(180,140,60,0.75); }
        .begin-btn:hover .begin-btn-text { color: #E8D080; }
        .begin-btn:hover .begin-btn-sub { color: rgba(180,140,60,0.5); }

        .connecting-wrap {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 20px;
        }
        .connecting-ring-outer {
          width: 60px; height: 60px;
          border-radius: 50%;
          border: 1px solid rgba(180,140,60,0.12);
          display: flex; align-items: center; justify-content: center;
          position: relative;
        }
        .connecting-ring-outer::before {
          content: '';
          position: absolute;
          inset: -1px;
          border-radius: 50%;
          border: 1px solid transparent;
          border-top-color: rgba(180,140,60,0.65);
          animation: spinRing 1.2s linear infinite;
        }
        @keyframes spinRing { to { transform: rotate(360deg); } }
        .connecting-dot-inner {
          width: 5px; height: 5px;
          border-radius: 50%;
          background: rgba(180,140,60,0.55);
          animation: pulseDot 1.2s ease-in-out infinite;
        }
        @keyframes pulseDot {
          0%, 100% { opacity: 0.3; transform: scale(0.7); }
          50% { opacity: 1; transform: scale(1.3); }
        }
        .connecting-text {
          font-size: 10px;
          letter-spacing: 0.28em;
          color: rgba(180,140,60,0.4);
          font-weight: 300;
          text-transform: uppercase;
        }

        .voice-section {
          display: flex;
          flex-direction: column;
          align-items: center;
          width: 100%;
          animation: fadeUp 0.7s ease-out;
        }
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(24px); }
          to { opacity: 1; transform: translateY(0); }
        }

        .connected-name {
          font-family: 'Playfair Display', serif;
          font-size: 20px;
          font-weight: 300;
          font-style: italic;
          color: rgba(245,238,216,0.18);
          letter-spacing: 0.12em;
          text-align: center;
          margin-bottom: 28px;
        }

        .timer-display {
          font-size: 11px;
          letter-spacing: 0.45em;
          color: rgba(255,255,255,0.1);
          font-weight: 200;
          font-variant-numeric: tabular-nums;
          margin-bottom: 44px;
        }

        .orb-wrap {
          position: relative;
          width: 130px; height: 130px;
          margin-bottom: 32px;
          cursor: default;
        }
        .orb-ring-1 {
          position: absolute;
          inset: 0;
          border-radius: 50%;
          border: 1px solid rgba(180,140,60,0.12);
          transition: border-color 0.6s, transform 0.6s;
        }
        .orb-ring-1.active {
          border-color: rgba(180,140,60,0.35);
          animation: ring1Pulse 1.8s ease-in-out infinite;
        }
        @keyframes ring1Pulse {
          0%, 100% { transform: scale(1); opacity: 0.35; }
          50% { transform: scale(1.07); opacity: 0.8; }
        }
        .orb-ring-2 {
          position: absolute;
          inset: 14px;
          border-radius: 50%;
          border: 1px solid rgba(180,140,60,0.07);
          transition: border-color 0.6s;
        }
        .orb-ring-2.active {
          border-color: rgba(180,140,60,0.22);
          animation: ring2Pulse 1.8s ease-in-out 0.25s infinite;
        }
        @keyframes ring2Pulse {
          0%, 100% { transform: scale(1); opacity: 0.22; }
          50% { transform: scale(1.04); opacity: 0.65; }
        }
        .orb-center {
          position: absolute;
          inset: 28px;
          border-radius: 50%;
          background: radial-gradient(circle at 38% 32%, rgba(200,168,72,0.14), rgba(180,140,60,0.04) 60%, transparent);
          border: 1px solid rgba(180,140,60,0.15);
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.6s ease;
        }
        .orb-center.active {
          background: radial-gradient(circle at 38% 32%, rgba(200,168,72,0.3), rgba(180,140,60,0.1) 60%, transparent);
          border-color: rgba(180,140,60,0.45);
          box-shadow: 0 0 28px rgba(180,140,60,0.08), inset 0 0 20px rgba(180,140,60,0.04);
        }
        .orb-waves {
          display: flex;
          align-items: center;
          gap: 3px;
          height: 26px;
        }
        .orb-bar {
          width: 2px;
          border-radius: 2px;
          background: rgba(180,140,60,0.65);
          transform-origin: center;
        }
        .orb-bar.listening {
          opacity: 0.12;
          transform: scaleY(0.15);
          transition: all 0.4s;
        }
        .orb-bar.speaking {
          animation: barWave 0.85s ease-in-out infinite;
        }
        @keyframes barWave {
          0%, 100% { transform: scaleY(0.15); }
          50% { transform: scaleY(1); }
        }

        .voice-label {
          font-size: 10px;
          letter-spacing: 0.32em;
          text-transform: uppercase;
          font-weight: 300;
          margin-bottom: 40px;
          transition: color 0.5s;
        }

        .transcript-toggle {
          font-size: 9px;
          letter-spacing: 0.25em;
          text-transform: uppercase;
          color: rgba(255,255,255,0.12);
          background: none;
          border: none;
          cursor: pointer;
          font-family: 'Jost', sans-serif;
          font-weight: 300;
          padding: 8px 0;
          transition: color 0.3s;
          margin-bottom: 12px;
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .transcript-toggle:hover { color: rgba(180,140,60,0.45); }
        .toggle-line {
          width: 22px; height: 1px;
          background: currentColor;
          opacity: 0.4;
        }

        .transcript-drawer {
          width: 100%;
          max-height: 230px;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 10px;
          border-top: 1px solid rgba(180,140,60,0.07);
          padding-top: 20px;
          margin-bottom: 36px;
          animation: fadeUp 0.3s ease-out;
        }
        .transcript-drawer::-webkit-scrollbar { width: 1px; }
        .transcript-drawer::-webkit-scrollbar-thumb { background: rgba(180,140,60,0.15); }

        .msg {
          display: flex;
          flex-direction: column;
          animation: msgIn 0.25s ease-out;
        }
        @keyframes msgIn {
          from { opacity: 0; transform: translateY(5px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .msg-agent { align-items: flex-start; }
        .msg-user { align-items: flex-end; }
        .msg-label {
          font-size: 8px;
          letter-spacing: 0.22em;
          text-transform: uppercase;
          color: rgba(180,140,60,0.3);
          font-weight: 300;
          margin-bottom: 4px;
          padding: 0 4px;
        }
        .msg-text {
          font-size: 13px;
          line-height: 1.65;
          font-weight: 300;
          padding: 10px 14px;
          max-width: 86%;
          border-radius: 1px;
        }
        .msg-agent .msg-text {
          color: rgba(245,238,216,0.65);
          background: rgba(255,255,255,0.025);
          border-left: 1px solid rgba(180,140,60,0.2);
        }
        .msg-user .msg-text {
          color: rgba(180,140,60,0.7);
          background: rgba(180,140,60,0.04);
          border-right: 1px solid rgba(180,140,60,0.15);
        }

        .end-btn {
          background: none;
          border: none;
          cursor: pointer;
          font-family: 'Jost', sans-serif;
          font-size: 9px;
          letter-spacing: 0.38em;
          text-transform: uppercase;
          color: rgba(160,70,70,0.3);
          font-weight: 300;
          padding: 12px 24px;
          transition: color 0.3s;
          position: relative;
        }
        .end-btn::after {
          content: '';
          position: absolute;
          bottom: 6px; left: 50%;
          transform: translateX(-50%);
          width: 0;
          height: 1px;
          background: rgba(180,80,80,0.35);
          transition: width 0.35s ease;
        }
        .end-btn:hover { color: rgba(200,100,100,0.65); }
        .end-btn:hover::after { width: 55%; }

        .bottom-credit {
          position: fixed;
          bottom: 40px;
          left: 50%;
          transform: translateX(-50%);
          font-size: 9px;
          letter-spacing: 0.22em;
          color: rgba(255,255,255,0.05);
          font-weight: 200;
          text-transform: uppercase;
          white-space: nowrap;
          pointer-events: none;
        }
      `}</style>

      {/* Frame decoration */}
      <div className="frame-line-top" />
      <div className="frame-line-bottom" />
      <div className="corner c-tl" />
      <div className="corner c-tr" />
      <div className="corner c-bl" />
      <div className="corner c-br" />

      {/* Top bar */}
      <div className="top-bar">
        <span className="top-bar-left">Peppers</span>
        <span className="top-bar-right">Est. Tamilnadu</span>
      </div>

      {/* Main content */}
      <div className="main">

        {/* Branding — idle & connecting */}
        {(isIdle || isConnecting) && (
          <>
            <div className="ornament">
              <div className="orn-line" />
              <div className="orn-dot" />
              <div className="orn-diamond" />
              <div className="orn-dot" />
              <div className="orn-line r" />
            </div>
            <p className="restaurant-eyebrow">Fine Dining · Tamilnadu</p>
            <h1 className="restaurant-title">
              Peppers <em>Family</em><br />Restaurant
            </h1>
            <p className="restaurant-subtitle">Voice Order System</p>
          </>
        )}

        {/* Idle state */}
        {isIdle && (
          <>
            <div className="status-line">
              <div className="status-pip" style={{ background: 'rgba(255,255,255,0.1)' }} />
              <span className="status-text" style={{ color: 'rgba(255,255,255,0.12)' }}>
                Not Connected
              </span>
            </div>
            <button className="begin-btn" onClick={startCall}>
              <div className="begin-btn-border" />
              <div className="begin-btn-corner bc-tl" />
              <div className="begin-btn-corner bc-tr" />
              <div className="begin-btn-corner bc-bl" />
              <div className="begin-btn-corner bc-br" />
              <div className="begin-btn-shimmer" />
              <span className="begin-btn-text">Begin Your Order</span>
              <span className="begin-btn-sub">Speak with Priya</span>
            </button>
          </>
        )}

        {/* Connecting state */}
        {isConnecting && (
          <>
            <div className="status-line">
              <span className="status-text" style={{ color: 'rgba(180,140,60,0.35)' }}>
                Connecting
              </span>
            </div>
            <div className="connecting-wrap">
              <div className="connecting-ring-outer">
                <div className="connecting-dot-inner" />
              </div>
              <span className="connecting-text">Preparing your experience</span>
            </div>
          </>
        )}

        {/* Connected state */}
        {isConnected && (
          <div className="voice-section">
            <p className="connected-name">Peppers</p>
            <div className="timer-display">{formatTime(callDuration)}</div>

            {/* Voice orb */}
            <div className="orb-wrap">
              <div className={`orb-ring-1 ${agentSpeaking ? 'active' : ''}`} />
              <div className={`orb-ring-2 ${agentSpeaking ? 'active' : ''}`} />
              <div className={`orb-center ${agentSpeaking ? 'active' : ''}`}>
                <div className="orb-waves">
                  {[2, 3, 5, 7, 9, 7, 5, 3, 2].map((h, i) => (
                    <div
                      key={i}
                      className={`orb-bar ${agentSpeaking ? 'speaking' : 'listening'}`}
                      style={{
                        height: `${h * 2.6}px`,
                        animationDelay: agentSpeaking ? `${i * 0.09}s` : '0s',
                        opacity: agentSpeaking ? (0.35 + h * 0.07) : undefined,
                      }}
                    />
                  ))}
                </div>
              </div>
            </div>

            <p className="voice-label" style={{
              color: agentSpeaking ? 'rgba(180,140,60,0.55)' : 'rgba(255,255,255,0.15)',
            }}>
              {agentSpeaking ? 'Priya is speaking' : 'Listening'}
            </p>

            {/* Transcript toggle */}
            {transcript.length > 0 && (
              <button className="transcript-toggle" onClick={() => setShowTranscript(p => !p)}>
                <div className="toggle-line" />
                {showTranscript ? 'Hide conversation' : 'View conversation'}
                <div className="toggle-line" />
              </button>
            )}

            {/* Transcript */}
            {showTranscript && transcript.length > 0 && (
              <div className="transcript-drawer">
                {transcript.map(msg => (
                  <div key={msg.id} className={`msg msg-${msg.role}`}>
                    {msg.role === 'agent' && <span className="msg-label">Priya</span>}
                    <div className="msg-text">{msg.text}</div>
                  </div>
                ))}
                <div ref={transcriptEndRef} />
              </div>
            )}

            <button className="end-btn" onClick={endCall}>End Call</button>
          </div>
        )}

      </div>

      <div className="bottom-credit">Powered by AI &nbsp;·&nbsp; Available 24 / 7</div>
    </div>
  )
}