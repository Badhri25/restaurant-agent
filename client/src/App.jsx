import { useState, useEffect, useRef } from 'react'
import { Room, RoomEvent, createLocalAudioTrack, Track, ParticipantEvent } from 'livekit-client'

const GOODBYE_PHRASES = [
  'have a great day',
  'goodbye',
  'good bye',
  'take care',
  'thank you for ordering',
  'order has been placed successfully',
]

function containsGoodbye(text = '') {
  const lower = text.toLowerCase()
  return GOODBYE_PHRASES.some(phrase => lower.includes(phrase))
}

export default function App() {
  const [status, setStatus] = useState('idle')
  const [agentSpeaking, setAgentSpeaking] = useState(false)
  const [callDuration, setCallDuration] = useState(0)
  const [orderDone, setOrderDone] = useState(false)
  const roomRef = useRef(null)
  const timerRef = useRef(null)
  const audioElemsRef = useRef([])
  const autoDisconnectTimer = useRef(null)

  useEffect(() => {
    if (status === 'connected') {
      timerRef.current = setInterval(() => {
        setCallDuration(prev => prev + 1)
      }, 1000)
    } else {
      clearInterval(timerRef.current)
      setCallDuration(0)
      setOrderDone(false)
    }
    return () => clearInterval(timerRef.current)
  }, [status])

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

  function scheduleAutoDisconnect() {
    if (autoDisconnectTimer.current) return
    setOrderDone(true)
    // UI shows "Order placed" status, actual disconnect comes from server
    // but we also schedule a client-side fallback after 12s just in case
    autoDisconnectTimer.current = setTimeout(async () => {
      autoDisconnectTimer.current = null
      cleanupAudio()
      if (roomRef.current) {
        await roomRef.current.disconnect()
      }
      setStatus('idle')
    }, 12000)
  }

  async function startCall() {
    setStatus('connecting')
    try {
      const room = new Room()
      roomRef.current = room

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

      room.on(RoomEvent.DataReceived, (payload) => {
        try {
          const text = new TextDecoder().decode(payload)
          const msg = JSON.parse(text)
          const content = msg?.text || msg?.message || msg?.transcript || ''
          if (containsGoodbye(content)) {
            scheduleAutoDisconnect()
          }
        } catch {
          // ignore non-JSON
        }
      })

      room.on(RoomEvent.Connected, () => setStatus('connected'))

      // This fires when server disconnects the room — reset UI immediately
      room.on(RoomEvent.Disconnected, () => {
        clearTimeout(autoDisconnectTimer.current)
        autoDisconnectTimer.current = null
        cleanupAudio()
        setStatus('idle')
        setAgentSpeaking(false)
        setOrderDone(false)
        roomRef.current = null
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
      cleanupAudio()
      setStatus('idle')
    }
  }

  async function endCall() {
    clearTimeout(autoDisconnectTimer.current)
    autoDisconnectTimer.current = null
    cleanupAudio()
    if (roomRef.current) {
      await roomRef.current.disconnect()
    }
    setStatus('idle')
  }

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <h2 style={styles.title}>Peppers Family Restaurant</h2>
        <p style={styles.subtitle}>Voice Order System</p>

        <div style={styles.statusRow}>
          <div style={{ ...styles.dot, background: dotColor(status, orderDone) }} />
          <span style={styles.statusText}>{statusLabel(status, orderDone)}</span>
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
            <div style={styles.timerBox}>
              <span style={styles.timerText}>{formatTime(callDuration)}</span>
            </div>

            {!orderDone && (
              <div style={styles.speakingBox}>
                <div style={{
                  ...styles.speakingDot,
                  background: agentSpeaking ? '#1D9E75' : '#ddd',
                  boxShadow: agentSpeaking ? '0 0 8px #1D9E75' : 'none',
                }} />
                <span style={styles.speakingText}>
                  {agentSpeaking ? 'Priya is speaking...' : 'Listening...'}
                </span>
              </div>
            )}

            {orderDone && (
              <div style={styles.orderDoneBox}>
                <span style={styles.orderDoneText}>
                  ✓ Order placed — ending call...
                </span>
              </div>
            )}

            {!orderDone && (
              <button style={styles.btn('#E24B4A')} onClick={endCall}>
                End Call
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function dotColor(s, orderDone) {
  if (s === 'connected' && orderDone) return '#EF9F27'
  if (s === 'connected') return '#1D9E75'
  if (s === 'connecting') return '#EF9F27'
  return '#B4B2A9'
}

function statusLabel(s, orderDone) {
  if (s === 'connected' && orderDone) return 'Order placed — wrapping up...'
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
  },
  card: {
    background: '#fff',
    borderRadius: 16,
    padding: '40px 48px',
    textAlign: 'center',
    border: '1px solid #e8e8e6',
    minWidth: 300,
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
    margin: '0 0 32px',
  },
  statusRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 24,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: '50%',
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
  },
  timerText: {
    fontSize: 20,
    fontWeight: 600,
    color: '#1a1a1a',
    fontVariantNumeric: 'tabular-nums',
  },
  speakingBox: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 20,
    padding: '10px 16px',
    borderRadius: 8,
    background: '#f9f9f8',
  },
  speakingDot: {
    width: 10,
    height: 10,
    borderRadius: '50%',
    transition: 'all 0.3s ease',
  },
  speakingText: {
    fontSize: 14,
    color: '#5F5E5A',
  },
  orderDoneBox: {
    background: '#f0faf5',
    border: '1px solid #b7e4ce',
    borderRadius: 8,
    padding: '12px 16px',
    marginBottom: 20,
  },
  orderDoneText: {
    fontSize: 14,
    color: '#1D9E75',
    fontWeight: 500,
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