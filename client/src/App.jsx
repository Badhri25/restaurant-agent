import { useState, useEffect, useRef } from 'react'
import { Room, RoomEvent, createLocalAudioTrack, Track, ParticipantEvent } from 'livekit-client'

const MENU_ITEMS = [
  { name: 'Chicken Biryani',     price: '₹220', type: 'nonveg', desc: 'Fragrant basmati with tender chicken' },
  { name: 'Mutton Biryani',      price: '₹280', type: 'nonveg', desc: 'Slow-cooked mutton in spiced rice' },
  { name: 'Paneer Butter Masala',price: '₹180', type: 'veg',    desc: 'Creamy tomato gravy with cottage cheese' },
  { name: 'Garlic Naan',         price: '₹50',  type: 'veg',    desc: 'Soft flatbread with roasted garlic' },
  { name: 'Chicken Lollipop',    price: '₹250', type: 'nonveg', desc: 'Crispy spiced chicken drumettes' },
]

export default function App() {
  const [status, setStatus] = useState('idle')
  const [agentSpeaking, setAgentSpeaking] = useState(false)
  const [callDuration, setCallDuration] = useState(0)
  const [transcript, setTranscript] = useState([])
  const [showTranscript, setShowTranscript] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
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
    const resize = () => { W = canvas.width = window.innerWidth; H = canvas.height = window.innerHeight }
    resize()
    window.addEventListener('resize', resize)
    const draw = () => {
      t += 0.003
      ctx.clearRect(0, 0, W, H)
      ctx.fillStyle = '#050A18'; ctx.fillRect(0, 0, W, H)
      ;[
        { x: W*.5+Math.sin(t*.7)*W*.12, y: H*.45+Math.cos(t*.5)*H*.08, r: W*.38, c: 'rgba(30,60,140,0.18)' },
        { x: W*.3+Math.cos(t*.4)*W*.08, y: H*.55+Math.sin(t*.6)*H*.1,  r: W*.28, c: 'rgba(80,120,200,0.08)' },
        { x: W*.7+Math.sin(t*.5)*W*.06, y: H*.4 +Math.cos(t*.8)*H*.07, r: W*.22, c: 'rgba(140,160,220,0.06)' },
      ].forEach(o => {
        const g = ctx.createRadialGradient(o.x,o.y,0,o.x,o.y,o.r)
        g.addColorStop(0,o.c); g.addColorStop(1,'rgba(0,0,0,0)')
        ctx.fillStyle=g; ctx.fillRect(0,0,W,H)
      })
      if (!canvas._stars) canvas._stars = Array.from({length:110},()=>({
        x:Math.random()*W, y:Math.random()*H, r:Math.random()*.8+.1,
        a:Math.random()*.45+.08, sp:Math.random()*.02+.004, ph:Math.random()*Math.PI*2
      }))
      canvas._stars.forEach(s => {
        s.ph+=s.sp
        ctx.beginPath(); ctx.arc(s.x,s.y,s.r,0,Math.PI*2)
        ctx.fillStyle=`rgba(200,210,255,${s.a*(0.5+0.5*Math.sin(s.ph))})`; ctx.fill()
      })
      animRef.current = requestAnimationFrame(draw)
    }
    draw()
    return () => { cancelAnimationFrame(animRef.current); window.removeEventListener('resize',resize) }
  }, [])

  useEffect(() => {
    let timer=null, checker=null
    if (status==='connected') {
      timer = setInterval(()=>setCallDuration(p=>p+1),1000)
      checker = setInterval(()=>{ const r=roomRef.current; if(r&&(r.state==='disconnected'||r.state==='failed')) resetUI() },2000)
    } else setCallDuration(0)
    return ()=>{ clearInterval(timer); clearInterval(checker) }
  },[status])

  useEffect(()=>{ transcriptEndRef.current?.scrollIntoView({behavior:'smooth'}) },[transcript])

  function formatTime(s){ return `${Math.floor(s/60).toString().padStart(2,'0')}:${(s%60).toString().padStart(2,'0')}` }

  function cleanupAudio(){
    audioElemsRef.current.forEach(el=>{ el.pause(); el.srcObject=null; el.src=''; if(el.parentNode) el.parentNode.removeChild(el) })
    audioElemsRef.current=[]
  }

  function resetUI(){
    cleanupAudio(); setStatus('idle'); setAgentSpeaking(false)
    setCallDuration(0); setTranscript([]); setShowTranscript(false)
    setMenuOpen(false); roomRef.current=null
  }

  function addMessage(role,text){
    if(!text?.trim()) return
    setTranscript(prev=>{
      const last=prev[prev.length-1]
      if(last?.role===role) return [...prev.slice(0,-1),{...last,text:last.text+' '+text.trim()}]
      return [...prev,{role,text:text.trim(),id:Date.now()+Math.random()}]
    })
  }

  async function startCall(){
    setStatus('connecting'); setTranscript([]); setMenuOpen(false)
    try {
      const room = new Room({reconnectPolicy:{nextRetryDelayInMs:()=>null}})
      roomRef.current=room
      room.on(RoomEvent.Disconnected,()=>setTimeout(()=>resetUI(),500))
      room.on(RoomEvent.Connected,()=>setStatus('connected'))
      room.on(RoomEvent.TrackSubscribed,(track,_,participant)=>{
        if(track.kind===Track.Kind.Audio){
          const el=track.attach(); el.autoplay=true
          document.body.appendChild(el); audioElemsRef.current.push(el)
          participant.on(ParticipantEvent.IsSpeakingChanged,s=>setAgentSpeaking(s))
        }
      })
      room.on(RoomEvent.TranscriptionReceived,(segments,participant)=>{
        segments.forEach(seg=>{ if(!seg.final) return; addMessage(participant?.identity!=='customer-1'?'agent':'user',seg.text) })
      })
      room.on(RoomEvent.DataReceived,(payload,participant)=>{
        try{ const msg=JSON.parse(new TextDecoder().decode(payload)); const c=msg?.text||msg?.transcript||''; if(c) addMessage(participant?.identity!=='customer-1'?'agent':'user',c) }catch{}
      })
      const res = await fetch(`${import.meta.env.VITE_TOKEN_SERVER_URL}/token`,{method:'POST',headers:{'Content-Type':'application/json'}})
      const {token,url} = await res.json()
      await room.connect(url,token)
      await room.localParticipant.publishTrack(await createLocalAudioTrack())
    } catch(e){ console.error(e); resetUI() }
  }

  async function endCall(){
    const room=roomRef.current; roomRef.current=null; resetUI(); if(room) await room.disconnect()
  }

  const isIdle=status==='idle', isConnecting=status==='connecting', isConnected=status==='connected'

  return (
    <div className="root" onClick={e=>{ if(menuOpen && !e.target.closest('.menu-drawer') && !e.target.closest('.menu-trigger')) setMenuOpen(false) }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Sans:wght@200;300;400;500&display=swap');
        *, *::before, *::after { box-sizing:border-box; margin:0; padding:0; }
        html, body { background:#050A18; height:100%; overflow:hidden; }

        .root {
          min-height:100vh; width:100%;
          display:flex; flex-direction:column; align-items:center; justify-content:center;
          position:relative; overflow:hidden; font-family:'DM Sans',sans-serif;
        }

        /* ── NAV ── */
        .nav {
          position:fixed; top:0; left:0; right:0; padding:22px 48px;
          display:flex; justify-content:space-between; align-items:center; z-index:30;
        }
        .nav-logo { font-family:'DM Serif Display',serif; font-size:14px; letter-spacing:0.1em; color:rgba(255,255,255,0.88); }
        .nav-logo span { color:#7EB3FF; margin:0 5px; }
        .nav-tag { font-size:10px; letter-spacing:0.3em; text-transform:uppercase; color:rgba(255,255,255,0.18); font-weight:300; }
        .nav-line { position:absolute; bottom:0; left:48px; right:48px; height:1px; background:linear-gradient(90deg,transparent,rgba(126,179,255,0.1),rgba(255,255,255,0.05),rgba(126,179,255,0.1),transparent); }

        /* ── MENU TRIGGER button in nav ── */
        .menu-trigger {
          background:none; border:1px solid rgba(126,179,255,0.2); cursor:pointer;
          font-family:'DM Sans',sans-serif; font-size:10px; letter-spacing:0.28em;
          text-transform:uppercase; font-weight:300; color:rgba(126,179,255,0.55);
          padding:7px 18px; border-radius:20px; transition:all 0.3s; display:flex; align-items:center; gap:8px;
        }
        .menu-trigger:hover { color:rgba(126,179,255,0.9); border-color:rgba(126,179,255,0.45); background:rgba(126,179,255,0.06); }
        .menu-trigger-icon { font-size:12px; }

        /* ── MENU DRAWER ── */
        .menu-overlay {
          position:fixed; inset:0; z-index:40; pointer-events:none;
        }
        .menu-overlay.open { pointer-events:all; }

        .menu-drawer {
          position:fixed; top:0; right:0; bottom:0; width:320px;
          background:linear-gradient(160deg, rgba(8,18,55,0.98) 0%, rgba(5,12,38,0.99) 100%);
          border-left:1px solid rgba(126,179,255,0.12);
          z-index:50; transform:translateX(100%);
          transition:transform 0.4s cubic-bezier(0.16,1,0.3,1);
          display:flex; flex-direction:column;
          box-shadow:-20px 0 60px rgba(0,0,40,0.5);
        }
        .menu-drawer.open { transform:translateX(0); }

        .drawer-header {
          padding:28px 28px 20px;
          border-bottom:1px solid rgba(126,179,255,0.08);
          display:flex; justify-content:space-between; align-items:center;
        }
        .drawer-title {
          font-family:'DM Serif Display',serif; font-size:20px;
          color:rgba(255,255,255,0.88); font-weight:400; letter-spacing:0.04em;
        }
        .drawer-title em { font-style:italic; color:#7EB3FF; }
        .drawer-close {
          background:none; border:none; cursor:pointer;
          color:rgba(255,255,255,0.3); font-size:18px; padding:4px 8px;
          transition:color 0.2s; line-height:1;
        }
        .drawer-close:hover { color:rgba(255,255,255,0.7); }

        .drawer-sub {
          padding:12px 28px 0;
          font-size:10px; letter-spacing:0.32em; text-transform:uppercase;
          color:rgba(126,179,255,0.35); font-weight:300;
        }

        .drawer-items { padding:16px 20px; display:flex; flex-direction:column; gap:10px; flex:1; overflow-y:auto; }
        .drawer-items::-webkit-scrollbar { width:1px; }
        .drawer-items::-webkit-scrollbar-thumb { background:rgba(126,179,255,0.15); }

        .d-item {
          padding:14px 16px; border-radius:8px;
          background:rgba(126,179,255,0.04);
          border:1px solid rgba(126,179,255,0.08);
          transition:all 0.2s; display:flex; align-items:center; gap:14px;
        }
        .d-item:hover { background:rgba(126,179,255,0.08); border-color:rgba(126,179,255,0.16); }

        .d-dot-wrap { flex-shrink:0; display:flex; flex-direction:column; align-items:center; }
        .d-dot { width:8px; height:8px; border-radius:2px; flex-shrink:0; }
        .d-dot.veg { background:#4CAF50; box-shadow:0 0 6px rgba(76,175,80,0.4); }
        .d-dot.nonveg { background:#E53935; box-shadow:0 0 6px rgba(229,57,53,0.4); }

        .d-info { flex:1; }
        .d-name { font-size:14px; font-weight:400; color:rgba(220,230,255,0.88); margin-bottom:3px; }
        .d-desc { font-size:11px; font-weight:300; color:rgba(150,170,220,0.45); line-height:1.4; }

        .d-price {
          font-size:14px; font-weight:500; color:#7EB3FF;
          letter-spacing:0.02em; flex-shrink:0;
        }

        .drawer-footer {
          padding:20px 28px;
          border-top:1px solid rgba(126,179,255,0.07);
          font-size:10px; letter-spacing:0.2em; text-transform:uppercase;
          color:rgba(126,179,255,0.2); font-weight:300; text-align:center;
        }

        /* veg legend */
        .drawer-legend {
          display:flex; gap:16px; padding:0 28px 16px; align-items:center;
        }
        .legend-item { display:flex; align-items:center; gap:6px; font-size:10px; color:rgba(255,255,255,0.25); font-weight:300; letter-spacing:0.08em; }
        .legend-dot { width:6px; height:6px; border-radius:2px; }
        .legend-dot.veg { background:#4CAF50; }
        .legend-dot.nonveg { background:#E53935; }

        /* ── MAIN ── */
        .main {
          position:relative; z-index:2;
          display:flex; flex-direction:column; align-items:center;
          width:100%; padding:0 24px;
          transition:transform 0.4s cubic-bezier(0.16,1,0.3,1);
        }
        .main.shifted { transform:translateX(-160px); }

        /* TITLE */
        .title-section { text-align:center; margin-bottom:16px; }
        .title-eyebrow {
          font-size:10px; letter-spacing:0.42em; text-transform:uppercase;
          font-weight:300; color:rgba(126,179,255,0.38); margin-bottom:10px;
        }
        .title-main {
          font-family:'DM Serif Display',serif;
          font-size:clamp(24px,3.2vw,46px);
          color:#FFFFFF; letter-spacing:0.02em; line-height:1.1; font-weight:400;
        }
        .title-main em { font-style:italic; color:#7EB3FF; }

        /* RING */
        .ring-system {
          position:relative; display:flex; align-items:center; justify-content:center;
          margin-bottom:20px;
        }
        .ring-outer { position:absolute; border-radius:50%; border:1px solid transparent; pointer-events:none; }
        .ring-d1 { width:340px; height:340px; border-color:rgba(126,179,255,0.09); animation:rotateSlow 40s linear infinite; }
        .ring-d1::before {
          content:''; position:absolute; top:-3px; left:50%;
          width:6px; height:6px; border-radius:50%;
          background:rgba(126,179,255,0.6); transform:translateX(-50%);
          box-shadow:0 0 8px rgba(126,179,255,1);
        }
        .ring-d2 { width:288px; height:288px; border-color:rgba(200,215,255,0.06); animation:rotateSlow 28s linear infinite reverse; }
        .ring-d2::before {
          content:''; position:absolute; bottom:-3px; left:50%;
          width:4px; height:4px; border-radius:50%;
          background:rgba(200,215,255,0.5); transform:translateX(-50%);
          box-shadow:0 0 6px rgba(200,215,255,0.8);
        }
        .ring-d3 { width:395px; height:395px; border:none; background:radial-gradient(circle, transparent 45%, rgba(126,179,255,0.025) 50%, transparent 55%); }
        @keyframes rotateSlow { to { transform:rotate(360deg); } }

        .ring-ticks { position:absolute; width:340px; height:340px; border-radius:50%; pointer-events:none; }
        .tick { position:absolute; width:1px; height:7px; background:rgba(126,179,255,0.13); left:50%; top:0; transform-origin:50% 170px; }
        .tick.major { height:13px; background:rgba(126,179,255,0.32); width:1.5px; }

        .ring-glow { position:absolute; width:244px; height:244px; border-radius:50%; border:1px solid rgba(126,179,255,0.1); transition:all 0.8s ease; pointer-events:none; }
        .ring-glow.speaking {
          border-color:rgba(126,179,255,0.6);
          box-shadow:0 0 70px rgba(80,140,255,0.2),0 0 140px rgba(80,140,255,0.1),inset 0 0 70px rgba(80,140,255,0.06);
          animation:glowPulse 1.8s ease-in-out infinite;
        }
        @keyframes glowPulse {
          0%,100% { box-shadow:0 0 50px rgba(80,140,255,0.15),0 0 90px rgba(80,140,255,0.07); }
          50%      { box-shadow:0 0 90px rgba(80,140,255,0.3),0 0 180px rgba(80,140,255,0.15); }
        }

        /* ORB */
        .center-orb {
          position:relative; width:192px; height:192px; border-radius:50%;
          display:flex; flex-direction:column; align-items:center; justify-content:center;
          cursor:pointer; z-index:5; transition:transform 0.3s ease;
        }
        .center-orb:hover { transform:scale(1.03); }
        .center-orb:active { transform:scale(0.97); }
        .orb-bg {
          position:absolute; inset:0; border-radius:50%;
          background:radial-gradient(circle at 40% 35%, rgba(80,120,220,0.4) 0%, rgba(30,60,140,0.65) 40%, rgba(10,20,70,0.88) 100%);
          border:1px solid rgba(126,179,255,0.28); transition:all 0.6s ease;
        }
        .center-orb.speaking .orb-bg {
          background:radial-gradient(circle at 40% 35%, rgba(100,160,255,0.5) 0%, rgba(50,100,200,0.75) 40%, rgba(15,35,100,0.92) 100%);
          border-color:rgba(126,179,255,0.7);
          box-shadow:0 0 55px rgba(80,140,255,0.25),inset 0 0 35px rgba(80,140,255,0.1);
        }
        .orb-shine { position:absolute; width:60%; height:45%; top:8%; left:20%; border-radius:50%; background:radial-gradient(ellipse, rgba(200,220,255,0.13) 0%, transparent 70%); pointer-events:none; }
        .orb-content { position:relative; text-align:center; z-index:2; padding:16px; }
        .orb-icon { font-size:22px; margin-bottom:8px; }
        .orb-main-text { font-family:'DM Serif Display',serif; font-size:18px; letter-spacing:0.04em; color:rgba(255,255,255,0.95); line-height:1.25; }
        .orb-sub-text { font-size:10px; letter-spacing:0.22em; text-transform:uppercase; font-weight:300; color:rgba(126,179,255,0.65); margin-top:7px; }

        /* WAVEFORM */
        .orb-bars { display:flex; align-items:center; justify-content:center; gap:4px; height:38px; margin-bottom:10px; }
        .obar { width:3px; border-radius:3px; transform-origin:center; background:linear-gradient(180deg, rgba(255,255,255,0.95), rgba(126,179,255,0.7)); box-shadow:0 0 5px rgba(126,179,255,0.5); }
        .obar.off { height:4px; opacity:0.2; }
        .obar.on { animation:obarWave 0.75s ease-in-out infinite; opacity:1; }
        @keyframes obarWave { 0%,100% { transform:scaleY(0.15); } 50% { transform:scaleY(1); } }

        .orb-timer { font-size:23px; letter-spacing:0.12em; font-weight:200; font-variant-numeric:tabular-nums; color:rgba(255,255,255,0.95); margin-bottom:6px; }
        .orb-status { font-size:10px; letter-spacing:0.28em; text-transform:uppercase; font-weight:300; transition:color 0.5s; }

        .orb-spinner { width:32px; height:32px; border-radius:50%; border:1.5px solid rgba(126,179,255,0.15); border-top-color:rgba(126,179,255,0.85); animation:spin 1s linear infinite; margin-bottom:10px; }
        @keyframes spin { to { transform:rotate(360deg); } }

        /* CONNECTED TITLE */
        .connected-title { text-align:center; margin-bottom:16px; animation:fadeUp 0.6s ease; }
        .connected-title h2 { font-family:'DM Serif Display',serif; font-size:24px; color:rgba(255,255,255,0.72); letter-spacing:0.06em; font-weight:400; }
        .connected-title h2 em { font-style:italic; color:#7EB3FF; }
        @keyframes fadeUp { from { opacity:0; transform:translateY(-10px); } to { opacity:1; transform:translateY(0); } }

        /* BOTTOM */
        .bottom-panel { width:100%; max-width:440px; display:flex; flex-direction:column; align-items:center; gap:10px; }

        .status-badge {
          display:inline-flex; align-items:center; gap:8px; padding:6px 16px; border-radius:20px;
          border:1px solid rgba(126,179,255,0.1); background:rgba(126,179,255,0.04);
        }
        .badge-dot { width:5px; height:5px; border-radius:50%; flex-shrink:0; }
        .badge-text { font-size:10px; letter-spacing:0.28em; text-transform:uppercase; font-weight:300; }

        .t-toggle {
          background:none; border:none; cursor:pointer; font-family:'DM Sans',sans-serif;
          font-size:10px; letter-spacing:0.22em; text-transform:uppercase; font-weight:300;
          color:rgba(126,179,255,0.28); display:flex; align-items:center; gap:10px; padding:4px 0; transition:color 0.3s;
        }
        .t-toggle:hover { color:rgba(126,179,255,0.6); }
        .tl { width:24px; height:1px; background:currentColor; opacity:0.5; }

        .t-drawer {
          width:100%; max-height:180px; overflow-y:auto;
          display:flex; flex-direction:column; gap:8px;
          border-top:1px solid rgba(126,179,255,0.07); padding-top:14px; animation:fadeUp 0.3s ease;
        }
        .t-drawer::-webkit-scrollbar { width:1px; }
        .t-drawer::-webkit-scrollbar-thumb { background:rgba(126,179,255,0.2); }

        .msg { display:flex; flex-direction:column; animation:fadeUp 0.2s ease; }
        .msg.a { align-items:flex-start; }
        .msg.u { align-items:flex-end; }
        .msg-lbl { font-size:8px; letter-spacing:0.22em; text-transform:uppercase; font-weight:400; color:rgba(126,179,255,0.3); margin-bottom:3px; padding:0 4px; }
        .msg-txt { font-size:13px; line-height:1.6; font-weight:300; padding:8px 13px; max-width:85%; }
        .msg.a .msg-txt { color:rgba(220,230,255,0.85); background:rgba(126,179,255,0.07); border:1px solid rgba(126,179,255,0.12); border-radius:0 10px 10px 10px; }
        .msg.u .msg-txt { color:rgba(255,255,255,0.75); background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.08); border-radius:10px 0 10px 10px; }

        .end-btn {
          background:none; border:1px solid rgba(220,60,60,0.35); cursor:pointer;
          font-family:'DM Sans',sans-serif; font-size:10px; letter-spacing:0.38em;
          text-transform:uppercase; font-weight:400; color:rgba(240,100,100,0.6);
          padding:11px 36px; border-radius:4px; transition:all 0.3s ease;
          box-shadow:0 0 12px rgba(220,60,60,0.08);
        }
        .end-btn:hover { color:rgba(255,120,120,0.9); border-color:rgba(220,60,60,0.7); background:rgba(220,60,60,0.06); box-shadow:0 0 20px rgba(220,60,60,0.15); }

        .footer { position:fixed; bottom:18px; left:50%; transform:translateX(-50%); font-size:9px; letter-spacing:0.22em; text-transform:uppercase; font-weight:300; color:rgba(126,179,255,0.09); white-space:nowrap; pointer-events:none; z-index:2; }
      `}</style>

      <canvas ref={canvasRef} style={{position:'fixed',inset:0,width:'100%',height:'100%',pointerEvents:'none',zIndex:0}} />

      {/* Nav */}
      <nav className="nav">
        <div className="nav-logo">PEPPERS <span>·</span> FAMILY</div>
        <button className="menu-trigger" onClick={()=>setMenuOpen(p=>!p)}>
          <span className="menu-trigger-icon">{menuOpen ? '✕' : '☰'}</span>
          {menuOpen ? 'Close' : 'Menu'}
        </button>
        <div className="nav-tag">Est. Tamilnadu</div>
        <div className="nav-line" />
      </nav>

      {/* Menu drawer */}
      <div className={`menu-overlay ${menuOpen ? 'open' : ''}`}>
        <div className={`menu-drawer ${menuOpen ? 'open' : ''}`}>
          <div className="drawer-header">
            <div className="drawer-title">Today's <em>Menu</em></div>
            <button className="drawer-close" onClick={()=>setMenuOpen(false)}>✕</button>
          </div>
          <p className="drawer-sub">Peppers Family Restaurant</p>

          <div className="drawer-legend">
            <div className="legend-item"><div className="legend-dot veg" />Vegetarian</div>
            <div className="legend-item"><div className="legend-dot nonveg" />Non-Veg</div>
          </div>

          <div className="drawer-items">
            {MENU_ITEMS.map((item,i)=>(
              <div key={i} className="d-item">
                <div className="d-dot-wrap">
                  <div className={`d-dot ${item.type}`} />
                </div>
                <div className="d-info">
                  <div className="d-name">{item.name}</div>
                  <div className="d-desc">{item.desc}</div>
                </div>
                <div className="d-price">{item.price}</div>
              </div>
            ))}
          </div>

          <div className="drawer-footer">
            Speak your order to Priya
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className={`main ${menuOpen ? 'shifted' : ''}`}>

        {(isIdle||isConnecting) && (
          <div className="title-section">
            <p className="title-eyebrow">Fine Dining · Tamilnadu</p>
            <h1 className="title-main">Peppers <em>Family</em><br/>Restaurant</h1>
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
            {Array.from({length:60},(_,i)=>(
              <div key={i} className={`tick ${i%5===0?'major':''}`} style={{transform:`rotate(${i*6}deg) translateX(-50%)`}} />
            ))}
          </div>
          <div className={`ring-glow ${agentSpeaking?'speaking':''}`} />

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
            <div className={`center-orb ${agentSpeaking?'speaking':''}`} style={{cursor:'default'}}>
              <div className="orb-bg"/><div className="orb-shine"/>
              <div className="orb-content">
                <div className="orb-bars">
                  {[1,2,4,7,10,13,10,7,4,2,1].map((h,i)=>(
                    <div key={i} className={`obar ${agentSpeaking?'on':'off'}`}
                      style={{height:`${h*2.8}px`,animationDelay:`${i*0.08}s`}} />
                  ))}
                </div>
                <p className="orb-timer">{formatTime(callDuration)}</p>
                <p className="orb-status" style={{color:agentSpeaking?'rgba(126,179,255,0.9)':'rgba(255,255,255,0.28)'}}>
                  {agentSpeaking?'Priya speaking':'Listening'}
                </p>
              </div>
            </div>
          )}
        </div>

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
                <button className="t-toggle" onClick={()=>setShowTranscript(p=>!p)}>
                  <div className="tl"/>
                  {showTranscript?'Hide conversation':'View conversation'}
                  <div className="tl"/>
                </button>
              )}
              {showTranscript && transcript.length > 0 && (
                <div className="t-drawer">
                  {transcript.map(msg=>(
                    <div key={msg.id} className={`msg ${msg.role==='agent'?'a':'u'}`}>
                      {msg.role==='agent' && <span className="msg-lbl">Priya</span>}
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
    </div>
  )
}