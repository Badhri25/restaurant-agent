import { useState, useEffect, useRef, useCallback } from 'react'
import { Room, RoomEvent, createLocalAudioTrack, Track, ParticipantEvent } from 'livekit-client'

const MENU_ITEMS = [
  { name: 'Chicken Biryani',      price: '₹220', type: 'nonveg', desc: 'Fragrant basmati with tender chicken' },
  { name: 'Mutton Biryani',       price: '₹280', type: 'nonveg', desc: 'Slow-cooked mutton in spiced rice' },
  { name: 'Paneer Butter Masala', price: '₹180', type: 'veg',    desc: 'Creamy tomato gravy with cottage cheese' },
  { name: 'Garlic Naan',          price: '₹50',  type: 'veg',    desc: 'Soft flatbread with roasted garlic' },
  { name: 'Chicken Lollipop',     price: '₹250', type: 'nonveg', desc: 'Crispy spiced chicken drumettes' },
]

function parseOrderFromTranscript(transcript) {
  const orders = []
  const patterns = [
    { regex: /(\d+)\s*(?:x\s*)?chicken\s*biryani/gi,       name: 'Chicken Biryani',      price: 220 },
    { regex: /(\d+)\s*(?:x\s*)?mutton\s*biryani/gi,        name: 'Mutton Biryani',       price: 280 },
    { regex: /(\d+)\s*(?:x\s*)?paneer\s*butter\s*masala/gi,name: 'Paneer Butter Masala', price: 180 },
    { regex: /(\d+)\s*(?:x\s*)?garlic\s*naan/gi,           name: 'Garlic Naan',          price: 50  },
    { regex: /(\d+)\s*(?:x\s*)?chicken\s*lollipop/gi,      name: 'Chicken Lollipop',     price: 250 },
    { regex: /one\s+chicken\s*biryani/gi,       name: 'Chicken Biryani',      price: 220, qty: 1 },
    { regex: /one\s+mutton\s*biryani/gi,        name: 'Mutton Biryani',       price: 280, qty: 1 },
    { regex: /one\s+paneer\s*butter\s*masala/gi,name: 'Paneer Butter Masala', price: 180, qty: 1 },
    { regex: /one\s+garlic\s*naan/gi,           name: 'Garlic Naan',          price: 50,  qty: 1 },
    { regex: /one\s+chicken\s*lollipop/gi,      name: 'Chicken Lollipop',     price: 250, qty: 1 },
    { regex: /a\s+chicken\s*biryani/gi,         name: 'Chicken Biryani',      price: 220, qty: 1 },
    { regex: /a\s+mutton\s*biryani/gi,          name: 'Mutton Biryani',       price: 280, qty: 1 },
    { regex: /a\s+paneer/gi,                    name: 'Paneer Butter Masala', price: 180, qty: 1 },
    { regex: /a\s+garlic\s*naan/gi,             name: 'Garlic Naan',          price: 50,  qty: 1 },
    { regex: /a\s+chicken\s*lollipop/gi,        name: 'Chicken Lollipop',     price: 250, qty: 1 },
  ]
  const fullText = transcript.map(m => m.text).join(' ')
  const seen = {}
  patterns.forEach(p => {
    p.regex.lastIndex = 0
    const m = p.regex.exec(fullText)
    if (m && !seen[p.name]) {
      seen[p.name] = true
      orders.push({ name: p.name, price: p.price, qty: p.qty || parseInt(m[1]) || 1 })
    }
  })
  return orders
}

function playChime(type) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain); gain.connect(ctx.destination)
    if (type === 'connect') {
      osc.frequency.setValueAtTime(880, ctx.currentTime)
      osc.frequency.setValueAtTime(1100, ctx.currentTime + 0.1)
      gain.gain.setValueAtTime(0.08, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4)
      osc.start(); osc.stop(ctx.currentTime + 0.4)
    } else {
      osc.frequency.setValueAtTime(660, ctx.currentTime)
      osc.frequency.setValueAtTime(440, ctx.currentTime + 0.15)
      gain.gain.setValueAtTime(0.07, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5)
      osc.start(); osc.stop(ctx.currentTime + 0.5)
    }
  } catch(e) {}
}

