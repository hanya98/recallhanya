"""RecallOS API — FastAPI entrypoint."""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import structlog

from app.routers import memories, search, collections, graph, settings, auth
from app.deps import lifespan

log = structlog.get_logger()

app = FastAPI(
    title="RecallOS API",
    version="0.1.0",
    description="An AI second brain that remembers what you browse.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request, exc):
    body = await request.body()
    body_str = body.decode("utf-8", errors="ignore") if body else ""
    log.error("Validation Error", path=request.url.path, errors=exc.errors(), body_preview=body_str[:300])
    return JSONResponse(
        status_code=422,
        content={"detail": exc.errors(), "body_preview": body_str[:200]},
    )

# Routers
app.include_router(auth.router, prefix="/v1/auth", tags=["auth"])
app.include_router(memories.router, prefix="/v1/memories", tags=["memories"])
app.include_router(search.router, prefix="/v1/search", tags=["search"])
app.include_router(collections.router, prefix="/v1/collections", tags=["collections"])
app.include_router(graph.router, prefix="/v1/graph", tags=["graph"])
app.include_router(settings.router, prefix="/v1/settings", tags=["settings"])


@app.get("/healthz")
async def healthz():
    return {"ok": True}


@app.get("/readyz")
async def readyz():
    # Check DB + Redis here
    return {"ok": True}
