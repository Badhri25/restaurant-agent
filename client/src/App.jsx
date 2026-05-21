import { useState, useEffect, useRef } from 'react'
import { Room, RoomEvent, createLocalAudioTrack, Track } from 'livekit-client'

export default function App() {
  const [status, setStatus] = useState('idle')
  const roomRef = useRef(null)

  async function startCall() {
    setStatus('connecting')
    try {
      // create a FRESH room every time
      const room = new Room()
      roomRef.current = room

      // play agent audio when it arrives
      room.on(RoomEvent.TrackSubscribed, (track) => {
        if (track.kind === Track.Kind.Audio) {
          const audioEl = track.attach()
          audioEl.autoplay = true
          document.body.appendChild(audioEl)
        }
      })

      room.on(RoomEvent.Connected, () => setStatus('connected'))
      room.on(RoomEvent.Disconnected, () => {
        setStatus('idle')
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
      setStatus('idle')
    }
  }

  async function endCall() {
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
            <p style={styles.hint}>Speak now — the agent is listening</p>
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
    fontWeight: 500,
    margin: '0 0 4px',
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
  hint: {
    fontSize: 13,
    color: '#888',
    marginBottom: 16,
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