export default function App() {
  const [status, setStatus] = useState('idle')
  const [agentSpeaking, setAgentSpeaking] = useState(false)
  const [callDuration, setCallDuration] = useState(0)
  const [transcript, setTranscript] = useState([])
  const [showTranscript, setShowTranscript] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [orderItems, setOrderItems] = useState([])
  const [summaryItems, setSummaryItems] = useState([])
  const [summaryDuration, setSummaryDuration] = useState(0)
  const [error, setError] = useState(null)
  const roomRef = useRef(null)
  const audioElemsRef = useRef([])
  const transcriptEndRef = useRef(null)
  const canvasRef = useRef(null)
  const animRef = useRef(null)
  const callDurationRef = useRef(0)
  const transcriptRef = useRef([])

  // keep refs in sync
  useEffect(() => { callDurationRef.current = callDuration }, [callDuration])
  useEffect(() => { transcriptRef.current = transcript }, [transcript])

  // Background canvas
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    let W, H, t = 0
    const resize = () => { W = canvas.width = window.innerWidth; H = canvas.height = window.innerHeight }
    resize()
    window.addEventListener('resize', resize)
    const draw = () => {
      t += 0.003
      ctx.clearRect(0,0,W,H)
      ctx.fillStyle='#050A18'; ctx.fillRect(0,0,W,H)
      ;[
        {x:W*.5+Math.sin(t*.7)*W*.12, y:H*.45+Math.cos(t*.5)*H*.08, r:W*.38, c:'rgba(30,60,140,0.18)'},
        {x:W*.3+Math.cos(t*.4)*W*.08, y:H*.55+Math.sin(t*.6)*H*.1,  r:W*.28, c:'rgba(80,120,200,0.08)'},
        {x:W*.7+Math.sin(t*.5)*W*.06, y:H*.4 +Math.cos(t*.8)*H*.07, r:W*.22, c:'rgba(140,160,220,0.06)'},
      ].forEach(o=>{
        const g=ctx.createRadialGradient(o.x,o.y,0,o.x,o.y,o.r)
        g.addColorStop(0,o.c); g.addColorStop(1,'rgba(0,0,0,0)')
        ctx.fillStyle=g; ctx.fillRect(0,0,W,H)
      })
      if(!canvas._stars) canvas._stars=Array.from({length:110},()=>({
        x:Math.random()*W, y:Math.random()*H, r:Math.random()*.8+.1,
        a:Math.random()*.45+.08, sp:Math.random()*.02+.004, ph:Math.random()*Math.PI*2
      }))
      canvas._stars.forEach(s=>{
        s.ph+=s.sp
        ctx.beginPath(); ctx.arc(s.x,s.y,s.r,0,Math.PI*2)
        ctx.fillStyle=`rgba(200,210,255,${s.a*(0.5+0.5*Math.sin(s.ph))})`; ctx.fill()
      })
      animRef.current=requestAnimationFrame(draw)
    }
    draw()
    return ()=>{ cancelAnimationFrame(animRef.current); window.removeEventListener('resize',resize) }
  },[])

  // Timer + room state polling
  useEffect(() => {
    let timer = null, checker = null
    if (status === 'connected') {
      timer = setInterval(() => setCallDuration(p => p + 1), 1000)
      checker = setInterval(() => {
        const r = roomRef.current
        if (r && (r.state === 'disconnected' || r.state === 'failed')) {
          handleDisconnect()
        }
      }, 2000)
    } else if (status !== 'summary') {
      setCallDuration(0)
    }
    return () => { clearInterval(timer); clearInterval(checker) }
  }, [status])

  // Live order tracking
  useEffect(() => {
    if (status === 'connected') setOrderItems(parseOrderFromTranscript(transcript))
  }, [transcript, status])

  useEffect(() => { transcriptEndRef.current?.scrollIntoView({behavior:'smooth'}) }, [transcript])

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
    // capture duration and transcript from refs (always current value)
    const dur = callDurationRef.current
    const items = parseOrderFromTranscript(transcriptRef.current)
    setSummaryItems(items)
    setSummaryDuration(dur)
    playChime('disconnect')
    setStatus('summary')
    setAgentSpeaking(false)
    setMenuOpen(false)
    roomRef.current = null
  }

  function resetToIdle() {
    setStatus('idle')
    setTranscript([])
    setShowTranscript(false)
    setOrderItems([])
    setSummaryItems([])
    setCallDuration(0)
    setError(null)
  }

  function resetUI() {
    cleanupAudio()
    resetToIdle()
    setAgentSpeaking(false)
    setMenuOpen(false)
    roomRef.current = null
  }

  function addMessage(role, text) {
    if (!text?.trim()) return
    setTranscript(prev => {
      const last = prev[prev.length - 1]
      if (last?.role === role) return [...prev.slice(0,-1), {...last, text: last.text + ' ' + text.trim()}]
      return [...prev, {role, text: text.trim(), id: Date.now() + Math.random()}]
    })
  }

  async function startCall() {
    setStatus('connecting')
    setTranscript([])
    setMenuOpen(false)
    setOrderItems([])
    setError(null)

    try {
      const res = await fetch(`${import.meta.env.VITE_TOKEN_SERVER_URL}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(8000),
      })

      if (!res.ok) throw new Error('Token server error')
      const { token, url } = await res.json()

      const room = new Room({
        reconnectPolicy: { nextRetryDelayInMs: () => null }
      })
      roomRef.current = room

      room.on(RoomEvent.Disconnected, () => {
        setTimeout(() => handleDisconnect(), 300)
      })

      room.on(RoomEvent.Connected, () => {
        setStatus('connected')
        playChime('connect')
      })

      room.on(RoomEvent.TrackSubscribed, (track, _, participant) => {
        if (track.kind === Track.Kind.Audio) {
          const audioEl = track.attach()
          audioEl.autoplay = true
          document.body.appendChild(audioEl)
          audioElemsRef.current.push(audioEl)
          participant.on(ParticipantEvent.IsSpeakingChanged, speaking => {
            setAgentSpeaking(speaking)
          })
        }
      })

      // Transcript via data channel
      room.on(RoomEvent.DataReceived, (data) => {
        try {
          const msg = JSON.parse(new TextDecoder().decode(data))
          if (msg.type === 'transcript') {
            addMessage(msg.role === 'agent' ? 'agent' : 'user', msg.text)
          }
        } catch(e) {}
      })

      await room.connect(url, token)
      const mic = await createLocalAudioTrack()
      await room.localParticipant.publishTrack(mic)

    } catch (e) {
      console.error(e)
      cleanupAudio()
      roomRef.current = null
      if (e.name === 'TimeoutError' || e.message?.includes('fetch')) {
        setError('Could not connect to server. Please try again.')
      } else {
        setError('Connection failed. Please try again.')
      }
      setStatus('idle')
    }
  }

  async function endCall() {
    const room = roomRef.current
    roomRef.current = null
    cleanupAudio()
    handleDisconnect()
    if (room) await room.disconnect()
  }

  const isIdle = status === 'idle'
  const isConnecting = status === 'connecting'
  const isConnected = status === 'connected'
  const isSummary = status === 'summary'
  const orderTotal = orderItems.reduce((s,i) => s + i.price * i.qty, 0)
  const summaryTotal = summaryItems.reduce((s,i) => s + i.price * i.qty, 0)

  return (
    <div className="app">
      <canvas ref={canvasRef} className="bg-canvas"/>

      {/* NAV */}
      <nav className="nav">
        <div className="nav-brand">
          <span className="nav-brand-main">Peppers</span>
          <span className="nav-dot">·</span>
          <span className="nav-brand-sub">Family</span>
        </div>
        {!isSummary && (
          <button className="menu-btn" onClick={() => setMenuOpen(p => !p)}>
            ☰ Menu
          </button>
        )}
        <div className="nav-est">Est. Tamilnadu</div>
      </nav>

      {/* MENU DRAWER */}
      <div className={`menu-drawer ${menuOpen ? 'open' : ''}`}>
        <div className="drawer-header">
          <p className="drawer-restaurant">Peppers Family Restaurant</p>
          <h3 className="drawer-title">Today's <em>Menu</em></h3>
          <button className="drawer-close" onClick={() => setMenuOpen(false)}>✕</button>
          <div className="drawer-legend">
            <span><span className="dot-veg"/>Vegetarian</span>
            <span><span className="dot-nonveg"/>Non-Veg</span>
          </div>
        </div>
        <div className="drawer-items">
          {MENU_ITEMS.map((item, i) => (
            <div key={i} className="drawer-item">
              <span className={`item-dot ${item.type}`}/>
              <div className="item-info">
                <p className="item-name">{item.name}</p>
                <p className="item-desc">{item.desc}</p>
              </div>
              <span className="item-price">{item.price}</span>
            </div>
          ))}
        </div>
        <div className="drawer-footer">Speak your order to Priya</div>
      </div>

      {/* Live order tracker */}
      {isConnected && orderItems.length > 0 && (
        <div className="order-tracker">
          <div className="tracker-header">Your Order</div>
          <div className="tracker-items">
            {orderItems.map((item, i) => (
              <div key={i} className="tracker-item">
                <div className="tracker-item-left">
                  <span className="tracker-item-qty">{item.qty}×</span>
                  <span className="tracker-item-name">{item.name}</span>
                </div>
                <span className="tracker-item-price">₹{item.price * item.qty}</span>
              </div>
            ))}
          </div>
          {orderTotal > 0 && (
            <div className="tracker-total">
              <span className="tracker-total-label">Total</span>
              <span className="tracker-total-price">₹{orderTotal}</span>
            </div>
          )}
        </div>
      )}

      {/* Main content */}
      <div className={`main ${menuOpen ? 'shifted' : ''}`}>

        {/* ERROR BANNER */}
        {error && (
          <div className="error-banner">
            <span>⚠ {error}</span>
            <button onClick={() => setError(null)}>✕</button>
          </div>
        )}

        {/* SUMMARY SCREEN */}
        {isSummary && (
          <div className="summary-screen">
            <div className="summary-icon">✓</div>
            <h2 className="summary-title">Order Placed!</h2>
            <p className="summary-sub">Thank you for ordering</p>
            {summaryItems.length > 0 ? (
              <>
                <div className="summary-items">
                  {summaryItems.map((item, i) => (
                    <div key={i} className="summary-item">
                      <span className="summary-item-name">{item.name}</span>
                      <div className="summary-item-right">
                        <span className="summary-item-qty">{item.qty}×</span>
                        <span className="summary-item-price">₹{item.price * item.qty}</span>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="summary-total">
                  <span className="summary-total-label">Total</span>
                  <span className="summary-total-price">₹{summaryTotal}</span>
                </div>
              </>
            ) : (
              <p className="summary-empty">Peppers Family Restaurant<br/>will be in touch shortly.</p>
            )}
            <p className="summary-duration">Call duration · {formatTime(summaryDuration)}</p>

            {/* NEW ORDER BUTTON */}
            <button className="new-order-btn" onClick={resetToIdle}>
              Place New Order
            </button>
          </div>
        )}

        {/* IDLE / CONNECTING */}
        {(isIdle || isConnecting) && (
          <div className="title-section">
            <p className="title-eyebrow">Fine Dining · Tamilnadu</p>
            <h1 className="title-main">Peppers <em>Family</em> Restaurant</h1>
          </div>
        )}

        {/* CONNECTED TITLE */}
        {isConnected && (
          <div className="connected-title">
            <div className={`priya-avatar ${agentSpeaking ? 'speaking' : ''}`}>P</div>
            <h2>Speaking with <em>Priya</em></h2>
            {/* Priya speaking animation */}
            {agentSpeaking && (
              <div className="speaking-indicator">
                <span className="speaking-dot" style={{animationDelay:'0s'}}/>
                <span className="speaking-dot" style={{animationDelay:'0.2s'}}/>
                <span className="speaking-dot" style={{animationDelay:'0.4s'}}/>
                <span className="speaking-label">Priya is speaking...</span>
              </div>
            )}
          </div>
        )}

        {/* RING */}
        {!isSummary && (
          <div className="ring-system">
            <div className="ring-outer ring-d3"/>
            <div className="ring-outer ring-d1"/>
            <div className="ring-outer ring-d2"/>
            <div className="ring-ticks">
              {Array.from({length:60},(_,i) => {
                const ringSize = window.innerWidth <= 600 ? 140 : 170
                return (
                  <div key={i} className={`tick ${i%5===0?'major':''}`}
                    style={{transform:`rotate(${i*6}deg) translateX(-50%)`,transformOrigin:`50% ${ringSize}px`}}/>
                )
              })}
            </div>
            {/* Orb glow — brighter when speaking */}
            <div className={`ring-glow ${agentSpeaking ? 'speaking' : ''}`}
              style={agentSpeaking ? {
                opacity: 1,
                background: 'radial-gradient(circle, rgba(100,160,255,0.55) 0%, rgba(60,100,200,0.18) 60%, transparent 100%)',
                transform: 'scale(1.15)',
                transition: 'all 0.3s ease',
              } : {
                opacity: 0.4,
                transition: 'all 0.3s ease',
              }}
            />

            {isIdle && (
              <div className="center-orb" onClick={startCall}>
                <div className="orb-bg"/><div className="orb-shine"/>
                <div className="orb-content">
                  <div className="orb-icon">🎙️</div>
                  <p className="orb-main-text">Talk<br/>to Priya</p>
                  <p className="orb-sub-text">Speak your order</p>
                </div>
              </div>
            )}

            {isConnecting && (
              <div className="center-orb" style={{cursor:'default'}}>
                <div className="orb-bg"/><div className="orb-shine"/>
                <div className="orb-content">
                  <div className="orb-spinner"/>
                  <p className="orb-sub-text">Connecting...</p>
                </div>
              </div>
            )}

            {isConnected && (
              <div className={`center-orb ${agentSpeaking ? 'speaking' : ''}`} style={{cursor:'default'}}>
                <div className="orb-bg"
                  style={agentSpeaking ? {
                    background: 'radial-gradient(circle at 38% 32%, rgba(120,170,255,0.22) 0%, rgba(40,80,180,0.92) 55%, rgba(10,20,80,0.98) 100%)',
                    boxShadow: '0 0 60px rgba(80,140,255,0.35), 0 0 120px rgba(60,100,200,0.18)',
                    transition: 'all 0.3s ease',
                  } : {
                    transition: 'all 0.3s ease',
                  }}
                />
                <div className="orb-shine"/>
                <div className="orb-content">
                  <div className="orb-bars">
                    {[1,2,4,7,10,13,10,7,4,2,1].map((h,i) => (
                      <div key={i} className={`obar ${agentSpeaking ? 'on' : 'off'}`}
                        style={{height:`${h*2.8}px`, animationDelay:`${i*0.08}s`}}/>
                    ))}
                  </div>
                  <p className="orb-timer">{formatTime(callDuration)}</p>
                  <p className="orb-status" style={{
                    color: agentSpeaking ? 'rgba(126,179,255,0.9)' : 'rgba(255,255,255,0.28)',
                    transition: 'color 0.3s ease',
                  }}>
                    {agentSpeaking ? 'Priya speaking' : 'Listening'}
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* BOTTOM PANEL */}
        <div className="bottom-panel">
          {isIdle && (
            <div className="status-badge">
              <div className="badge-dot" style={{background:'rgba(255,255,255,0.18)'}}/>
              <span className="badge-text" style={{color:'rgba(255,255,255,0.18)'}}>Not Connected</span>
            </div>
          )}
          {isConnecting && (
            <div className="status-badge">
              <div className="badge-dot" style={{background:'#7EB3FF',boxShadow:'0 0 6px #7EB3FF',animation:'glowPulse 1s ease-in-out infinite'}}/>
              <span className="badge-text" style={{color:'rgba(126,179,255,0.6)'}}>Connecting</span>
            </div>
          )}
          {isConnected && (
            <>
              {transcript.length > 0 && (
                <button className="t-toggle" onClick={() => setShowTranscript(p => !p)}>
                  <div className="tl"/>
                  {showTranscript ? 'Hide conversation' : 'View conversation'}
                  <div className="tl"/>
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
                  <div ref={transcriptEndRef}/>
                </div>
              )}
              <button className="end-btn" onClick={endCall}>End Call</button>
            </>
          )}
        </div>
      </div>

      <p className="footer">Powered by AI &nbsp;·&nbsp; Available 24 / 7</p>

      <style>{`
        .speaking-indicator {
          display: flex;
          align-items: center;
          gap: 6px;
          margin-top: 8px;
          animation: fadeIn 0.3s ease;
        }
        .speaking-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: rgba(126,179,255,0.9);
          animation: speakBounce 0.6s ease-in-out infinite;
          display: inline-block;
        }
        @keyframes speakBounce {
          0%, 100% { transform: translateY(0); opacity: 0.5; }
          50% { transform: translateY(-4px); opacity: 1; }
        }
        .speaking-label {
          font-size: 11px;
          color: rgba(126,179,255,0.8);
          letter-spacing: 0.05em;
          margin-left: 4px;
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .new-order-btn {
          margin-top: 24px;
          padding: 14px 40px;
          background: rgba(126,179,255,0.15);
          border: 1px solid rgba(126,179,255,0.3);
          border-radius: 40px;
          color: rgba(126,179,255,0.9);
          font-size: 14px;
          letter-spacing: 0.08em;
          cursor: pointer;
          transition: all 0.2s ease;
          text-transform: uppercase;
        }
        .new-order-btn:hover {
          background: rgba(126,179,255,0.25);
          border-color: rgba(126,179,255,0.5);
          color: #fff;
        }
        .error-banner {
          position: fixed;
          top: 70px;
          left: 50%;
          transform: translateX(-50%);
          background: rgba(220,60,60,0.85);
          color: #fff;
          padding: 10px 20px;
          border-radius: 8px;
          font-size: 13px;
          display: flex;
          align-items: center;
          gap: 12px;
          z-index: 999;
          backdrop-filter: blur(8px);
        }
        .error-banner button {
          background: none;
          border: none;
          color: #fff;
          cursor: pointer;
          font-size: 14px;
          padding: 0;
        }
      `}</style>
    </div>
  )
}