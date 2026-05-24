import { useState, useEffect, useRef, useCallback } from 'react'
import { Room, RoomEvent, createLocalAudioTrack, Track, ParticipantEvent } from 'livekit-client'

const MENU_ITEMS = [
  { name: 'Chicken Biryani',      price: '₹220', type: 'nonveg', desc: 'Fragrant basmati with tender chicken' },
  { name: 'Mutton Biryani',       price: '₹280', type: 'nonveg', desc: 'Slow-cooked mutton in spiced rice' },
  { name: 'Paneer Butter Masala', price: '₹180', type: 'veg',    desc: 'Creamy tomato gravy with cottage cheese' },
  { name: 'Garlic Naan',          price: '₹50',  type: 'veg',    desc: 'Soft flatbread with roasted garlic' },
  { name: 'Chicken Lollipop',     price: '₹250', type: 'nonveg', desc: 'Crispy spiced chicken drumettes' },
]

// Parse order items from transcript
function parseOrderFromTranscript(transcript) {
  const orders = []
  const patterns = [
    { regex: /(\d+)\s*(?:x\s*)?chicken\s*biryani/gi,      name: 'Chicken Biryani',      price: 220 },
    { regex: /(\d+)\s*(?:x\s*)?mutton\s*biryani/gi,       name: 'Mutton Biryani',       price: 280 },
    { regex: /(\d+)\s*(?:x\s*)?paneer\s*butter\s*masala/gi,name:'Paneer Butter Masala', price: 180 },
    { regex: /(\d+)\s*(?:x\s*)?garlic\s*naan/gi,          name: 'Garlic Naan',          price: 50  },
    { regex: /(\d+)\s*(?:x\s*)?chicken\s*lollipop/gi,     name: 'Chicken Lollipop',     price: 250 },
    { regex: /one\s+chicken\s*biryani/gi,      name: 'Chicken Biryani',      price: 220, qty: 1 },
    { regex: /one\s+mutton\s*biryani/gi,       name: 'Mutton Biryani',       price: 280, qty: 1 },
    { regex: /one\s+paneer\s*butter\s*masala/gi,name:'Paneer Butter Masala', price: 180, qty: 1 },
    { regex: /one\s+garlic\s*naan/gi,          name: 'Garlic Naan',          price: 50,  qty: 1 },
    { regex: /one\s+chicken\s*lollipop/gi,     name: 'Chicken Lollipop',     price: 250, qty: 1 },
    { regex: /a\s+chicken\s*biryani/gi,        name: 'Chicken Biryani',      price: 220, qty: 1 },
    { regex: /a\s+mutton\s*biryani/gi,         name: 'Mutton Biryani',       price: 280, qty: 1 },
    { regex: /a\s+paneer/gi,                   name: 'Paneer Butter Masala', price: 180, qty: 1 },
    { regex: /a\s+garlic\s*naan/gi,            name: 'Garlic Naan',          price: 50,  qty: 1 },
    { regex: /a\s+chicken\s*lollipop/gi,       name: 'Chicken Lollipop',     price: 250, qty: 1 },
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

// Sound effects using Web Audio API
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
  const [status, setStatus] = useState('idle') // idle | connecting | connected | summary
  const [agentSpeaking, setAgentSpeaking] = useState(false)
  const [callDuration, setCallDuration] = useState(0)
  const [transcript, setTranscript] = useState([])
  const [showTranscript, setShowTranscript] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [orderItems, setOrderItems] = useState([])
  const [summaryItems, setSummaryItems] = useState([])
  const [summaryDuration, setSummaryDuration] = useState(0)
  // ── CHANGE 1: error state ──
  const [error, setError] = useState(null)
  const roomRef = useRef(null)
  const audioElemsRef = useRef([])
  const transcriptEndRef = useRef(null)
  const canvasRef = useRef(null)
  const animRef = useRef(null)
  // ── CHANGE 1: refs that always hold current values ──
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

  // Timer
  useEffect(()=>{
    let timer=null, checker=null
    if(status==='connected'){
      timer=setInterval(()=>setCallDuration(p=>p+1),1000)
      checker=setInterval(()=>{ const r=roomRef.current; if(r&&(r.state==='disconnected'||r.state==='failed')) handleDisconnect() },2000)
    } else if(status!=='summary') setCallDuration(0)
    return ()=>{ clearInterval(timer); clearInterval(checker) }
  },[status])

  // Live order tracking from transcript
  useEffect(()=>{
    if(status==='connected') setOrderItems(parseOrderFromTranscript(transcript))
  },[transcript, status])

  useEffect(()=>{ transcriptEndRef.current?.scrollIntoView({behavior:'smooth'}) },[transcript])

  function formatTime(s){ return `${Math.floor(s/60).toString().padStart(2,'0')}:${(s%60).toString().padStart(2,'0')}` }

  function cleanupAudio(){
    audioElemsRef.current.forEach(el=>{ el.pause(); el.srcObject=null; el.src=''; if(el.parentNode) el.parentNode.removeChild(el) })
    audioElemsRef.current=[]
  }

  function handleDisconnect(){
    cleanupAudio()
    // ── CHANGE 1: read from refs so values are always current ──
    const dur = callDurationRef.current
    const items = parseOrderFromTranscript(transcriptRef.current)
    setSummaryItems(items)
    setSummaryDuration(dur)
    playChime('disconnect')
    setStatus('summary')
    setAgentSpeaking(false)
    setMenuOpen(false)
    roomRef.current=null
    // Auto-reset after 6s
    setTimeout(()=>{
      setStatus('idle'); setTranscript([]); setShowTranscript(false)
      setOrderItems([]); setSummaryItems([]); setCallDuration(0)
    }, 6000)
  }

  // ── CHANGE 2: resetToIdle for "Place New Order" button ──
  function resetToIdle() {
    setStatus('idle')
    setTranscript([])
    setShowTranscript(false)
    setOrderItems([])
    setSummaryItems([])
    setCallDuration(0)
    setError(null)
  }

  function resetUI(){
    cleanupAudio(); setStatus('idle'); setAgentSpeaking(false)
    setCallDuration(0); setTranscript([]); setShowTranscript(false)
    setMenuOpen(false); setOrderItems([]); setSummaryItems([])
    setError(null)
    roomRef.current=null
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
    setStatus('connecting'); setTranscript([]); setMenuOpen(false); setOrderItems([])
    setError(null)
    try{
      // ── CHANGE 6: timeout on fetch ──
      const res = await fetch(`${import.meta.env.VITE_TOKEN_SERVER_URL}/token`, {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        signal: AbortSignal.timeout(8000),
      })
      if (!res.ok) throw new Error('Token server returned error')
      const {token, url} = await res.json()

      const room=new Room({reconnectPolicy:{nextRetryDelayInMs:()=>null}})
      roomRef.current=room
      room.on(RoomEvent.Disconnected,()=>setTimeout(()=>handleDisconnect(),300))
      room.on(RoomEvent.Connected,()=>{ setStatus('connected'); playChime('connect') })
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
      await room.connect(url,token)
      await room.localParticipant.publishTrack(await createLocalAudioTrack())
    }catch(e){
      console.error(e)
      cleanupAudio()
      roomRef.current = null
      // ── CHANGE 5: show error banner ──
      if (e.name === 'TimeoutError' || e.name === 'AbortError') {
        setError('Could not reach server. Please check your connection and try again.')
      } else if (e.message?.includes('Token server')) {
        setError('Server error. Please try again in a moment.')
      } else {
        setError('Connection failed. Please try again.')
      }
      setStatus('idle')
    }
  }

  async function endCall(){
    const room=roomRef.current; roomRef.current=null
    handleDisconnect(); if(room) await room.disconnect()
  }

  const isIdle=status==='idle', isConnecting=status==='connecting'
  const isConnected=status==='connected', isSummary=status==='summary'
  const orderTotal = orderItems.reduce((s,i)=>s+i.price*i.qty,0)
  const summaryTotal = summaryItems.reduce((s,i)=>s+i.price*i.qty,0)

  return (
    <div className="root" onClick={e=>{ if(menuOpen&&!e.target.closest('.menu-drawer')&&!e.target.closest('.menu-trigger')) setMenuOpen(false) }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Sans:wght@200;300;400;500&display=swap');
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
        html,body{background:#050A18;height:100%;overflow:hidden;}

        .root{
          min-height:100vh;width:100%;
          display:flex;flex-direction:column;align-items:center;justify-content:center;
          position:relative;overflow:hidden;font-family:'DM Sans',sans-serif;
        }

        /* NAV */
        .nav{
          position:fixed;top:0;left:0;right:0;padding:20px 40px;
          display:flex;justify-content:space-between;align-items:center;z-index:30;
        }
        .nav-logo{font-family:'DM Serif Display',serif;font-size:14px;letter-spacing:0.1em;color:rgba(255,255,255,0.88);}
        .nav-logo span{color:#7EB3FF;margin:0 5px;}
        .nav-right{display:flex;align-items:center;gap:16px;}
        .nav-tag{font-size:10px;letter-spacing:0.3em;text-transform:uppercase;color:rgba(255,255,255,0.18);font-weight:300;}
        .nav-line{position:absolute;bottom:0;left:40px;right:40px;height:1px;background:linear-gradient(90deg,transparent,rgba(126,179,255,0.1),rgba(255,255,255,0.05),rgba(126,179,255,0.1),transparent);}

        /* MENU TRIGGER */
        .menu-trigger{
          background:none;border:1px solid rgba(126,179,255,0.2);cursor:pointer;
          font-family:'DM Sans',sans-serif;font-size:10px;letter-spacing:0.28em;
          text-transform:uppercase;font-weight:300;color:rgba(126,179,255,0.55);
          padding:7px 16px;border-radius:20px;transition:all 0.3s;display:flex;align-items:center;gap:8px;
        }
        .menu-trigger:hover{color:rgba(126,179,255,0.9);border-color:rgba(126,179,255,0.45);background:rgba(126,179,255,0.06);}

        /* MENU DRAWER */
        .menu-overlay{position:fixed;inset:0;z-index:40;pointer-events:none;}
        .menu-overlay.open{pointer-events:all;}
        .menu-drawer{
          position:fixed;top:0;right:0;bottom:0;width:min(320px,90vw);
          background:linear-gradient(160deg,rgba(8,18,55,0.98) 0%,rgba(5,12,38,0.99) 100%);
          border-left:1px solid rgba(126,179,255,0.12);
          z-index:50;transform:translateX(100%);
          transition:transform 0.4s cubic-bezier(0.16,1,0.3,1);
          display:flex;flex-direction:column;
          box-shadow:-20px 0 60px rgba(0,0,40,0.5);
        }
        .menu-drawer.open{transform:translateX(0);}
        .drawer-header{padding:24px 24px 16px;border-bottom:1px solid rgba(126,179,255,0.08);display:flex;justify-content:space-between;align-items:center;}
        .drawer-title{font-family:'DM Serif Display',serif;font-size:20px;color:rgba(255,255,255,0.88);font-weight:400;letter-spacing:0.04em;}
        .drawer-title em{font-style:italic;color:#7EB3FF;}
        .drawer-close{background:none;border:none;cursor:pointer;color:rgba(255,255,255,0.3);font-size:18px;padding:4px 8px;transition:color 0.2s;line-height:1;}
        .drawer-close:hover{color:rgba(255,255,255,0.7);}
        .drawer-sub{padding:10px 24px 0;font-size:10px;letter-spacing:0.32em;text-transform:uppercase;color:rgba(126,179,255,0.35);font-weight:300;}
        .drawer-legend{display:flex;gap:16px;padding:10px 24px 8px;align-items:center;}
        .legend-item{display:flex;align-items:center;gap:6px;font-size:10px;color:rgba(255,255,255,0.25);font-weight:300;letter-spacing:0.08em;}
        .legend-dot{width:6px;height:6px;border-radius:2px;}
        .legend-dot.veg{background:#4CAF50;}
        .legend-dot.nonveg{background:#E53935;}
        .drawer-items{padding:10px 16px;display:flex;flex-direction:column;gap:8px;flex:1;overflow-y:auto;}
        .drawer-items::-webkit-scrollbar{width:1px;}
        .drawer-items::-webkit-scrollbar-thumb{background:rgba(126,179,255,0.15);}
        .d-item{padding:12px 14px;border-radius:8px;background:rgba(126,179,255,0.04);border:1px solid rgba(126,179,255,0.08);transition:all 0.2s;display:flex;align-items:center;gap:12px;}
        .d-item:hover{background:rgba(126,179,255,0.08);border-color:rgba(126,179,255,0.16);}
        .d-dot{width:8px;height:8px;border-radius:2px;flex-shrink:0;}
        .d-dot.veg{background:#4CAF50;box-shadow:0 0 6px rgba(76,175,80,0.4);}
        .d-dot.nonveg{background:#E53935;box-shadow:0 0 6px rgba(229,57,53,0.4);}
        .d-info{flex:1;}
        .d-name{font-size:13px;font-weight:400;color:rgba(220,230,255,0.88);margin-bottom:2px;}
        .d-desc{font-size:11px;font-weight:300;color:rgba(150,170,220,0.4);line-height:1.4;}
        .d-price{font-size:14px;font-weight:500;color:#7EB3FF;letter-spacing:0.02em;flex-shrink:0;}
        .drawer-footer{padding:16px 24px;border-top:1px solid rgba(126,179,255,0.07);font-size:10px;letter-spacing:0.2em;text-transform:uppercase;color:rgba(126,179,255,0.2);font-weight:300;text-align:center;}

        /* MAIN */
        .main{
          position:relative;z-index:2;
          display:flex;flex-direction:column;align-items:center;
          width:100%;padding:0 24px;
          transition:transform 0.4s cubic-bezier(0.16,1,0.3,1);
        }
        .main.shifted{transform:translateX(-160px);}

        /* TITLE */
        .title-section{text-align:center;margin-bottom:14px;}
        .title-eyebrow{font-size:10px;letter-spacing:0.42em;text-transform:uppercase;font-weight:300;color:rgba(126,179,255,0.55);margin-bottom:10px;}
        .title-main{
          font-family:'DM Serif Display',serif;
          font-size:clamp(22px,2.8vw,42px);
          color:#FFFFFF;letter-spacing:0.02em;line-height:1.1;font-weight:400;
          white-space:nowrap;
        }
        .title-main em{font-style:italic;color:#7EB3FF;}

        /* RING */
        .ring-system{position:relative;display:flex;align-items:center;justify-content:center;margin-bottom:28px;}
        .ring-outer{position:absolute;border-radius:50%;border:1px solid transparent;pointer-events:none;}
        .ring-d1{width:clamp(260px,36vw,340px);height:clamp(260px,36vw,340px);border-color:rgba(126,179,255,0.09);animation:rotateSlow 40s linear infinite;}
        .ring-d1::before{content:'';position:absolute;top:-3px;left:50%;width:6px;height:6px;border-radius:50%;background:rgba(126,179,255,0.6);transform:translateX(-50%);box-shadow:0 0 8px rgba(126,179,255,1);}
        .ring-d2{width:clamp(220px,30vw,290px);height:clamp(220px,30vw,290px);border-color:rgba(200,215,255,0.06);animation:rotateSlow 28s linear infinite reverse;}
        .ring-d2::before{content:'';position:absolute;bottom:-3px;left:50%;width:4px;height:4px;border-radius:50%;background:rgba(200,215,255,0.5);transform:translateX(-50%);box-shadow:0 0 6px rgba(200,215,255,0.8);}
        .ring-d3{width:clamp(300px,42vw,395px);height:clamp(300px,42vw,395px);border:none;background:radial-gradient(circle,transparent 45%,rgba(126,179,255,0.025) 50%,transparent 55%);}
        @keyframes rotateSlow{to{transform:rotate(360deg);}}
        .ring-ticks{position:absolute;width:clamp(260px,36vw,340px);height:clamp(260px,36vw,340px);border-radius:50%;pointer-events:none;}
        .tick{position:absolute;width:1px;height:6px;background:rgba(126,179,255,0.12);left:50%;top:0;transform-origin:50% 50%;}
        .tick.major{height:12px;background:rgba(126,179,255,0.3);width:1.5px;}
        .ring-glow{position:absolute;width:clamp(170px,22vw,244px);height:clamp(170px,22vw,244px);border-radius:50%;border:1px solid rgba(126,179,255,0.1);transition:all 0.8s ease;pointer-events:none;}
        .ring-glow.speaking{border-color:rgba(126,179,255,0.6);box-shadow:0 0 70px rgba(80,140,255,0.2),0 0 140px rgba(80,140,255,0.1),inset 0 0 70px rgba(80,140,255,0.06);animation:glowPulse 1.8s ease-in-out infinite;}
        @keyframes glowPulse{0%,100%{box-shadow:0 0 50px rgba(80,140,255,0.15),0 0 90px rgba(80,140,255,0.07);}50%{box-shadow:0 0 90px rgba(80,140,255,0.3),0 0 180px rgba(80,140,255,0.15);}}

        /* ORB */
        .center-orb{position:relative;width:clamp(150px,18vw,192px);height:clamp(150px,18vw,192px);border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;z-index:5;transition:transform 0.3s ease;}
        .center-orb:hover{transform:scale(1.03);}
        .center-orb:active{transform:scale(0.97);}
        .orb-bg{position:absolute;inset:0;border-radius:50%;background:radial-gradient(circle at 40% 35%,rgba(80,120,220,0.4) 0%,rgba(30,60,140,0.65) 40%,rgba(10,20,70,0.88) 100%);border:1px solid rgba(126,179,255,0.28);transition:all 0.6s ease;}
        .center-orb.speaking .orb-bg{background:radial-gradient(circle at 40% 35%,rgba(100,160,255,0.5) 0%,rgba(50,100,200,0.75) 40%,rgba(15,35,100,0.92) 100%);border-color:rgba(126,179,255,0.7);box-shadow:0 0 55px rgba(80,140,255,0.25),inset 0 0 35px rgba(80,140,255,0.1);}
        .orb-shine{position:absolute;width:60%;height:45%;top:8%;left:20%;border-radius:50%;background:radial-gradient(ellipse,rgba(200,220,255,0.13) 0%,transparent 70%);pointer-events:none;}
        .orb-content{position:relative;text-align:center;z-index:2;padding:12px;}
        .orb-icon{font-size:20px;margin-bottom:6px;}
        .orb-main-text{font-family:'DM Serif Display',serif;font-size:clamp(14px,1.6vw,18px);letter-spacing:0.04em;color:rgba(255,255,255,0.95);line-height:1.25;}
        .orb-sub-text{font-size:9px;letter-spacing:0.22em;text-transform:uppercase;font-weight:300;color:rgba(126,179,255,0.65);margin-top:6px;}
        .orb-bars{display:flex;align-items:center;justify-content:center;gap:3px;height:34px;margin-bottom:8px;}
        .obar{width:3px;border-radius:3px;transform-origin:center;background:linear-gradient(180deg,rgba(255,255,255,0.95),rgba(126,179,255,0.7));box-shadow:0 0 5px rgba(126,179,255,0.5);}
        .obar.off{height:4px;opacity:0.2;}
        .obar.on{animation:obarWave 0.75s ease-in-out infinite;opacity:1;}
        @keyframes obarWave{0%,100%{transform:scaleY(0.15);}50%{transform:scaleY(1);}}
        .orb-timer{font-size:clamp(18px,2.2vw,23px);letter-spacing:0.12em;font-weight:200;font-variant-numeric:tabular-nums;color:rgba(255,255,255,0.95);margin-bottom:4px;}
        .orb-status{font-size:9px;letter-spacing:0.28em;text-transform:uppercase;font-weight:300;transition:color 0.5s;}
        .orb-spinner{width:28px;height:28px;border-radius:50%;border:1.5px solid rgba(126,179,255,0.15);border-top-color:rgba(126,179,255,0.85);animation:spin 1s linear infinite;margin-bottom:8px;}
        @keyframes spin{to{transform:rotate(360deg);}}

        /* PRIYA AVATAR */
        .priya-avatar{
          width:48px;height:48px;border-radius:50%;
          background:radial-gradient(circle at 40% 35%,rgba(100,150,255,0.5),rgba(30,60,140,0.9));
          border:1px solid rgba(126,179,255,0.35);
          display:flex;align-items:center;justify-content:center;
          font-family:'DM Serif Display',serif;font-size:18px;color:rgba(255,255,255,0.9);
          font-style:italic;letter-spacing:0.04em;
          box-shadow:0 0 20px rgba(80,140,255,0.15);
          flex-shrink:0;
        }
        .priya-avatar.speaking{
          border-color:rgba(126,179,255,0.7);
          box-shadow:0 0 28px rgba(80,140,255,0.3);
          animation:avatarPulse 1.8s ease-in-out infinite;
        }
        @keyframes avatarPulse{0%,100%{box-shadow:0 0 20px rgba(80,140,255,0.2);}50%{box-shadow:0 0 36px rgba(80,140,255,0.45);}}

        /* CONNECTED TITLE */
        .connected-title{display:flex;align-items:center;gap:14px;margin-bottom:16px;animation:fadeUp 0.6s ease;flex-wrap:wrap;justify-content:center;}
        .connected-title h2{font-family:'DM Serif Display',serif;font-size:clamp(18px,2.2vw,24px);color:rgba(255,255,255,0.72);letter-spacing:0.06em;font-weight:400;}
        .connected-title h2 em{font-style:italic;color:#7EB3FF;}
        @keyframes fadeUp{from{opacity:0;transform:translateY(-10px);}to{opacity:1;transform:translateY(0);}}

        /* ── CHANGE 3: speaking indicator ── */
        .speaking-indicator{
          display:flex;align-items:center;gap:6px;
          width:100%;justify-content:center;margin-top:4px;
          animation:fadeUp 0.3s ease;
        }
        .speaking-dot{
          width:5px;height:5px;border-radius:50%;
          background:rgba(126,179,255,0.85);
          display:inline-block;
          animation:speakBounce 0.6s ease-in-out infinite;
        }
        @keyframes speakBounce{
          0%,100%{transform:translateY(0);opacity:0.4;}
          50%{transform:translateY(-4px);opacity:1;}
        }
        .speaking-label{
          font-size:10px;letter-spacing:0.18em;text-transform:uppercase;
          font-weight:300;color:rgba(126,179,255,0.65);
        }

        /* LIVE ORDER TRACKER */
        .order-tracker{
          position:fixed;left:24px;top:50%;transform:translateY(-50%);
          width:200px;z-index:10;
          animation:fadeUp 0.5s ease;
        }
        .tracker-header{font-size:9px;letter-spacing:0.28em;text-transform:uppercase;font-weight:300;color:rgba(126,179,255,0.4);margin-bottom:10px;padding-left:2px;}
        .tracker-items{display:flex;flex-direction:column;gap:6px;}
        .tracker-item{
          padding:8px 12px;border-radius:6px;
          background:rgba(8,18,55,0.85);
          border:1px solid rgba(126,179,255,0.1);
          display:flex;justify-content:space-between;align-items:center;
          animation:fadeUp 0.3s ease;
          backdrop-filter:blur(8px);
        }
        .tracker-item-left{display:flex;flex-direction:column;gap:2px;}
        .tracker-item-qty{font-size:9px;color:rgba(126,179,255,0.5);font-weight:300;letter-spacing:0.08em;}
        .tracker-item-name{font-size:12px;font-weight:400;color:rgba(220,230,255,0.82);}
        .tracker-item-price{font-size:12px;font-weight:500;color:#7EB3FF;}
        .tracker-total{
          margin-top:8px;padding:8px 12px;border-radius:6px;
          background:rgba(126,179,255,0.08);
          border:1px solid rgba(126,179,255,0.18);
          display:flex;justify-content:space-between;align-items:center;
        }
        .tracker-total-label{font-size:9px;letter-spacing:0.2em;text-transform:uppercase;color:rgba(255,255,255,0.4);font-weight:300;}
        .tracker-total-price{font-size:14px;font-weight:500;color:#7EB3FF;}

        /* SUMMARY SCREEN */
        .summary-screen{
          display:flex;flex-direction:column;align-items:center;
          animation:fadeUp 0.6s ease;
          width:100%;max-width:360px;
        }
        .summary-icon{
          width:64px;height:64px;border-radius:50%;
          background:radial-gradient(circle,rgba(100,200,120,0.25),rgba(30,80,50,0.6));
          border:1px solid rgba(100,200,120,0.35);
          display:flex;align-items:center;justify-content:center;
          font-size:26px;margin-bottom:20px;
          box-shadow:0 0 30px rgba(80,200,100,0.15);
        }
        .summary-title{font-family:'DM Serif Display',serif;font-size:26px;color:#FFFFFF;letter-spacing:0.04em;margin-bottom:6px;text-align:center;}
        .summary-sub{font-size:11px;letter-spacing:0.3em;text-transform:uppercase;color:rgba(126,179,255,0.4);font-weight:300;margin-bottom:28px;}
        .summary-items{width:100%;display:flex;flex-direction:column;gap:6px;margin-bottom:16px;}
        .summary-item{
          display:flex;justify-content:space-between;align-items:center;
          padding:10px 16px;border-radius:6px;
          background:rgba(126,179,255,0.05);
          border:1px solid rgba(126,179,255,0.09);
        }
        .summary-item-name{font-size:13px;font-weight:300;color:rgba(220,230,255,0.82);}
        .summary-item-right{display:flex;align-items:center;gap:10px;}
        .summary-item-qty{font-size:11px;color:rgba(126,179,255,0.4);font-weight:300;}
        .summary-item-price{font-size:13px;font-weight:500;color:#7EB3FF;}
        .summary-total{
          width:100%;display:flex;justify-content:space-between;align-items:center;
          padding:12px 16px;border-radius:6px;
          background:rgba(126,179,255,0.1);
          border:1px solid rgba(126,179,255,0.2);
          margin-bottom:20px;
        }
        .summary-total-label{font-size:11px;letter-spacing:0.22em;text-transform:uppercase;color:rgba(255,255,255,0.5);font-weight:300;}
        .summary-total-price{font-size:18px;font-weight:500;color:#7EB3FF;}
        .summary-duration{font-size:10px;letter-spacing:0.22em;text-transform:uppercase;color:rgba(255,255,255,0.15);font-weight:300;}
        .summary-bar{
          width:120px;height:2px;border-radius:2px;
          background:rgba(126,179,255,0.15);
          margin-top:20px;overflow:hidden;
        }
        .summary-bar-fill{height:100%;background:rgba(126,179,255,0.5);border-radius:2px;animation:drainBar 6s linear forwards;}
        @keyframes drainBar{from{width:100%;}to{width:0%;}}
        .summary-empty{font-size:13px;font-weight:300;color:rgba(255,255,255,0.25);text-align:center;margin-bottom:20px;}

        /* ── CHANGE 2: new order button ── */
        .new-order-btn{
          margin-top:20px;
          padding:12px 36px;
          background:rgba(126,179,255,0.08);
          border:1px solid rgba(126,179,255,0.25);
          border-radius:30px;
          color:rgba(126,179,255,0.75);
          font-family:'DM Sans',sans-serif;
          font-size:10px;letter-spacing:0.28em;text-transform:uppercase;font-weight:300;
          cursor:pointer;transition:all 0.25s ease;
        }
        .new-order-btn:hover{
          background:rgba(126,179,255,0.16);
          border-color:rgba(126,179,255,0.5);
          color:rgba(126,179,255,1);
        }

        /* ── CHANGE 5: error banner ── */
        .error-banner{
          position:fixed;top:72px;left:50%;transform:translateX(-50%);
          background:rgba(180,40,40,0.88);
          border:1px solid rgba(255,100,100,0.25);
          color:rgba(255,220,220,0.95);
          padding:10px 18px;border-radius:6px;
          font-size:11px;letter-spacing:0.06em;font-weight:300;
          display:flex;align-items:center;gap:12px;
          z-index:100;backdrop-filter:blur(10px);
          animation:fadeUp 0.3s ease;
          white-space:nowrap;
        }
        .error-dismiss{
          background:none;border:none;cursor:pointer;
          color:rgba(255,200,200,0.6);font-size:14px;padding:0;line-height:1;
          transition:color 0.2s;
        }
        .error-dismiss:hover{color:rgba(255,200,200,1);}

        /* BOTTOM PANEL */
        .bottom-panel{width:100%;max-width:400px;display:flex;flex-direction:column;align-items:center;gap:12px;}
        .status-badge{display:inline-flex;align-items:center;gap:8px;padding:6px 16px;border-radius:20px;border:1px solid rgba(126,179,255,0.1);background:rgba(126,179,255,0.04);margin-top:8px;}
        .badge-dot{width:5px;height:5px;border-radius:50%;flex-shrink:0;}
        .badge-text{font-size:10px;letter-spacing:0.28em;text-transform:uppercase;font-weight:300;}
        .t-toggle{background:none;border:none;cursor:pointer;font-family:'DM Sans',sans-serif;font-size:10px;letter-spacing:0.22em;text-transform:uppercase;font-weight:300;color:rgba(126,179,255,0.28);display:flex;align-items:center;gap:10px;padding:4px 0;transition:color 0.3s;}
        .t-toggle:hover{color:rgba(126,179,255,0.6);}
        .tl{width:24px;height:1px;background:currentColor;opacity:0.5;}
        .t-drawer{width:100%;max-height:160px;overflow-y:auto;display:flex;flex-direction:column;gap:8px;border-top:1px solid rgba(126,179,255,0.07);padding-top:12px;animation:fadeUp 0.3s ease;}
        .t-drawer::-webkit-scrollbar{width:1px;}
        .t-drawer::-webkit-scrollbar-thumb{background:rgba(126,179,255,0.2);}
        .msg{display:flex;flex-direction:column;animation:fadeUp 0.2s ease;}
        .msg.a{align-items:flex-start;}
        .msg.u{align-items:flex-end;}
        .msg-lbl{font-size:8px;letter-spacing:0.22em;text-transform:uppercase;font-weight:400;color:rgba(126,179,255,0.3);margin-bottom:3px;padding:0 4px;}
        .msg-txt{font-size:12px;line-height:1.6;font-weight:300;padding:7px 12px;max-width:85%;}
        .msg.a .msg-txt{color:rgba(220,230,255,0.85);background:rgba(126,179,255,0.07);border:1px solid rgba(126,179,255,0.12);border-radius:0 10px 10px 10px;}
        .msg.u .msg-txt{color:rgba(255,255,255,0.75);background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.08);border-radius:10px 0 10px 10px;}
        .end-btn{background:none;border:1px solid rgba(220,60,60,0.35);cursor:pointer;font-family:'DM Sans',sans-serif;font-size:10px;letter-spacing:0.38em;text-transform:uppercase;font-weight:400;color:rgba(240,100,100,0.6);padding:11px 36px;border-radius:4px;transition:all 0.3s ease;box-shadow:0 0 12px rgba(220,60,60,0.08);}
        .end-btn:hover{color:rgba(255,120,120,0.9);border-color:rgba(220,60,60,0.7);background:rgba(220,60,60,0.06);box-shadow:0 0 20px rgba(220,60,60,0.15);}

        .footer{position:fixed;bottom:16px;left:50%;transform:translateX(-50%);font-size:9px;letter-spacing:0.22em;text-transform:uppercase;font-weight:300;color:rgba(126,179,255,0.08);white-space:nowrap;pointer-events:none;z-index:2;}

        /* MOBILE */
        @media(max-width:600px){
          .nav{padding:16px 20px;}
          .nav-logo{font-size:12px;}
          .nav-tag{display:none;}
          .order-tracker{display:none;}
          .title-main{white-space:normal;font-size:28px;}
          .ring-d1{width:280px!important;height:280px!important;}
          .ring-d2{width:236px!important;height:236px!important;}
          .ring-d3{width:320px!important;height:320px!important;}
          .ring-glow{width:192px!important;height:192px!important;}
          .ring-ticks{width:280px!important;height:280px!important;}
          .center-orb{width:160px!important;height:160px!important;}
          .main.shifted{transform:translateX(0);}
          .error-banner{white-space:normal;max-width:90vw;text-align:center;}
        }
      `}</style>

      <canvas ref={canvasRef} style={{position:'fixed',inset:0,width:'100%',height:'100%',pointerEvents:'none',zIndex:0}}/>

      {/* Nav */}
      <nav className="nav">
        <div className="nav-logo">PEPPERS <span>·</span> FAMILY</div>
        <div className="nav-right">
          <button className="menu-trigger" onClick={()=>setMenuOpen(p=>!p)}>
            {menuOpen ? '✕ Close' : '☰ Menu'}
          </button>
          <div className="nav-tag">Est. Tamilnadu</div>
        </div>
        <div className="nav-line"/>
      </nav>

      {/* ── CHANGE 5: error banner ── */}
      {error && (
        <div className="error-banner">
          <span>⚠ {error}</span>
          <button className="error-dismiss" onClick={() => setError(null)}>✕</button>
        </div>
      )}

      {/* Menu drawer */}
      <div className={`menu-overlay ${menuOpen?'open':''}`}>
        <div className={`menu-drawer ${menuOpen?'open':''}`}>
          <div className="drawer-header">
            <div className="drawer-title">Today's <em>Menu</em></div>
            <button className="drawer-close" onClick={()=>setMenuOpen(false)}>✕</button>
          </div>
          <p className="drawer-sub">Peppers Family Restaurant</p>
          <div className="drawer-legend">
            <div className="legend-item"><div className="legend-dot veg"/>Vegetarian</div>
            <div className="legend-item"><div className="legend-dot nonveg"/>Non-Veg</div>
          </div>
          <div className="drawer-items">
            {MENU_ITEMS.map((item,i)=>(
              <div key={i} className="d-item">
                <div className={`d-dot ${item.type}`}/>
                <div className="d-info">
                  <div className="d-name">{item.name}</div>
                  <div className="d-desc">{item.desc}</div>
                </div>
                <div className="d-price">{item.price}</div>
              </div>
            ))}
          </div>
          <div className="drawer-footer">Speak your order to Priya</div>
        </div>
      </div>

      {/* Live order tracker */}
      {isConnected && orderItems.length > 0 && (
        <div className="order-tracker">
          <div className="tracker-header">Your Order</div>
          <div className="tracker-items">
            {orderItems.map((item,i)=>(
              <div key={i} className="tracker-item">
                <div className="tracker-item-left">
                  <span className="tracker-item-qty">{item.qty}×</span>
                  <span className="tracker-item-name">{item.name}</span>
                </div>
                <span className="tracker-item-price">₹{item.price*item.qty}</span>
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
      <div className={`main ${menuOpen?'shifted':''}`}>

        {/* SUMMARY SCREEN */}
        {isSummary && (
          <div className="summary-screen">
            <div className="summary-icon">✓</div>
            <h2 className="summary-title">Order Placed!</h2>
            <p className="summary-sub">Thank you for ordering</p>
            {summaryItems.length > 0 ? (
              <>
                <div className="summary-items">
                  {summaryItems.map((item,i)=>(
                    <div key={i} className="summary-item">
                      <span className="summary-item-name">{item.name}</span>
                      <div className="summary-item-right">
                        <span className="summary-item-qty">{item.qty}×</span>
                        <span className="summary-item-price">₹{item.price*item.qty}</span>
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
            <div className="summary-bar"><div className="summary-bar-fill"/></div>
            {/* ── CHANGE 2: Place New Order button ── */}
            <button className="new-order-btn" onClick={resetToIdle}>
              Place New Order
            </button>
          </div>
        )}

        {/* IDLE / CONNECTING */}
        {(isIdle||isConnecting) && (
          <div className="title-section">
            <p className="title-eyebrow">Fine Dining · Tamilnadu</p>
            <h1 className="title-main">Peppers <em>Family</em> Restaurant</h1>
          </div>
        )}

        {/* CONNECTED TITLE with avatar */}
        {isConnected && (
          <div className="connected-title">
            <div className={`priya-avatar ${agentSpeaking?'speaking':''}`}>P</div>
            <h2>Speaking with <em>Priya</em></h2>
            {/* ── CHANGE 3: speaking indicator ── */}
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

        {/* RING — hidden during summary */}
        {!isSummary && (
          <div className="ring-system">
            <div className="ring-outer ring-d3"/>
            <div className="ring-outer ring-d1"/>
            <div className="ring-outer ring-d2"/>
            <div className="ring-ticks">
              {Array.from({length:60},(_,i)=>{
                const ringSize = window.innerWidth <= 600 ? 140 : 170
                return (
                  <div key={i} className={`tick ${i%5===0?'major':''}`}
                    style={{transform:`rotate(${i*6}deg) translateX(-50%)`,transformOrigin:`50% ${ringSize}px`}}/>
                )
              })}
            </div>
            {/* ── CHANGE 4: orb glow brighter when speaking ── */}
            <div className={`ring-glow ${agentSpeaking?'speaking':''}`}
              style={agentSpeaking ? {
                opacity:1,
                background:'radial-gradient(circle,rgba(100,160,255,0.45) 0%,rgba(60,100,200,0.12) 60%,transparent 100%)',
                transform:'scale(1.12)',
                transition:'all 0.4s ease',
              } : {
                opacity:0.4,
                transition:'all 0.4s ease',
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
              <div className={`center-orb ${agentSpeaking?'speaking':''}`} style={{cursor:'default'}}>
                {/* ── CHANGE 4: orb color changes when speaking ── */}
                <div className="orb-bg" style={agentSpeaking ? {
                  background:'radial-gradient(circle at 40% 35%,rgba(120,170,255,0.55) 0%,rgba(50,100,210,0.8) 45%,rgba(12,28,90,0.96) 100%)',
                  borderColor:'rgba(126,179,255,0.75)',
                  boxShadow:'0 0 60px rgba(80,140,255,0.3),inset 0 0 40px rgba(80,140,255,0.12)',
                  transition:'all 0.4s ease',
                } : {
                  transition:'all 0.4s ease',
                }}/>
                <div className="orb-shine"/>
                <div className="orb-content">
                  <div className="orb-bars">
                    {[1,2,4,7,10,13,10,7,4,2,1].map((h,i)=>(
                      <div key={i} className={`obar ${agentSpeaking?'on':'off'}`}
                        style={{height:`${h*2.8}px`,animationDelay:`${i*0.08}s`}}/>
                    ))}
                  </div>
                  <p className="orb-timer">{formatTime(callDuration)}</p>
                  <p className="orb-status" style={{color:agentSpeaking?'rgba(126,179,255,0.9)':'rgba(255,255,255,0.28)',transition:'color 0.4s ease'}}>
                    {agentSpeaking?'Priya speaking':'Listening'}
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
                      {msg.role==='agent'&&<span className="msg-lbl">Priya</span>}
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