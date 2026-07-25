# -*- coding: utf-8 -*-
"""AIArb plugin HTTP routes."""

from __future__ import annotations

import asyncio
import json
import mimetypes
import re
import shutil
import tempfile
import zipfile
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, ConfigDict, model_validator

from ..pet_desktop.emitter import (
    desktop_status_summary,
    emit_pet_event,
    start_desktop_interactive,
    switch_pet_desktop,
)
from ..pet_desktop.pet_paths import list_installed_pets, pets_install_dir


class SwitchPetRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    pet_dir: str | None = None
    pet_id: str | None = None

    @model_validator(mode="after")
    def _one_target(self) -> SwitchPetRequest:
        d = (self.pet_dir or "").strip()
        i = (self.pet_id or "").strip()
        if bool(d) == bool(i):
            raise ValueError("provide exactly one of pet_dir or pet_id")
        return self


class EmitPayload(BaseModel):
    event: str
    text: str | None = None
    state: str | None = None
    duration_ms: int | None = None


class ImportPetRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Absolute path to either:
    #   * a folder containing ``pet.json`` + ``spritesheet.webp``, or
    #   * a ``.zip`` whose top level (or single nested folder) contains
    #     ``pet.json`` + ``spritesheet.webp``.
    path: str
    # Overwrite an already-installed pet with the same id.
    replace: bool = True


_SAFE_PET_FOLDER = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$")
# Used to validate the pet id we derive from pet.json / the source folder
# before it becomes a directory under ``<WORKING_DIR>/pets/`` — keeps an
# untrusted manifest from creating ``../etc/foo`` etc.
_SAFE_PET_ID = _SAFE_PET_FOLDER


def _safe_extract_zip(zip_path: Path, dest: Path) -> None:
    """Extract *zip_path* into *dest*, rejecting any entry that escapes it.

    Guards against zip-slip: every member's resolved path must stay
    under ``dest``. Windows-style backslashes are normalised before the
    check so cross-platform archives behave the same way.
    """
    dest_resolved = dest.resolve()
    with zipfile.ZipFile(zip_path) as zf:
        for info in zf.infolist():
            name = info.filename.replace("\\", "/")
            parts = Path(name).parts
            if name.startswith("/") or ".." in parts:
                raise HTTPException(
                    status_code=400,
                    detail=f"unsafe zip entry: {info.filename}",
                )
            target = (dest_resolved / name).resolve()
            try:
                target.relative_to(dest_resolved)
            except ValueError as exc:
                raise HTTPException(
                    status_code=400,
                    detail=f"zip entry escapes target: {info.filename}",
                ) from exc
        zf.extractall(dest_resolved)


def _resolve_pet_source(extracted: Path) -> Path:
    """Locate the pet package root inside an unpacked directory.

    Supports two layouts so both ``zip -r foo.zip pet-dir/`` and Finder's
    "Compress" produce a usable archive:

    1. ``<extracted>/pet.json``                — flat archive
    2. ``<extracted>/<single subdir>/pet.json`` — nested in one folder
    """
    if (extracted / "pet.json").is_file():
        return extracted
    children = [p for p in extracted.iterdir() if p.is_dir()]
    if len(children) == 1 and (children[0] / "pet.json").is_file():
        return children[0]
    raise HTTPException(
        status_code=400,
        detail="pet package must contain pet.json at its root",
    )


def _install_from_source(source: Path, *, replace: bool) -> dict[str, object]:
    """Validate ``source`` as a pet package and install it.

    Common tail shared by every import path (JSON ``path`` body and
    multipart upload). Returns the JSON response payload; raises
    ``HTTPException`` for any user-visible failure.
    """
    # Lazy import: pulls Pillow + the desktop runtime package only for
    # callers that actually import a pet.
    from ..pet_desktop import pet_package

    try:
        manifest, _sheet = pet_package.validate_pet_package(source)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    pet_id = str(manifest.get("id") or source.name)
    if not _SAFE_PET_ID.fullmatch(pet_id):
        raise HTTPException(
            status_code=400,
            detail=(
                f"pet id {pet_id!r} is not a safe folder name "
                "(letters, digits, '.', '_', '-' only)"
            ),
        )

    try:
        target = pet_package.install_pet(source, replace=replace)
    except FileExistsError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    return {
        "ok": True,
        "petId": pet_id,
        "path": str(target),
        "displayName": str(
            manifest.get("displayName") or manifest.get("name") or pet_id,
        ),
    }


