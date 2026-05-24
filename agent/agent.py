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
    def __init__(self, room, session):
        self._room = room
        self._session = session
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
1. Greet the customer warmly and mention Peppers Family Restaurant
2. Tell them the menu if they ask
3. Take their order carefully, confirm each item as they add it
4. When they say they are done, read back the FULL order with quantities and total price ONCE clearly
5. Ask "Anything else I can help you with?" ONLY ONCE after reading back the full order — never repeat this question
6. When the customer confirms nothing else is needed:
   - Say exactly: "Thank you for ordering with Peppers Family Restaurant! Your order has been placed successfully. Please check your inbox for the order confirmation and tracking details. Have a great day! Goodbye!"
   - Then immediately call the end_call tool

IMPORTANT rules to avoid repetition:
- Do NOT repeat the full order summary or total price more than once
- Do NOT ask "Anything else?" more than once per call — ask it only after the final order recap
- Side questions (payment method, delivery time, etc.) get a short direct answer only
- Never ask "Anything else?" in the middle of taking an order

Fallback rules:
- If someone asks for something NOT on the menu, say "Sorry, we don't have that today" and suggest the closest item
- If asked about delivery time, payment methods, address, say "I'm not sure about that, but our staff will assist you when your order arrives"
- If the customer is frustrated or asks to speak to a human, say "I understand, let me connect you with our team right away" then call end_call
- If you didn't understand something, say "Sorry, could you say that again?" — never guess
- Never make up prices or items not on the menu
""",
        )

    @function_tool()
    async def end_call(self):
        """
        Call this tool immediately after finishing the farewell message.
        Waits for all pending TTS audio to finish then disconnects cleanly.
        """
        logging.info("end_call triggered — waiting for TTS to drain")
        try:
            # Wait for TTS playback to finish using session audio drain
            await self._session.drain()
        except Exception:
            await asyncio.sleep(10)
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
            end_of_turn_confidence_threshold=0.5,
        ),
        llm=lk_groq.LLM(model="llama-3.3-70b-versatile"),
        tts=lk_cartesia.TTS(
            voice="a0e99841-438c-4a64-b679-ae501e7d6091",
            model="sonic-2",
        ),
    )

    await session.start(
        agent=RestaurantAgent(room=ctx.room, session=session),
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