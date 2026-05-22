import { useState, useEffect, useRef } from 'react'
import { Room, RoomEvent, createLocalAudioTrack, Track, ParticipantEvent } from 'livekit-client'

export default function App() {
  const [status, setStatus] = useState('idle')
  const [agentSpeaking, setAgentSpeaking] = useState(false)
  const [callDuration, setCallDuration] = useState(0)
  const [transcript, setTranscript] = useState([])
  const roomRef = useRef(null)
  const timerRef = useRef(null)
  const audioElemsRef = useRef([])
  const transcriptEndRef = useRef(null)

  useEffect(() => {
    let timer = null
    let checker = null

    if (status === 'connected') {
      timer = setInterval(() => {
        setCallDuration(prev => prev + 1)
      }, 1000)

      checker = setInterval(() => {
        const room = roomRef.current
        if (!room) return
        const state = room.state
        if (state === 'disconnected' || state === 'failed') {
          resetUI()
        }
      }, 2000)
    } else {
      setCallDuration(0)
    }

    return () => {
      clearInterval(timer)
      clearInterval(checker)
    }
  }, [status])

  // auto scroll transcript to bottom
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [transcript])

  function formatTime(seconds) {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0')
    const s = (seconds % 60).toString().padStart(2, '0')
    return `${m}:${s}`
  }

  function cleanupAudio() {
    audioElemsRef.current.forEach(el => {
      el.pause()
      el.srcObject = null
      el.src = ''
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
    roomRef.current = null
  }

  function addMessage(role, text) {
    if (!text || text.trim() === '') return
    setTranscript(prev => {
      // if last message is same role and within 2s, append to it
      const last = prev[prev.length - 1]
      if (last && last.role === role) {
        return [...prev.slice(0, -1), { ...last, text: last.text + ' ' + text.trim() }]
      }
      return [...prev, { role, text: text.trim(), id: Date.now() + Math.random() }]
    })
  }

  async function startCall() {
    setStatus('connecting')
    setTranscript([])
    try {
      const room = new Room({
        reconnectPolicy: { nextRetryDelayInMs: () => null }
      })
      roomRef.current = room

      room.on(RoomEvent.Disconnected, (reason) => {
        console.log('[Room] Disconnected:', reason)
        setTimeout(() => resetUI(), 500)
      })

      room.on(RoomEvent.Connected, () => {
        setStatus('connected')
      })

      room.on(RoomEvent.TrackSubscribed, (track, _, participant) => {
        if (track.kind === Track.Kind.Audio) {
          const audioEl = track.attach()
          audioEl.autoplay = true
          document.body.appendChild(audioEl)
          audioElemsRef.current.push(audioEl)

          participant.on(ParticipantEvent.IsSpeakingChanged, (speaking) => {
            setAgentSpeaking(speaking)
          })
        }
      })

      // capture agent transcripts
      room.on(RoomEvent.TranscriptionReceived, (segments, participant) => {
        segments.forEach(seg => {
          if (!seg.final) return
          const isAgent = participant?.identity !== 'customer-1'
          addMessage(isAgent ? 'agent' : 'user', seg.text)
        })
      })

      // capture local user transcripts via DataReceived
      room.on(RoomEvent.DataReceived, (payload, participant) => {
        try {
          const text = new TextDecoder().decode(payload)
          const msg = JSON.parse(text)
          const content = msg?.text || msg?.transcript || ''
          if (!content) return
          const isAgent = participant?.identity !== 'customer-1'
          addMessage(isAgent ? 'agent' : 'user', content)
        } catch {
          // ignore
        }
      })

      const res = await fetch(`${import.meta.env.VITE_TOKEN_SERVER_URL}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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

  return (
    <div style={styles.page}>
      <style>{`
        @keyframes wave {
          0%, 100% { transform: scaleY(0.3); }
          50% { transform: scaleY(1); }
        }
        .bar {
          width: 3px;
          border-radius: 2px;
          background: #1D9E75;
          animation: wave 0.8s ease-in-out infinite;
          transform-origin: bottom;
        }
        .bar:nth-child(1) { animation-delay: 0s; }
        .bar:nth-child(2) { animation-delay: 0.12s; }
        .bar:nth-child(3) { animation-delay: 0.24s; }
        .bar:nth-child(4) { animation-delay: 0.36s; }
        .bar:nth-child(5) { animation-delay: 0.48s; }
        .bar-paused {
          animation-play-state: paused;
          transform: scaleY(0.3);
        }
        .bubble-in {
          animation: bubbleIn 0.2s ease-out;
        }
        @keyframes bubbleIn {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      <div style={styles.card}>
        <h2 style={styles.title}>Peppers Family Restaurant</h2>
        <p style={styles.subtitle}>Voice Order System</p>

        <div style={styles.statusRow}>
          <div style={{ ...styles.dot, background: dotColor(status) }} />
          <span style={styles.statusText}>{statusLabel(status)}</span>
        </div>

        {status === 'idle' && (
          <button style={styles.btn('#1D9E75')} onClick={startCall}>
            Start Order
          </button>
        )}

        {status === 'connecting' && (
          <button style={styles.btn('#888')} disabled>
            Connecting...
          </button>
        )}

        {status === 'connected' && (
          <>
            {/* timer */}
            <div style={styles.timerBox}>
              <span style={styles.timerText}>{formatTime(callDuration)}</span>
            </div>

            {/* waveform */}
            <div style={styles.waveformBox}>
              <div style={styles.waveformInner}>
                {[1,2,3,4,5].map(i => (
                  <div
                    key={i}
                    className={`bar${agentSpeaking ? '' : ' bar-paused'}`}
                    style={{ height: `${14 + i * 4}px` }}
                  />
                ))}
              </div>
              <span style={styles.speakingText}>
                {agentSpeaking ? 'Priya is speaking...' : 'Listening...'}
              </span>
            </div>

            {/* transcript */}
            {transcript.length > 0 && (
              <div style={styles.transcriptBox}>
                {transcript.map(msg => (
                  <div
                    key={msg.id}
                    className="bubble-in"
                    style={{
                      ...styles.bubble,
                      alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                      background: msg.role === 'user' ? '#1D9E75' : '#f0f0ee',
                      color: msg.role === 'user' ? '#fff' : '#1a1a1a',
                      borderBottomRightRadius: msg.role === 'user' ? 4 : 12,
                      borderBottomLeftRadius: msg.role === 'agent' ? 4 : 12,
                    }}
                  >
                    {msg.role === 'agent' && (
                      <span style={styles.bubbleLabel}>Priya</span>
                    )}
                    {msg.text}
                  </div>
                ))}
                <div ref={transcriptEndRef} />
              </div>
            )}

            <button style={{ ...styles.btn('#E24B4A'), marginTop: 16 }} onClick={endCall}>
              End Call
            </button>
          </>
        )}
      </div>
    </div>
  )
}

function dotColor(s) {
  if (s === 'connected') return '#1D9E75'
  if (s === 'connecting') return '#EF9F27'
  return '#B4B2A9'
}

function statusLabel(s) {
  if (s === 'connected') return 'Connected'
  if (s === 'connecting') return 'Connecting...'
  return 'Not connected'
}

const styles = {
  page: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#f5f5f3',
    padding: '24px 16px',
    boxSizing: 'border-box',
  },
  card: {
    background: '#fff',
    borderRadius: 16,
    padding: '40px 40px',
    textAlign: 'center',
    border: '1px solid #e8e8e6',
    width: '100%',
    maxWidth: 420,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'stretch',
  },
  title: {
    fontSize: 24,
    fontWeight: 700,
    margin: '0 0 4px',
    color: '#1a1a1a',
  },
  subtitle: {
    fontSize: 14,
    color: '#888',
    margin: '0 0 28px',
  },
  statusRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 20,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: '50%',
    flexShrink: 0,
  },
  statusText: {
    fontSize: 14,
    color: '#5F5E5A',
  },
  timerBox: {
    background: '#f5f5f3',
    borderRadius: 8,
    padding: '8px 16px',
    marginBottom: 16,
    display: 'inline-block',
    alignSelf: 'center',
  },
  timerText: {
    fontSize: 20,
    fontWeight: 600,
    color: '#1a1a1a',
    fontVariantNumeric: 'tabular-nums',
  },
  waveformBox: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: '10px 16px',
    borderRadius: 8,
    background: '#f9f9f8',
    marginBottom: 16,
  },
  waveformInner: {
    display: 'flex',
    alignItems: 'center',
    gap: 3,
    height: 30,
  },
  speakingText: {
    fontSize: 14,
    color: '#5F5E5A',
  },
  transcriptBox: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    maxHeight: 280,
    overflowY: 'auto',
    padding: '12px 4px',
    borderTop: '1px solid #e8e8e6',
    borderBottom: '1px solid #e8e8e6',
    marginBottom: 4,
  },
  bubble: {
    maxWidth: '80%',
    padding: '8px 12px',
    borderRadius: 12,
    fontSize: 14,
    lineHeight: 1.45,
    textAlign: 'left',
  },
  bubbleLabel: {
    display: 'block',
    fontSize: 11,
    fontWeight: 600,
    marginBottom: 3,
    opacity: 0.6,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
  },
  btn: (bg) => ({
    background: bg,
    color: '#fff',
    border: 'none',
    padding: '12px 32px',
    borderRadius: 8,
    fontSize: 15,
    cursor: 'pointer',
    width: '100%',
  }),
}