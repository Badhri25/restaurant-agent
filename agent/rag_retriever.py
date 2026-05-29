import os
import logging
from dotenv import load_dotenv
from pinecone import Pinecone
from sentence_transformers import SentenceTransformer

load_dotenv()
log = logging.getLogger(__name__)

PINECONE_API_KEY = os.getenv("PINECONE_API_KEY")
INDEX_NAME       = os.getenv("PINECONE_INDEX_NAME", "voice-agent-rag")
NAMESPACE        = os.getenv("PINECONE_NAMESPACE", "bridaltraditionsnc")
TOP_K            = int(os.getenv("TOP_K_RESULTS", 5))
EMBED_MODEL      = "all-MiniLM-L6-v2"
MIN_SCORE        = 0.35


class RAGRetriever:

    def __init__(self):
        log.info(f"Loading embedding model: {EMBED_MODEL}")
        self._embedder = SentenceTransformer(EMBED_MODEL)
        self._pc       = Pinecone(api_key=PINECONE_API_KEY)
        self._index    = self._pc.Index(INDEX_NAME)
        log.info(f"RAGRetriever ready → index='{INDEX_NAME}', namespace='{NAMESPACE}', top_k={TOP_K}")

    def _embed_query(self, query: str) -> list:
        return self._embedder.encode([query])[0].tolist()

    def _search_pinecone(self, query_vector: list) -> list:
        results = self._index.query(
            vector=query_vector,
            top_k=TOP_K,
            namespace=NAMESPACE,
            include_metadata=True,
        )
        return results.get("matches", [])

    def retrieve(self, query: str) -> str:
        if not query or not query.strip():
            return ""

        try:
            query_vec = self._embed_query(query)
            matches   = self._search_pinecone(query_vec)

            if not matches:
                log.debug("No matches found in Pinecone")
                return ""

            relevant = [m for m in matches if m.get("score", 0) >= MIN_SCORE]

            if not relevant:
                log.debug(f"All matches below threshold {MIN_SCORE}. Top score: {matches[0].get('score', 0):.3f}")
                return ""

            context_parts = []
            for i, match in enumerate(relevant, 1):
                text  = match["metadata"].get("text", "").strip()
                score = match.get("score", 0)
                if text:
                    context_parts.append(f"[Source {i} | relevance: {score:.2f}]\n{text}")
                    log.debug(f"  chunk {i}: score={score:.3f}, text[:80]={text[:80]!r}")

            if not context_parts:
                return ""

            context = "\n\n".join(context_parts)
            log.info(f"RAG: retrieved {len(relevant)} chunks for query: {query[:60]!r}")
            return context

        except Exception as e:
            log.warning(f"RAG retrieval error (non-fatal): {e}")
            return ""

    def stats(self) -> dict:
        try:
            s  = self._index.describe_index_stats()
            ns = s.get("namespaces", {}).get(NAMESPACE, {})
            return {
                "total_vectors":     s.get("total_vector_count", 0),
                "namespace_vectors": ns.get("vector_count", 0),
                "namespace":         NAMESPACE,
                "index":             INDEX_NAME,
            }
        except Exception as e:
            return {"error": str(e)}