def _safe_join(root: Path, relative: str) -> Path:
    """Resolve ``relative`` under ``root`` rejecting any escape attempt.

    Normalises ``\\`` to ``/`` so cross-platform multipart uploads (the
    browser sends ``webkitRelativePath`` with forward slashes; Windows
    archivers occasionally use backslashes) all land in the same tree.
    """
    name = relative.replace("\\", "/").strip()
    if not name:
        raise HTTPException(status_code=400, detail="upload entry has no name")
    parts = Path(name).parts
    if name.startswith("/") or ".." in parts:
        raise HTTPException(
            status_code=400,
            detail=f"unsafe upload entry: {relative}",
        )
    root_r = root.resolve()
    dest = (root_r / name).resolve()
    try:
        dest.relative_to(root_r)
    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail=f"upload entry escapes target: {relative}",
        ) from exc
    return dest


def _resolved_pet_spritesheet_path(folder: str) -> Path:
    """Return spritesheet path for ``pets/<folder>`` or raise HTTPException."""
    if not _SAFE_PET_FOLDER.fullmatch(folder):
        raise HTTPException(status_code=400, detail="invalid pet folder name")
    root = pets_install_dir().resolve()
    pet_dir = (root / folder).resolve()
    try:
        pet_dir.relative_to(root)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="pet not found") from exc
    if not pet_dir.is_dir():
        raise HTTPException(status_code=404, detail="pet not found")
    manifest_path = pet_dir / "pet.json"
    if not manifest_path.is_file():
        raise HTTPException(status_code=404, detail="missing pet.json")
    try:
        data = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        # The manifest came in via ``/import-pet`` / ``/import-pet-upload``
        # — so a malformed ``pet.json`` is client-supplied data, not a
        # server-internal fault. Return 400 instead of 500 so the
        # console can surface the right message to the user.
        raise HTTPException(
            status_code=400,
            detail="invalid pet.json",
        ) from exc
    except OSError as exc:
        # The ``is_file()`` check above raced with a concurrent delete
        # or the file became unreadable: that *is* a server-side I/O
        # failure, so 500 is the correct code.
        raise HTTPException(
            status_code=500,
            detail=f"failed to read pet.json: {exc}",
        ) from exc
    rel = data.get("spritesheetPath")
    if not isinstance(rel, str) or not rel.strip():
        raise HTTPException(status_code=404, detail="missing spritesheetPath")
    sheet = (pet_dir / rel).resolve()
    try:
        sheet.relative_to(pet_dir)
    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail="invalid spritesheet path",
        ) from exc
    if not sheet.is_file():
        raise HTTPException(status_code=404, detail="spritesheet file missing")
    return sheet


class CreatePetRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    pet_id: str
    display_name: str
    description: str = ""
    template_id: str = "arbpet"
    color_tone: str | None = None  # "golden" | "cool" | "warm" | "natural"


# Preset templates — each maps to the bundled default spritesheet with metadata
_PET_TEMPLATES = [
    {
        "id": "arbpet",
        "name": "ArbPet Lion",
        "description": "A brave little lion with golden fur and a tiny crown",
        "tags": ["lion", "golden", "crown", "brave"],
    },
    {
        "id": "cat",
        "name": "Neko Cat",
        "description": "A playful kitten with soft orange tabby fur",
        "tags": ["cat", "orange", "playful", "cute"],
    },
    {
        "id": "dog",
        "name": "Puppy Pal",
        "description": "A loyal puppy with brown spots and floppy ears",
        "tags": ["dog", "brown", "loyal", "puppy"],
    },
    {
        "id": "robot",
        "name": "Bot Companion",
        "description": "A friendly robot with glowing blue eyes",
        "tags": ["robot", "blue", "tech", "future"],
    },
]


