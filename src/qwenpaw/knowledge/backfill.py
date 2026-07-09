# -*- coding: utf-8 -*-
from __future__ import annotations

import base64
import hashlib
import json
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

_ENCRYPTION_KEY_ENV = "AIARB_BACKFILL_KEY"
_SALT = b"aiarb_backfill_v1"


def save_backfill(
    backfill_dir: Path,
    doc_id: str,
    mapping: dict[str, str],
    encrypt: bool = True,
) -> Path:
    backfill_dir.mkdir(parents=True, exist_ok=True)
    data = json.dumps(mapping, ensure_ascii=False, indent=2)

    if encrypt:
        encrypted = _xor_encrypt(data)
        out_path = backfill_dir / f"{doc_id}.enc"
        out_path.write_text(encrypted, encoding="utf-8")
    else:
        out_path = backfill_dir / f"{doc_id}.json"
        out_path.write_text(data, encoding="utf-8")

    return out_path


def load_backfill(
    backfill_dir: Path,
    doc_id: str,
) -> dict[str, str] | None:
    enc_path = backfill_dir / f"{doc_id}.enc"
    json_path = backfill_dir / f"{doc_id}.json"

    if enc_path.is_file():
        try:
            encrypted = enc_path.read_text(encoding="utf-8")
            decrypted = _xor_decrypt(encrypted)
            return json.loads(decrypted)
        except Exception as exc:
            logger.error("Failed to decrypt backfill for %s: %s", doc_id, exc)
            return None

    if json_path.is_file():
        try:
            return json.loads(json_path.read_text(encoding="utf-8"))
        except Exception as exc:
            logger.error("Failed to read backfill for %s: %s", doc_id, exc)
            return None

    return None


def delete_backfill(backfill_dir: Path, doc_id: str) -> bool:
    deleted = False
    for suffix in (".enc", ".json"):
        path = backfill_dir / f"{doc_id}{suffix}"
        if path.is_file():
            path.unlink()
            deleted = True
    return deleted


def merge_mappings(
    existing: dict[str, str],
    new_mappings: dict[str, str],
) -> dict[str, str]:
    merged = dict(existing)
    for placeholder, original in new_mappings.items():
        if placeholder not in merged:
            merged[placeholder] = original
    return merged


def restore_text(
    desensitized_text: str,
    mapping: dict[str, str],
) -> str:
    result = desensitized_text
    for placeholder, original in sorted(
        mapping.items(), key=lambda x: len(x[0]), reverse=True
    ):
        result = result.replace(placeholder, original)
    return result


def _get_key() -> bytes:
    import os
    key_str = os.environ.get(_ENCRYPTION_KEY_ENV, "aiarb_default_backfill_key")
    return hashlib.pbkdf2_hmac("sha256", key_str.encode(), _SALT, 100000, dklen=32)


def _xor_encrypt(plaintext: str) -> str:
    key = _get_key()
    raw = plaintext.encode("utf-8")
    encrypted = bytearray(len(raw))
    for i, byte in enumerate(raw):
        encrypted[i] = byte ^ key[i % len(key)]
    return base64.b64encode(encrypted).decode("ascii")


def _xor_decrypt(ciphertext: str) -> str:
    key = _get_key()
    raw = base64.b64decode(ciphertext)
    decrypted = bytearray(len(raw))
    for i, byte in enumerate(raw):
        decrypted[i] = byte ^ key[i % len(key)]
    return decrypted.decode("utf-8")