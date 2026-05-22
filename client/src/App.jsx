import { useState, useEffect, useRef } from 'react'
import { Room, RoomEvent, createLocalAudioTrack, Track, ParticipantEvent } from 'livekit-client'

const GOLD = '#C9A84C'
const GOLD_LIGHT = '#E8C96A'
const DARK_BG = '#0A0A0A'
const CARD_BG = '#111111'
const CARD_BORDER = '#2A2A2A'
const SURFACE = '#1A1A1A'

export default function App() {
  const [status, setStatus] = useState('idle')
  const [agentSpeaking, setAgentSpeaking] = useState(false)
  const [callDuration, setCallDuration] = useState(0)
  const [transcript, setTranscript] = useState([])
  const roomRef = useRef(null)
  const audioElemsRef = useRef([])
  const transcriptEndRef = useRef(null)

  useEffect(() => {
    let timer = null
    let checker = null
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
    return `${Math.floor(s/60).toString().padStart(2,'0')}:${(s%60).toString().padStart(2,'0')}`
  }

  function cleanupAudio() {
    audioElemsRef.current.forEach(el => { el.pause(); el.srcObject = null; el.src = ''; if (el.parentNode) el.parentNode.removeChild(el) })
    audioElemsRef.current = []
  }

  function resetUI() {
    cleanupAudio()
    setStatus('idle')
    setAgentSpeaking(false)
    setCallDuration(0)
    setTranscript([])
    roomRef.current = null
  }

  function addMessage(role, text) {
    if (!text || !text.trim()) return
    setTranscript(prev => {
      const last = prev[prev.length - 1]
      if (last && last.role === role) return [...prev.slice(0, -1), { ...last, text: last.text + ' ' + text.trim() }]
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
          participant.on(ParticipantEvent.IsSpeakingChanged, speaking => setAgentSpeaking(speaking))
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
    <div style={{
      minHeight: '100vh',
      background: DARK_BG,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px 16px',
      boxSizing: 'border-box',
      fontFamily: "'Cormorant Garamond', 'Georgia', serif",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@300;400;500;600&family=Outfit:wght@300;400;500&display=swap');

        .pfr-card {
          background: ${CARD_BG};
          border: 1px solid ${CARD_BORDER};
          border-radius: 2px;
          width: 100%;
          max-width: 460px;
          position: relative;
          overflow: hidden;
        }
        .pfr-card::before {
          content: '';
          position: absolute;
          top: 0; left: 0; right: 0;
          height: 1px;
          background: linear-gradient(90deg, transparent, ${GOLD}, transparent);
        }
        .pfr-corner {
          position: absolute;
          width: 18px; height: 18px;
          border-color: ${GOLD};
          border-style: solid;
          border-width: 0;
          opacity: 0.6;
        }
        .pfr-corner-tl { top: 12px; left: 12px; border-top-width: 1px; border-left-width: 1px; }
        .pfr-corner-tr { top: 12px; right: 12px; border-top-width: 1px; border-right-width: 1px; }
        .pfr-corner-bl { bottom: 12px; left: 12px; border-bottom-width: 1px; border-left-width: 1px; }
        .pfr-corner-br { bottom: 12px; right: 12px; border-bottom-width: 1px; border-right-width: 1px; }

        .pfr-divider {
          display: flex;
          align-items: center;
          gap: 10px;
          margin: 0 0 28px;
        }
        .pfr-divider-line {
          flex: 1;
          height: 1px;
          background: linear-gradient(90deg, transparent, ${CARD_BORDER});
        }
        .pfr-divider-line.right {
          background: linear-gradient(270deg, transparent, ${CARD_BORDER});
        }
        .pfr-divider-dot {
          width: 4px; height: 4px;
          background: ${GOLD};
          transform: rotate(45deg);
          opacity: 0.7;
        }

        @keyframes goldPulse {
          0%, 100% { opacity: 0.5; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.15); }
        }
        @keyframes waveBar {
          0%, 100% { transform: scaleY(0.2); }
          50% { transform: scaleY(1); }
        }
        @keyframes fadeSlideUp {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        @keyframes shimmer {
          0% { background-position: -200% center; }
          100% { background-position: 200% center; }
        }

        .wave-bar {
          width: 2px;
          border-radius: 2px;
          background: ${GOLD};
          transform-origin: center;
          animation: waveBar 0.9s ease-in-out infinite;
        }
        .wave-bar.paused { animation-play-state: paused; transform: scaleY(0.2); }

        .start-btn {
          width: 100%;
          padding: 14px 32px;
          background: transparent;
          border: 1px solid ${GOLD};
          color: ${GOLD};
          font-family: 'Outfit', sans-serif;
          font-size: 13px;
          font-weight: 400;
          letter-spacing: 0.2em;
          text-transform: uppercase;
          cursor: pointer;
          position: relative;
          overflow: hidden;
          transition: all 0.3s ease;
        }
        .start-btn::before {
          content: '';
          position: absolute;
          inset: 0;
          background: linear-gradient(90deg, transparent, rgba(201,168,76,0.08), transparent);
          background-size: 200% 100%;
          animation: shimmer 2.5s ease-in-out infinite;
        }
        .start-btn:hover {
          background: rgba(201,168,76,0.08);
          color: ${GOLD_LIGHT};
          border-color: ${GOLD_LIGHT};
        }

        .end-btn {
          width: 100%;
          padding: 12px 32px;
          background: transparent;
          border: 1px solid #3A1A1A;
          color: #A05050;
          font-family: 'Outfit', sans-serif;
          font-size: 13px;
          font-weight: 400;
          letter-spacing: 0.2em;
          text-transform: uppercase;
          cursor: pointer;
          transition: all 0.3s ease;
          margin-top: 20px;
        }
        .end-btn:hover {
          background: rgba(162,80,80,0.08);
          color: #D07070;
          border-color: #5A2A2A;
        }

        .transcript-box {
          display: flex;
          flex-direction: column;
          gap: 10px;
          max-height: 260px;
          overflow-y: auto;
          margin: 20px 0 0;
          padding-right: 4px;
        }
        .transcript-box::-webkit-scrollbar { width: 2px; }
        .transcript-box::-webkit-scrollbar-track { background: transparent; }
        .transcript-box::-webkit-scrollbar-thumb { background: ${CARD_BORDER}; border-radius: 2px; }

        .bubble {
          max-width: 82%;
          padding: 9px 13px;
          font-family: 'Outfit', sans-serif;
          font-size: 13px;
          line-height: 1.55;
          animation: fadeSlideUp 0.2s ease-out;
          border-radius: 2px;
        }
        .bubble-agent {
          align-self: flex-start;
          background: ${SURFACE};
          color: #C8C4BA;
          border-left: 1px solid ${GOLD};
        }
        .bubble-user {
          align-self: flex-end;
          background: #1C1810;
          color: #B8A878;
          border-right: 1px solid rgba(201,168,76,0.3);
        }
        .bubble-label {
          display: block;
          font-size: 9px;
          letter-spacing: 0.15em;
          text-transform: uppercase;
          margin-bottom: 4px;
          opacity: 0.45;
          color: ${GOLD};
        }

        .connecting-ring {
          width: 20px; height: 20px;
          border: 1.5px solid ${CARD_BORDER};
          border-top-color: ${GOLD};
          border-radius: 50%;
          animation: spin 0.9s linear infinite;
        }

        .status-dot {
          width: 6px; height: 6px;
          border-radius: 50%;
          flex-shrink: 0;
        }
      `}</style>

      <div className="pfr-card">
        <div className="pfr-corner pfr-corner-tl" />
        <div className="pfr-corner pfr-corner-tr" />
        <div className="pfr-corner pfr-corner-bl" />
        <div className="pfr-corner pfr-corner-br" />

        <div style={{ padding: '44px 40px 40px' }}>

          {/* Header */}
          <div style={{ textAlign: 'center', marginBottom: 32 }}>
            <div style={{
              fontSize: 10,
              letterSpacing: '0.3em',
              textTransform: 'uppercase',
              color: GOLD,
              fontFamily: "'Outfit', sans-serif",
              fontWeight: 400,
              marginBottom: 10,
              opacity: 0.8,
            }}>
              Est. Tamilnadu
            </div>
            <h1 style={{
              fontSize: 28,
              fontWeight: 500,
              color: '#F0EBE0',
              margin: '0 0 6px',
              letterSpacing: '0.03em',
              lineHeight: 1.2,
            }}>
              Peppers Family
            </h1>
            <h1 style={{
              fontSize: 28,
              fontWeight: 300,
              color: GOLD,
              margin: '0 0 14px',
              letterSpacing: '0.08em',
              lineHeight: 1.2,
              fontStyle: 'italic',
            }}>
              Restaurant
            </h1>

            <div className="pfr-divider">
              <div className="pfr-divider-line" />
              <div className="pfr-divider-dot" />
              <div className="pfr-divider-line right" />
            </div>

            <div style={{
              fontSize: 11,
              letterSpacing: '0.2em',
              textTransform: 'uppercase',
              color: '#666',
              fontFamily: "'Outfit', sans-serif",
              fontWeight: 300,
            }}>
              Voice Order System
            </div>
          </div>

          {/* Status */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            marginBottom: 28,
          }}>
            {isConnecting ? (
              <div className="connecting-ring" />
            ) : (
              <div className="status-dot" style={{
                background: isConnected ? GOLD : '#333',
                boxShadow: isConnected ? `0 0 6px ${GOLD}55` : 'none',
                animation: isConnected ? 'goldPulse 2s ease-in-out infinite' : 'none',
              }} />
            )}
            <span style={{
              fontSize: 11,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: isConnected ? '#A08848' : '#444',
              fontFamily: "'Outfit', sans-serif",
              fontWeight: 400,
            }}>
              {isConnected ? 'Connected' : isConnecting ? 'Connecting' : 'Not Connected'}
            </span>
          </div>

          {/* Idle */}
          {isIdle && (
            <button className="start-btn" onClick={startCall}>
              Begin Your Order
            </button>
          )}

          {/* Connecting */}
          {isConnecting && (
            <button className="start-btn" disabled style={{ opacity: 0.5, cursor: 'default' }}>
              Connecting...
            </button>
          )}

          {/* Connected */}
          {isConnected && (
            <>
              {/* Timer */}
              <div style={{ textAlign: 'center', marginBottom: 20 }}>
                <span style={{
                  fontSize: 13,
                  fontFamily: "'Outfit', sans-serif",
                  fontWeight: 300,
                  letterSpacing: '0.25em',
                  color: '#555',
                  fontVariantNumeric: 'tabular-nums',
                }}>
                  {formatTime(callDuration)}
                </span>
              </div>

              {/* Waveform */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 12,
                padding: '16px 20px',
                background: SURFACE,
                border: `1px solid ${CARD_BORDER}`,
                borderTop: agentSpeaking ? `1px solid ${GOLD}44` : `1px solid ${CARD_BORDER}`,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 3, height: 28 }}>
                  {[1,2,3,4,5,4,3,2,1].map((h, i) => (
                    <div
                      key={i}
                      className={`wave-bar${agentSpeaking ? '' : ' paused'}`}
                      style={{
                        height: `${6 + h * 3}px`,
                        animationDelay: `${i * 0.09}s`,
                        opacity: agentSpeaking ? (0.4 + h * 0.07) : 0.2,
                      }}
                    />
                  ))}
                </div>
                <span style={{
                  fontSize: 11,
                  letterSpacing: '0.15em',
                  textTransform: 'uppercase',
                  color: agentSpeaking ? '#A08848' : '#444',
                  fontFamily: "'Outfit', sans-serif",
                  fontWeight: 400,
                  minWidth: 90,
                }}>
                  {agentSpeaking ? 'Priya speaking' : 'Listening...'}
                </span>
              </div>

              {/* Transcript */}
              {transcript.length > 0 && (
                <div className="transcript-box">
                  {transcript.map(msg => (
                    <div
                      key={msg.id}
                      className={`bubble ${msg.role === 'agent' ? 'bubble-agent' : 'bubble-user'}`}
                    >
                      {msg.role === 'agent' && (
                        <span className="bubble-label">Priya</span>
                      )}
                      {msg.text}
                    </div>
                  ))}
                  <div ref={transcriptEndRef} />
                </div>
              )}

              <button className="end-btn" onClick={endCall}>
                End Call
              </button>
            </>
          )}

          {/* Footer */}
          <div style={{
            marginTop: 32,
            textAlign: 'center',
            fontSize: 10,
            letterSpacing: '0.15em',
            color: '#333',
            fontFamily: "'Outfit', sans-serif",
            textTransform: 'uppercase',
          }}>
            Powered by AI · Available 24/7
          </div>

        </div>
      </div>
    </div>
  )
}