def _apply_color_tone(spritesheet_path: Path, tone: str, out_path: Path | None = None) -> Path:
    """Apply a color tone adjustment to a spritesheet copy.

    Uses numpy for vectorised pixel operations (~1000x faster than the
    previous per-pixel Python loop).  The output is written to
    *out_path* (or a temp file when ``None``) — **never** to the source
    directory, which may be read-only in a packaged installation.
    """
    try:
        from PIL import Image, ImageEnhance
    except ImportError:
        # Pillow not available — return original path (no adjustment)
        return spritesheet_path

    tone_presets = {
        "golden": {"r_mul": 1.15, "r_add": 30, "g_mul": 1.05, "g_add": 10, "b_mul": 0.75, "b_add": -10},
        "cool": {"r_mul": 0.85, "r_add": -5, "g_mul": 1.0, "g_add": 5, "b_mul": 1.2, "b_add": 20},
        "warm": {"r_mul": 1.1, "r_add": 15, "g_mul": 1.0, "g_add": 0, "b_mul": 0.9, "b_add": -5},
        "natural": {"r_mul": 1.0, "r_add": 0, "g_mul": 1.0, "g_add": 0, "b_mul": 1.0, "b_add": 0},
    }
    p = tone_presets.get(tone, tone_presets["natural"])

    img = Image.open(spritesheet_path).convert("RGBA")

    # --- numpy vectorised path (preferred when available) ---
    try:
        import numpy as np

        arr = np.array(img, dtype=np.float32)  # H×W×4
        r, g, b, a = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2], arr[:, :, 3]

        # Masks matching the original per-pixel logic
        transparent = a == 0
        very_dark = (r < 30) & (g < 30) & (b < 30)
        skip = transparent | very_dark

        avg = (r + g + b) / 3.0
        bright = avg > 100
        medium = (avg > 50) & ~bright
        adjust = ~skip

        # Full adjustment for bright pixels
        new_r = np.clip(r * p["r_mul"] + p["r_add"], 0, 255)
        new_g = np.clip(g * p["g_mul"] + p["g_add"], 0, 255)
        new_b = np.clip(b * p["b_mul"] + p["b_add"], 0, 255)

        # Reduced adjustment for medium pixels (95% mul, 50% add)
        med_r = np.clip(r * p["r_mul"] * 0.95 + p["r_add"] * 0.5, 0, 255)
        med_g = np.clip(g * p["g_mul"] * 0.95 + p["g_add"] * 0.5, 0, 255)
        med_b = np.clip(b * p["b_mul"] * 0.95 + p["b_add"] * 0.5, 0, 255)

        # Blend: bright pixels get full, medium get reduced, rest unchanged
        out_r = np.where(bright & adjust, new_r, np.where(medium & adjust, med_r, r))
        out_g = np.where(bright & adjust, new_g, np.where(medium & adjust, med_g, g))
        out_b = np.where(bright & adjust, new_b, np.where(medium & adjust, med_b, b))

        arr[:, :, 0] = out_r
        arr[:, :, 1] = out_g
        arr[:, :, 2] = out_b

        result = Image.fromarray(arr.astype(np.uint8), "RGBA")
    except ImportError:
        # Fallback: no numpy — use PIL point() lookup tables (still fast)
        result = img

        def _make_lut(mul: float, add: float) -> list[int]:
            return [max(0, min(255, int(v * mul + add))) for v in range(256)]

        r_ch, g_ch, b_ch, a_ch = result.split()
        r_ch = r_ch.point(_make_lut(p["r_mul"], p["r_add"]))
        g_ch = g_ch.point(_make_lut(p["g_mul"], p["g_add"]))
        b_ch = b_ch.point(_make_lut(p["b_mul"], p["b_add"]))
        result = Image.merge("RGBA", (r_ch, g_ch, b_ch, a_ch))

    if tone != "natural":
        result = ImageEnhance.Color(result).enhance(1.3)

    # Always write to a temp location — never to the (possibly read-only)
    # source directory.
    import tempfile

    if out_path is None:
        out_path = Path(tempfile.mktemp(suffix=f"_{tone}.webp", prefix="aiarb-pet-tone-"))
    result.save(out_path, "WEBP", quality=90)
    return out_path


