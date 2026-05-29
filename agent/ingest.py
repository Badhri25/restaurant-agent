import os
import sys
import asyncio
import logging
import hashlib
from dotenv import load_dotenv
from pinecone import Pinecone, ServerlessSpec
from langchain_community.document_loaders import PlaywrightURLLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from sentence_transformers import SentenceTransformer

load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

TARGET_URL       = os.getenv("TARGET_URL", "https://bridaltraditionsnc.com")
PINECONE_API_KEY = os.getenv("PINECONE_API_KEY")
INDEX_NAME       = os.getenv("PINECONE_INDEX_NAME", "voice-agent-rag")
NAMESPACE        = os.getenv("PINECONE_NAMESPACE", "bridaltraditionsnc")
CHUNK_SIZE       = int(os.getenv("CHUNK_SIZE", 500))
CHUNK_OVERLAP    = int(os.getenv("CHUNK_OVERLAP", 50))
EMBED_MODEL      = "all-MiniLM-L6-v2"
EMBED_DIM        = 384
UPSERT_BATCH     = 50


async def scrape(url: str) -> list:
    log.info(f"Scraping: {url}")
    loader = PlaywrightURLLoader(
        urls=[url],
        headless=True,
    )
    docs = await loader.aload()
    log.info(f"Scraped {len(docs)} page(s), total chars: {sum(len(d.page_content) for d in docs)}")
    return docs


def chunk_documents(docs: list) -> list:
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=CHUNK_SIZE,
        chunk_overlap=CHUNK_OVERLAP,
        separators=["\n\n", "\n", ". ", " ", ""],
        length_function=len,
    )
    chunks = splitter.split_documents(docs)
    log.info(f"Created {len(chunks)} chunks")
    return chunks


def embed_texts(texts: list) -> list:
    log.info(f"Loading embedding model: {EMBED_MODEL}")
    model = SentenceTransformer(EMBED_MODEL)
    log.info(f"Embedding {len(texts)} chunks locally...")
    vectors = model.encode(texts, show_progress_bar=True).tolist()
    log.info(f"Embedded {len(vectors)} chunks → {len(vectors[0])}d vectors")
    return vectors


def setup_pinecone_index(pc: Pinecone):
    existing = [idx.name for idx in pc.list_indexes()]
    if INDEX_NAME not in existing:
        log.info(f"Creating Pinecone index '{INDEX_NAME}' (dim={EMBED_DIM}, metric=cosine)...")
        pc.create_index(
            name=INDEX_NAME,
            dimension=EMBED_DIM,
            metric="cosine",
            spec=ServerlessSpec(cloud="aws", region="us-east-1"),
        )
        log.info("Index created")
    else:
        log.info(f"Index '{INDEX_NAME}' already exists")
    return pc.Index(INDEX_NAME)


def upsert_to_pinecone(index, chunks: list, vectors: list) -> int:
    records = []
    for i, (chunk, vector) in enumerate(zip(chunks, vectors)):
        text = chunk.page_content.strip()
        if not text:
            continue
        chunk_id = hashlib.md5(text.encode()).hexdigest()
        records.append({
            "id": chunk_id,
            "values": vector,
            "metadata": {
                "text": text,
                "source": chunk.metadata.get("source", TARGET_URL),
                "chunk_index": i,
                "url": TARGET_URL,
            },
        })

    total_upserted = 0
    for i in range(0, len(records), UPSERT_BATCH):
        batch = records[i : i + UPSERT_BATCH]
        index.upsert(vectors=batch, namespace=NAMESPACE)
        total_upserted += len(batch)
        log.info(f"Upserted {total_upserted}/{len(records)} vectors...")

    log.info(f"Total upserted: {total_upserted} vectors into namespace '{NAMESPACE}'")
    return total_upserted


async def run_ingestion(url: str = None):
    target = url or TARGET_URL
    log.info("=" * 60)
    log.info("RAG INGESTION PIPELINE")
    log.info(f"URL       : {target}")
    log.info(f"Namespace : {NAMESPACE}")
    log.info(f"Index     : {INDEX_NAME}")
    log.info("=" * 60)

    log.info("\n[1/4] SCRAPING WEBSITE...")
    docs = await scrape(target)
    if not docs:
        log.error("No content scraped. Check URL and Playwright install.")
        return 0

    log.info("\n[2/4] CHUNKING TEXT...")
    chunks = chunk_documents(docs)
    if not chunks:
        log.error("No chunks created.")
        return 0

    log.info("\n[3/4] EMBEDDING CHUNKS...")
    texts = [c.page_content for c in chunks]
    vectors = embed_texts(texts)

    log.info("\n[4/4] STORING IN PINECONE...")
    pc = Pinecone(api_key=PINECONE_API_KEY)
    index = setup_pinecone_index(pc)
    total = upsert_to_pinecone(index, chunks, vectors)

    log.info("=" * 60)
    log.info("INGESTION COMPLETE")
    log.info(f"{total} chunks indexed from {target}")
    log.info("Voice agent is ready to answer questions!")
    log.info("=" * 60)
    return total


if __name__ == "__main__":
    url_arg = sys.argv[1] if len(sys.argv) > 1 else None
    asyncio.run(run_ingestion(url_arg))