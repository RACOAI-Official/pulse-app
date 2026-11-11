"""Image fingerprint service for Pulse: turns a product or customer photo into a vector.

Internal only (no published port). The model downloads once into MODEL_CACHE (a Docker volume).
Unicom ViT-B/32 is trained for image retrieval, so unrelated photos score near 0 and
photos of the same item score high, which makes a confidence cut-off reliable.
"""

import io
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastembed import ImageEmbedding
from PIL import Image, UnidentifiedImageError

MODEL_NAME = os.environ.get("VISION_MODEL", "Qdrant/Unicom-ViT-B-32")
MODEL_CACHE = os.environ.get("MODEL_CACHE", "/models")
THREADS = int(os.environ.get("VISION_THREADS", "2"))
MAX_BYTES = 15 * 1024 * 1024
state: dict = {}


@asynccontextmanager
async def lifespan(_: FastAPI):
    state["model"] = await run_in_threadpool(ImageEmbedding, model_name=MODEL_NAME,
                                             cache_dir=MODEL_CACHE, threads=THREADS)
    yield


app = FastAPI(title="Pulse vision", version="0.1.0", lifespan=lifespan)


@app.get("/health")
def health() -> dict:
    return {"ok": "model" in state, "model": MODEL_NAME}


def _embed(body: bytes) -> list[float]:
    try:
        image = Image.open(io.BytesIO(body))
        image.load()
        image = image.convert("RGB")
    except (UnidentifiedImageError, OSError) as exc:
        raise HTTPException(415, "Not a readable image") from exc
    vector = next(iter(state["model"].embed([image])))
    return [round(float(x), 6) for x in vector]


@app.post("/embed")
async def embed(request: Request) -> dict:
    body = await request.body()
    if not body or len(body) > MAX_BYTES:
        raise HTTPException(413 if body else 400, "Send one image up to 15 MB as the request body")
    vector = await run_in_threadpool(_embed, body)
    return {"model": MODEL_NAME, "dimensions": len(vector), "embedding": vector}