def build_router() -> APIRouter:
    router = APIRouter(prefix="/aiarb-pet", tags=["pet"])


    class ChatRequest(BaseModel):
        model_config = ConfigDict(extra="forbid")
        pet_id: str
        message: str
        session_id: str | None = None


    class SetBindingRequest(BaseModel):
        model_config = ConfigDict(extra="forbid")
        agent_id: str
        agent_name: str = ""
        session_id: str | None = None


    # ── Binding management ────────────────────────────────────────

    @router.get("/bindings")
    def list_bindings_route():
        from ..pet_desktop import pet_agent_binding
        return {"ok": True, "bindings": pet_agent_binding.list_bindings()}

    @router.get("/bindings/{pet_id}")
    def get_binding_route(pet_id: str):
        from ..pet_desktop import pet_agent_binding
        if not _SAFE_PET_FOLDER.fullmatch(pet_id):
            raise HTTPException(status_code=400, detail="invalid pet_id")
        binding = pet_agent_binding.get_binding(pet_id)
        if not binding:
            raise HTTPException(status_code=404, detail="no binding for this pet")
        return {"ok": True, "binding": binding}

    @router.put("/bindings/{pet_id}")
    def set_binding_route(pet_id: str, payload: SetBindingRequest):
        from ..pet_desktop import pet_agent_binding
        if not _SAFE_PET_FOLDER.fullmatch(pet_id):
            raise HTTPException(status_code=400, detail="invalid pet_id")
        binding = pet_agent_binding.set_binding(
            pet_id=pet_id,
            agent_id=payload.agent_id,
            agent_name=payload.agent_name,
            session_id=payload.session_id,
        )
        return {"ok": True, "binding": binding}

    @router.delete("/bindings/{pet_id}")
    def remove_binding_route(pet_id: str):
        from ..pet_desktop import pet_agent_binding
        if not _SAFE_PET_FOLDER.fullmatch(pet_id):
            raise HTTPException(status_code=400, detail="invalid pet_id")
        removed = pet_agent_binding.remove_binding(pet_id)
        return {"ok": True, "removed": removed}

    # ── Chat endpoint (SSE streaming) ─────────────────────────────

    @router.post("/chat")
    async def chat_with_agent(payload: ChatRequest, request: Request):
        """Forward a pet chat message to the bound agent and stream the reply.

        Returns a Server-Sent Events stream. Each event is a JSON object
        with a ``type`` field:

        * ``{"type": "start", "state": "thinking"}``
        * ``{"type": "token", "text": "..."}``  — incremental reply text
        * ``{"type": "tool", "name": "..."}``  — agent invoked a tool
        * ``{"type": "done", "text": "..."}``   — full reply assembled
        * ``{"type": "error", "message": "..."}``
        """
        from ..pet_desktop import pet_agent_binding

        pet_id = payload.pet_id.strip()
        if not _SAFE_PET_FOLDER.fullmatch(pet_id):
            raise HTTPException(status_code=400, detail="invalid pet_id")
        if not payload.message.strip():
            raise HTTPException(status_code=400, detail="message is empty")

        binding = pet_agent_binding.get_binding(pet_id)
        if not binding or not binding.get("agent_id"):
            raise HTTPException(
                status_code=404,
                detail=f"pet '{pet_id}' has no bound agent. Bind one first.",
            )

        agent_id = binding["agent_id"]
        session_id = payload.session_id or binding.get("session_id") or f"pet-{pet_id}"

        async def event_generator():
            try:
                # Resolve the agent workspace
                manager = request.app.state.multi_agent_manager
                workspace = await manager.get_agent(agent_id)

                # Build an AgentRequest — minimal payload matching the
                # console chat flow.
                from ..agents.acp.server import AgentRequest, Message

                req = AgentRequest(
                    input=[Message(role="user", content=[
                        {"type": "text", "text": payload.message},
                    ])],
                    session_id=session_id,
                    agent_id=agent_id,
                )

                yield f'data: {json.dumps({"type": "start", "state": "thinking"}, ensure_ascii=False)}\n\n'

                full_text_parts: list[str] = []

                async for envelope in workspace.stream_query(req):
                    if await request.is_disconnected():
                        break

                    obj = getattr(envelope, "object", None)
                    msg_type = getattr(envelope, "type", None)
                    status = getattr(envelope, "status", None)
                    content = getattr(envelope, "content", None)

                    # Extract text deltas
                    if obj == "message" and msg_type == "message":
                        if isinstance(content, list):
                            for block in content:
                                text = None
                                if isinstance(block, dict):
                                    if block.get("type") == "text":
                                        text = block.get("text")
                                elif hasattr(block, "text"):
                                    text = getattr(block, "text", None)
                                if text:
                                    full_text_parts.append(text)
                                    evt = {"type": "token", "text": text}
                                    yield f'data: {json.dumps(evt, ensure_ascii=False)}\n\n'

                    # Tool invocation
                    elif obj == "message" and msg_type == "plugin_call" and status == "completed":
                        tool_name = ""
                        if isinstance(content, list) and content:
                            first = content[0]
                            if isinstance(first, dict):
                                tool_name = first.get("name", "")
                            elif hasattr(first, "name"):
                                tool_name = getattr(first, "name", "")
                        if tool_name:
                            evt = {"type": "tool", "name": tool_name[:60]}
                            yield f'data: {json.dumps(evt, ensure_ascii=False)}\n\n'

                full_text = "".join(full_text_parts)
                done_evt = {"type": "done", "text": full_text, "state": "idle"}
                yield f'data: {json.dumps(done_evt, ensure_ascii=False)}\n\n'

            except asyncio.CancelledError:
                yield f'data: {json.dumps({"type": "error", "message": "cancelled"}, ensure_ascii=False)}\n\n'
                raise
            except Exception as exc:
                evt = {"type": "error", "message": f"{type(exc).__name__}: {exc}"[:200]}
                yield f'data: {json.dumps(evt, ensure_ascii=False)}\n\n'

        return StreamingResponse(
            event_generator(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )

    @router.get("/status")
    def status():
        return {
            "ok": True,
            "plugin": "aiarb-pet",
            "desktop": desktop_status_summary(),
        }

    @router.get("/pets")
    def list_pets():
        return {
            "ok": True,
            "petsDir": str(pets_install_dir()),
            "pets": list_installed_pets(),
        }

    @router.get("/pets/{folder}/spritesheet")
    def pet_spritesheet(folder: str):
        """Serve the raw spritesheet image for console previews.

        Auth via the AIArb API.
        """
        sheet = _resolved_pet_spritesheet_path(folder)
        media_type, _ = mimetypes.guess_type(str(sheet))
        if not media_type:
            media_type = "application/octet-stream"
        return FileResponse(sheet, media_type=media_type)

    @router.post("/pets/{folder}/spritesheet")
    def replace_spritesheet(folder: str, file: UploadFile = File(...)):
        """Replace a pet's spritesheet with a user-uploaded image.

        Validates that the uploaded image is exactly 1536×1872 (8 cols ×
        9 rows of 192×208 cells). Accepts webp/png. The original file is
        backed up as ``spritesheet.bak.webp`` before overwriting.
        """
        if not _SAFE_PET_FOLDER.fullmatch(folder):
            raise HTTPException(status_code=400, detail="invalid folder name")
        from ..pet_desktop import runtime
        from ..pet_desktop.sprites import ATLAS_WIDTH, ATLAS_HEIGHT

        pet_dir = runtime.pets_dir() / folder
        manifest_path = pet_dir / "pet.json"
        if not manifest_path.is_file():
            raise HTTPException(status_code=404, detail=f"pet not found: {folder}")

        # Read manifest to find spritesheet filename
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except Exception:
            manifest = {}
        sheet_name = manifest.get("spritesheetPath", "spritesheet.webp")
        if not isinstance(sheet_name, str) or not sheet_name:
            sheet_name = "spritesheet.webp"
        # Prevent path traversal
        if "/" in sheet_name or "\\" in sheet_name or ".." in sheet_name:
            raise HTTPException(status_code=400, detail="invalid spritesheetPath in pet.json")

        sheet_path = pet_dir / sheet_name

        # Read uploaded file into a temp buffer first, validate dimensions
        upload_bytes = file.file.read()
        if not upload_bytes:
            raise HTTPException(status_code=400, detail="empty file")

        try:
            from PIL import Image
            import io
            img = Image.open(io.BytesIO(upload_bytes))
            if img.size != (ATLAS_WIDTH, ATLAS_HEIGHT):
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"spritesheet must be {ATLAS_WIDTH}x{ATLAS_HEIGHT} "
                        f"(8 cols × 9 rows of 192×208 cells); got {img.size[0]}x{img.size[1]}"
                    ),
                )
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(
                status_code=400,
                detail=f"invalid image file: {exc}",
            ) from exc

        # Backup original (once — don't overwrite an existing backup)
        backup_path = pet_dir / "spritesheet.bak.webp"
        if sheet_path.is_file() and not backup_path.is_file():
            shutil.copy2(sheet_path, backup_path)

        # Write new spritesheet (convert to webp for consistency)
        try:
            from PIL import Image
            import io
            img = Image.open(io.BytesIO(upload_bytes)).convert("RGBA")
            img.save(sheet_path, "WEBP", quality=95)
        except Exception:
            # Fallback: write raw bytes
            sheet_path.write_bytes(upload_bytes)

        return {
            "ok": True,
            "petId": folder,
            "spritesheet": sheet_name,
            "size": f"{ATLAS_WIDTH}x{ATLAS_HEIGHT}",
        }

    @router.delete("/pets/{folder}")
    def delete_pet(folder: str):
        """Delete an installed pet by folder name."""
        if not _SAFE_PET_FOLDER.fullmatch(folder):
            raise HTTPException(status_code=400, detail="invalid folder name")
        from ..pet_desktop import runtime
        pet_dir = runtime.pets_dir() / folder
        if not pet_dir.is_dir():
            raise HTTPException(status_code=404, detail=f"pet not found: {folder}")
        # Don't allow deleting the bundled default
        if folder == "arbpet":
            raise HTTPException(status_code=400, detail="cannot delete the default pet")
        shutil.rmtree(pet_dir, ignore_errors=True)
        return {"ok": True, "deleted": folder}

    @router.post("/desktop/start")
    def desktop_start():
        return start_desktop_interactive()

    @router.post("/emit-test")
    def emit_test(payload: EmitPayload):
        emit_pet_event(
            payload.event,
            text=payload.text,
            state=payload.state,
            duration_ms=payload.duration_ms,
            manual=True,
        )
        return {"ok": True}

    @router.post("/switch-pet")
    def switch_pet_route(payload: SwitchPetRequest):
        return switch_pet_desktop(
            pet_dir=payload.pet_dir,
            pet_id=payload.pet_id,
        )

    @router.post("/import-pet")
    def import_pet(payload: ImportPetRequest):
        """Install a pet from a *local* folder or ``.zip`` archive.

        Programmatic / CLI path: the file must already exist on the
        server's filesystem. For browser uploads use
        ``/import-pet-upload`` instead.
        """
        raw = (payload.path or "").strip()
        if not raw:
            raise HTTPException(status_code=400, detail="path is required")
        src = Path(raw).expanduser()
        if not src.is_absolute():
            raise HTTPException(
                status_code=400,
                detail="path must be absolute",
            )
        src = src.resolve()
        if not src.exists():
            raise HTTPException(
                status_code=404,
                detail=f"path not found: {src}",
            )

        tmp_root: Path | None = None
        try:
            if src.is_dir():
                source_dir = src
            elif src.is_file() and src.suffix.lower() == ".zip":
                tmp_root = Path(
                    tempfile.mkdtemp(prefix="aiarb-pet-import-"),
                )
                _safe_extract_zip(src, tmp_root)
                source_dir = _resolve_pet_source(tmp_root)
            else:
                raise HTTPException(
                    status_code=400,
                    detail="path must be a directory or a .zip file",
                )
            return _install_from_source(source_dir, replace=payload.replace)
        finally:
            if tmp_root is not None:
                shutil.rmtree(tmp_root, ignore_errors=True)

    @router.post("/import-pet-upload")
    def import_pet_upload(
        files: list[UploadFile] = File(...),
        replace: bool = Form(True),
    ):
        """Install a pet from a multipart upload (browser Dropzone).

        Declared as a **synchronous** route so FastAPI runs it in a
        thread pool — the tempdir writes and ``shutil.copyfileobj``
        would otherwise block the ASGI event loop on large uploads.

        Two upload shapes are supported:

        * **Single ``.zip``** — when exactly one file is uploaded and
          its name ends with ``.zip``, the archive is extracted in a
          tempdir (with zip-slip protection) and the resulting layout
          handled like ``/import-pet``.
        * **Folder upload** — when multiple files are uploaded, each
          file's name (typically ``webkitRelativePath`` set by the
          browser when a directory is dropped) is treated as a path
          relative to a tempdir; the resulting directory is then
          installed.

        The ``replace`` form field accepts the usual truthy strings
        (``true``, ``1``, ``yes``, ``on``).
        """
        if not files:
            raise HTTPException(
                status_code=400,
                detail="no files uploaded",
            )

        tmp_root = Path(tempfile.mkdtemp(prefix="aiarb-pet-upload-"))
        extract_root: Path | None = None
        try:
            for uf in files:
                dest = _safe_join(tmp_root, uf.filename or "")
                dest.parent.mkdir(parents=True, exist_ok=True)
                with dest.open("wb") as out:
                    shutil.copyfileobj(uf.file, out)

            children = list(tmp_root.iterdir())
            single_zip = (
                len(children) == 1
                and children[0].is_file()
                and children[0].suffix.lower() == ".zip"
            )
            if single_zip:
                extract_root = Path(
                    tempfile.mkdtemp(prefix="aiarb-pet-upload-zip-"),
                )
                _safe_extract_zip(children[0], extract_root)
                source_dir = _resolve_pet_source(extract_root)
            else:
                source_dir = _resolve_pet_source(tmp_root)

            return _install_from_source(source_dir, replace=replace)
        finally:
            shutil.rmtree(tmp_root, ignore_errors=True)
            if extract_root is not None:
                shutil.rmtree(extract_root, ignore_errors=True)


    # ── Create-pet & templates endpoints ──────────────────────────

    @router.get("/templates")
    def list_templates():
        """List available pet templates for the visual creation wizard."""
        return {"ok": True, "templates": _PET_TEMPLATES}

    @router.get("/templates/{template_id}/preview")
    @router.get("/templates/{template_id}/spritesheet")
    def template_preview(template_id: str):
        """Serve the preview image for a template."""
        # All templates use the bundled default spritesheet as base
        from ..pet_desktop.pet_package import bundled_default_pet_dir
        pet_dir = bundled_default_pet_dir()
        sheet = pet_dir / "spritesheet.webp"
        if not sheet.is_file():
            raise HTTPException(status_code=404, detail="template preview not found")
        return FileResponse(sheet, media_type="image/webp")

    @router.post("/create-pet")
    def create_pet(payload: CreatePetRequest):
        """Create a new pet from a template with custom name/description.

        Visual creation flow — no file upload needed. Uses the bundled
        default spritesheet (optionally color-adjusted) and writes a
        custom pet.json with the user's name and description.
        """
        from ..pet_desktop.pet_package import (
            bundled_default_pet_dir,
            install_pet,
        )
        from ..pet_desktop import runtime

        pet_id = payload.pet_id.strip()
        if not _SAFE_PET_ID.fullmatch(pet_id):
            raise HTTPException(
                status_code=400,
                detail="pet_id must be alphanumeric (letters, digits, '.', '_', '-' only)",
            )

        template_dir = bundled_default_pet_dir()
        if not template_dir.is_dir():
            raise HTTPException(
                status_code=500,
                detail="bundled default pet template not found",
            )

        # Build the pet package in a temp dir
        import tempfile
        tmp_dir = Path(tempfile.mkdtemp(prefix="aiarb-pet-create-"))
        try:
            # Copy spritesheet (optionally color-adjusted)
            src_sheet = template_dir / "spritesheet.webp"
            if payload.color_tone and payload.color_tone != "natural":
                adjusted = _apply_color_tone(src_sheet, payload.color_tone)
                shutil.copy2(adjusted, tmp_dir / "spritesheet.webp")
                if adjusted != src_sheet:
                    adjusted.unlink(missing_ok=True)
            else:
                shutil.copy2(src_sheet, tmp_dir / "spritesheet.webp")

            # Write custom pet.json
            manifest = {
                "id": pet_id,
                "displayName": payload.display_name.strip() or pet_id,
                "description": payload.description.strip()
                or "A custom ArbPet companion.",
                "spritesheetPath": "spritesheet.webp",
            }
            (tmp_dir / "pet.json").write_text(
                json.dumps(manifest, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )

            # Install (replace if exists)
            target = install_pet(tmp_dir, replace=True)
            return {
                "ok": True,
                "petId": pet_id,
                "path": str(target),
                "displayName": manifest["displayName"],
            }
        finally:
            shutil.rmtree(tmp_dir, ignore_errors=True)

    return router


router = build_router()
