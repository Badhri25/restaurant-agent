import asyncio
import sys
import logging
from dotenv import load_dotenv
from livekit import agents
from livekit.agents import Agent, AgentServer, AgentSession, JobContext, room_io
from livekit.agents import function_tool
from livekit.plugins import noise_cancellation
from livekit.plugins import groq as lk_groq
from livekit.plugins import assemblyai as lk_assemblyai
from livekit.plugins import cartesia as lk_cartesia

# Fix for Windows + Python 3.12/3.13: livekit-agents IPC uses Unix-style pipes
# which conflict with the default IocpProactor event loop on Windows.
# Switching to SelectorEventLoop fixes WinError 87 and duplex_unix errors.
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

load_dotenv()

MENU = """
- Chicken Biryani       220 rupees  (non-veg)
- Mutton Biryani        280 rupees  (non-veg)
- Paneer Butter Masala  180 rupees  (veg)
- Garlic Naan            50 rupees  (veg)
- Chicken Lollipop      250 rupees  (non-veg)
"""


class RestaurantAgent(Agent):
    def __init__(self, room):
        self._room = room
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
6. When the customer confirms nothing else is needed:
   - Say out loud: "Thank you for ordering with Peppers Family Restaurant! Your order has been placed successfully. Please check your inbox for the order confirmation and tracking details. Have a great day! Goodbye!"
   - Then call the end_call tool
   - IMPORTANT: You must finish saying the entire farewell message before calling end_call

IMPORTANT — avoid repetition:
- Do NOT repeat the full order summary or total price after every side question
- Side questions (payment method, delivery time, etc.) get a short direct answer only
- Only give the full order recap once: when the customer confirms they are done ordering

Fallback rules:
- If someone asks for something NOT on the menu, say "Sorry, we don't have that today" and suggest the closest item
- If asked about delivery time, payment methods, address, or anything not on this menu, say "I'm not sure about that, but our staff will assist you when your order arrives"
- If the customer is frustrated, repeats the same complaint twice, or explicitly asks to speak to a human or manager, say "I understand, let me connect you with our team right away" then call the end_call tool
- If you didn't understand something, say "Sorry, could you say that again?" — never guess
- If someone is rude, stay calm and polite
- Never make up prices or items not on the menu
""",
        )

    @function_tool()
    async def end_call(self):
        """
        Call this tool after you have fully spoken the farewell message.
        Waits for speech to finish then disconnects the call cleanly.
        """
        logging.info("end_call triggered — waiting for TTS to finish")
        await asyncio.sleep(12)
        logging.info("disconnecting room now")
        try:
            await self._room.disconnect()
        except Exception as e:
            logging.warning(f"disconnect error (safe to ignore): {e}")


server = AgentServer()


@server.rtc_session()
async def entrypoint(ctx: JobContext):
    session = AgentSession(
        stt=lk_assemblyai.STT(
            end_of_turn_confidence_threshold=0.7,  # 0.0-1.0; higher = waits for more confident end-of-turn signal
        ),
        llm=lk_groq.LLM(model="llama-3.3-70b-versatile"),
        tts=lk_cartesia.TTS(),
        # No vad= (removed Silero — was 5-6x slower than realtime on CPU)
        # No turn_detection= (removed MultilingualModel — was timing out)
    )

    await session.start(
        agent=RestaurantAgent(room=ctx.room),
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