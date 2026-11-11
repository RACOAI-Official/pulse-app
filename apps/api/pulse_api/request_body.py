from fastapi import HTTPException, Request


async def read_limited_body(request: Request, max_bytes: int, error_detail: str) -> bytes:
    parts: list[bytes] = []
    size = 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > max_bytes:
            raise HTTPException(413, error_detail)
        parts.append(chunk)
    return b"".join(parts)
