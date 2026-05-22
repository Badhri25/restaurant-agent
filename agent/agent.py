import logging
from dotenv import load_dotenv
from livekit import agents
from livekit.agents import Agent, AgentServer, AgentSession, JobContext, room_io
from livekit.agents import function_tool          # FIX 1: for the goodbye tool
from livekit.plugins import noise_cancellation, silero
from livekit.plugins import groq as lk_groq
from livekit.plugins import assemblyai as lk_assemblyai
from livekit.plugins import cartesia as lk_cartesia
from livekit.plugins.turn_detector.multilingual import MultilingualModel
 
load_dotenv()
 
MENU = """
- Chicken Biryani       220 rupees  (non-veg)
- Mutton Biryani        280 rupees  (non-veg)
- Paneer Butter Masala  180 rupees  (veg)
- Garlic Naan            50 rupees  (veg)
- Chicken Lollipop      250 rupees  (non-veg)
"""
 
 
class RestaurantAgent(Agent):
    def __init__(self):
        super().__init__(
            instructions=f"""
You are Priya, a warm and cheerful order-taker at Peppers Family Restaurant in Tamilnadu.
 
The menu is:
{MENU}
 
Your personality:
- Friendly and welcoming, like talking to a helpful local
- Speak in short natural sentences — this is a voice call, not a text chat
- Use simple English, occasionally warm phrases like "Sure!", "Of course!", "Great choice!"
- Never sound robotic or formal
 
Your job:
1. Greet the customer warmly by name of the restaurant
2. Tell them the menu if they ask
3. Take their order carefully, confirm each item as they add it
4. When they say they are done, read back the FULL order with quantities and total price ONCE
5. Ask "Anything else I can help you with?" ONLY after reading back the full order
6. After the customer confirms and says goodbye, say exactly:
   "Thank you for ordering with Peppers Family Restaurant! Your order has been placed successfully. Please check your inbox for the order confirmation and tracking details. Have a great day! Goodbye!"
   Then immediately call the end_call tool. Say this ONCE and never repeat it.
 
IMPORTANT — avoid repetition:
- Do NOT repeat the full order summary or total price after every side question (delivery time, payment, etc.)
- Side questions (payment method, delivery time, etc.) get a short direct answer only
- Only give the full order recap once: when the customer confirms they are done ordering
 
Fallback rules:
- If someone asks for something NOT on the menu, say "Sorry, we don't have that today" and suggest the closest item
- If asked about delivery time or payment methods, say "I'm not sure about that, but our staff will assist you when your order arrives"
- If you didn't understand something, say "Sorry, could you say that again?" — never guess
- If someone is rude, stay calm and polite
- Never make up prices or items not on the menu
- If the customer is frustrated, repeats the same complaint twice, or explicitly asks
  to speak to a human or manager, say: "I understand, let me connect you with our
  team right away." Then call the end_call tool.
""",
        )
 
    # FIX 1: Tool the agent can call to disconnect the room server-side
    @function_tool()
    async def end_call(self):
        """Call this tool immediately after saying the final goodbye message to end the call."""
        # ctx is available via the session's room reference injected at runtime
        # We raise a special signal the session runner picks up
        raise EndCallSignal()
 
 
# FIX 1: sentinel exception used to signal a clean call end
class EndCallSignal(Exception):
    pass
 
 
server = AgentServer()
 
 
@server.rtc_session()
async def entrypoint(ctx: JobContext):
    vad = silero.VAD.load()
 
    session = AgentSession(
        stt=lk_assemblyai.STT(),
        llm=lk_groq.LLM(model="llama-3.3-70b-versatile"),
        tts=lk_cartesia.TTS(),
        vad=vad,
        turn_detection=MultilingualModel(),
    )
 
    try:
        await session.start(
            agent=RestaurantAgent(),
            room=ctx.room,
            room_options=room_io.RoomOptions(
                audio_input=room_io.AudioInputOptions(
                    noise_cancellation=noise_cancellation.BVC(),
                ),
            ),
        )
    except EndCallSignal:
        # FIX 1: agent called end_call — disconnect the room cleanly
        logging.info("Agent signalled end_call — disconnecting room")
        await ctx.room.disconnect()
 
 
if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    agents.cli.run_app(server)