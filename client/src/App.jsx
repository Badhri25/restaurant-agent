import { useState, useEffect, useRef } from 'react'
import { Room, RoomEvent, createLocalAudioTrack, Track, ParticipantEvent } from 'livekit-client'

export default function App() {
  const [status, setStatus] = useState('idle')
  const [agentSpeaking, setAgentSpeaking] = useState(false)
  const [callDuration, setCallDuration] = useState(0)
  const roomRef = useRef(null)
  const timerRef = useRef(null)
  const audioElemsRef = useRef([])

useEffect(() => {
  let timer = null
  let checker = null

  if (status === 'connected') {
    // call timer
    timer = setInterval(() => {
      setCallDuration(prev => prev + 1)
    }, 1000)

    // poll room connection every 2 seconds
    checker = setInterval(() => {
      const room = roomRef.current
      if (!room || room.state === 'disconnected') {
        console.log('[Checker] Room disconnected — resetting UI')
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
    roomRef.current = null
  }

  async function startCall() {
    setStatus('connecting')
    try {
      const room = new Room()
      roomRef.current = room

      // set up ALL listeners BEFORE connecting
      room.on(RoomEvent.Disconnected, (reason) => {
      console.log('[Room] Disconnected reason:', reason)
      setTimeout(() => {
      resetUI()
  },  500)
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
    if (room) {
      await room.disconnect()
    }
  }

  return (
    <div style={styles.page}>
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
            <div style={styles.timerBox}>
              <span style={styles.timerText}>{formatTime(callDuration)}</span>
            </div>

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

            <button style={styles.btn('#E24B4A')} onClick={endCall}>
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