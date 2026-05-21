import logging
from dotenv import load_dotenv
from livekit import agents
from livekit.agents import Agent, AgentServer, AgentSession, JobContext, room_io
from livekit.plugins import noise_cancellation, silero
from livekit.plugins import groq as lk_groq
from livekit.plugins import assemblyai as lk_assemblyai
from livekit.plugins import cartesia as lk_cartesia
from livekit.plugins.turn_detector.multilingual import MultilingualModel

load_dotenv()

MENU = """
- Chicken Biryani       220 rupees
- Mutton Biryani        280 rupees
- Paneer Butter Masala  180 rupees
- Garlic Naan           50 rupees
- Chicken Lollipop      250 rupees
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
3. Take their order carefully, repeat back each item as they order
4. When they are done, read back the FULL order with quantities and total price
5. Ask "Anything else I can help you with?" before saying goodbye
6. Only say goodbye AFTER the customer says bye first
7. Never end the call on your own

Fallback rules:
- If someone asks for something NOT on the menu, say "Sorry, we don't have that today" and suggest the closest item
- If you didn't understand something, say "Sorry, could you say that again?" — never guess
- If someone is rude, stay calm and polite
- Never make up prices or items not on the menu
""",
        )

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

    await session.start(
        agent=RestaurantAgent(),
        room=ctx.room,
        room_options=room_io.RoomOptions(
            audio_input=room_io.AudioInputOptions(
                noise_cancellation=noise_cancellation.BVC(),
            ),
        ),
    )

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    agents.cli.run_app(server)