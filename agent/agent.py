"""
agent.py — LiveKit Voice Agent with RAG
────────────────────────────────────────────────────────────────
RAG is injected per-turn:
  user speaks → STT → text
    → RAGRetriever.retrieve(text) → relevant chunks from Pinecone
    → inject as context into LLM system prompt for THAT turn
    → LLM answers grounded in retrieved content
    → TTS → voice response
"""

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
from rag_retriever import RAGRetriever

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

load_dotenv()
logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)

# ── Initialise RAG Retriever once (shared across sessions) ────────────────────
# This connects to Pinecone at startup. All agent sessions reuse this.
try:
    retriever = RAGRetriever()
    rag_stats = retriever.stats()
    log.info(f"✅ RAG ready: {rag_stats['namespace_vectors']} vectors in namespace '{rag_stats['namespace']}'")
    if rag_stats['namespace_vectors'] == 0:
        log.warning("⚠️  No vectors found! Run: python ingest.py")
except Exception as e:
    log.error(f"❌ RAG init failed: {e}")
    log.error("   Ensure PINECONE_API_KEY and GROQ_API_KEY are set in .env")
    log.error("   Run: python ingest.py  to index the website first")
    retriever = None


# ── Base instructions (always present) ────────────────────────────────────────
BASE_INSTRUCTIONS = """
You are a helpful, warm voice assistant for this business's website.

CORE RULES:
- Answer ONLY based on the WEBSITE CONTEXT provided below each turn
- If the context doesn't contain the answer, say:
  "I don't have that information, but you can find more details on our website."
- Keep answers SHORT and CONVERSATIONAL — this is a voice call, not an email
- No bullet points or markdown — speak naturally in sentences
- If asked something completely unrelated to the business, politely redirect:
  "I'm here to help with questions about our services. What can I help you with?"
- Be warm, friendly, and professional at all times
- For prices, availability, or booking — give the info from context, then offer to help further

VOICE STYLE:
- Short sentences (under 20 words ideally)
- Natural pauses implied by punctuation
- Avoid jargon or overly formal language
"""

GREETING = (
    "Hello! Welcome. I'm your virtual assistant for this website. "
    "How can I help you today?"
)

FAREWELL = (
    "Thank you for calling. Have a wonderful day! Goodbye!"
)


# ── RAG-Augmented Agent ────────────────────────────────────────────────────────
class RAGVoiceAgent(Agent):
    def __init__(self, room, session):
        self._room    = room
        self._session = session

        # Build initial instructions with empty context placeholder
        # Context is injected dynamically per-turn via on_user_turn_completed
        super().__init__(instructions=BASE_INSTRUCTIONS)

    def _build_instructions_with_context(self, context: str) -> str:
        """
        Inject RAG-retrieved context into the LLM system prompt.
        Called fresh on every user turn so context is always relevant.
        """
        if not context:
            return BASE_INSTRUCTIONS + "\n\n[No website context available for this query.]"

        return (
            BASE_INSTRUCTIONS
            + "\n\n"
            + "=" * 50
            + "\nWEBSITE CONTEXT (use this to answer the user):\n"
            + "=" * 50
            + "\n"
            + context
            + "\n"
            + "=" * 50
            + "\n"
            + "Answer based on the above context. Be concise and conversational."
        )

    async def on_user_turn_completed(self, turn_ctx, new_message):
        """
        LiveKit hook — fired after every user speech turn, BEFORE LLM generates reply.
        This is where we inject RAG context dynamically.

        Flow per turn:
          1. Get user's transcribed text
          2. Retrieve relevant chunks from Pinecone (cosine similarity)
          3. Update agent's instructions with fresh context
          4. LLM generates answer grounded in that context
        """
        user_text = ""

        # Extract text from the new message
        for item in new_message.items:
            if hasattr(item, "text") and item.text:
                user_text += item.text + " "

        user_text = user_text.strip()

        if user_text and retriever:
            log.info(f"👤 User said: {user_text!r}")

            # Query Pinecone with the user's text
            context = retriever.retrieve(user_text)

            if context:
                log.info(f"📚 Injecting {len(context)} chars of RAG context")
            else:
                log.info("📭 No relevant context found — agent will use general knowledge")

            # Update instructions with fresh context for this turn
            self.instructions = self._build_instructions_with_context(context)

        await super().on_user_turn_completed(turn_ctx, new_message)

    @function_tool()
    async def end_call(self):
        """
        Gracefully end the call after user says goodbye or conversation is complete.
        """
        log.info("end_call triggered")
        try:
            await self._session.say(FAREWELL, allow_interruptions=False)
        except Exception as e:
            log.warning(f"TTS error during farewell: {e}")
            await asyncio.sleep(2)
        await asyncio.sleep(2)
        try:
            await self._room.disconnect()
        except Exception as e:
            log.warning(f"Disconnect error: {e}")


# ── Agent Server ───────────────────────────────────────────────────────────────
server = AgentServer()


@server.rtc_session()
async def entrypoint(ctx: JobContext):
    session = AgentSession(
        stt=lk_assemblyai.STT(
            end_of_turn_confidence_threshold=0.5,
        ),
        llm=lk_groq.LLM(model="llama-3.3-70b-versatile"),
        tts=lk_cartesia.TTS(
            voice="f786b574-daa5-4673-aa0c-cbe3e8534c02",
            model="sonic-2",
        ),
    )

    await session.start(
        agent=RAGVoiceAgent(room=ctx.room, session=session),
        room=ctx.room,
        room_options=room_io.RoomOptions(
            audio_input=room_io.AudioInputOptions(
                noise_cancellation=noise_cancellation.BVC(),
            ),
        ),
    )

    await session.say(GREETING, allow_interruptions=True)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    agents.cli.run_app(server)