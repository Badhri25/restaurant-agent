require('dotenv').config()
const express = require('express')
const cors = require('cors')
const { AccessToken } = require('livekit-server-sdk')

const app = express()
app.use(cors({
  origin: '*'
}))
app.use(express.json())

app.post('/token', async (req, res) => {
  // unique room name every call — forces a fresh agent each time
  const roomName = `restaurant-room-${Date.now()}`

  const token = new AccessToken(
    process.env.LIVEKIT_API_KEY,
    process.env.LIVEKIT_API_SECRET,
    { identity: 'customer-1' }
  )
  token.addGrant({
    room: roomName,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
  })

  res.json({
    token: await token.toJwt(),
    url: process.env.LIVEKIT_URL,
    room: roomName
  })
})

app.listen(process.env.PORT, () =>
  console.log(`Token server running on http://localhost:${process.env.PORT}`)
)