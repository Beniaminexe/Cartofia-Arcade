"""Flask API server for Proxmox stats and protected Cartofia archive files."""

from __future__ import annotations

import os
import json
import sqlite3
import threading
import uuid
import time
import hashlib
import hmac
from datetime import datetime, timezone
from functools import wraps
from pathlib import Path

import requests
from flask import Flask, g, jsonify, request, send_file
from flask_cors import CORS
from flask_sock import Sock
from werkzeug.utils import secure_filename

from proxmox_stats import ProxmoxStats

ROOT_DIR = Path(__file__).resolve().parents[2]
ARCHIVE_DATA_DIR = Path(
    os.getenv("ARCHIVE_DATA_DIR", str(ROOT_DIR / "archive_data"))
).resolve()
ARCHIVE_DB_PATH = Path(
    os.getenv("ARCHIVE_DB_PATH", str(ARCHIVE_DATA_DIR / "archive.db"))
).resolve()
ARCHIVE_FILES_DIR = (ARCHIVE_DATA_DIR / "files").resolve()
MAX_UPLOAD_MB = int(os.getenv("ARCHIVE_MAX_UPLOAD_MB", "50"))

# OIDC / Authentik configuration
OIDC_USERINFO_URL = os.getenv("OIDC_USERINFO_URL")
OIDC_REQUIRED_GROUPS = [
    grp.strip()
    for grp in os.getenv(
        "OIDC_REQUIRED_GROUPS", "archive_view,archive_upload,archive_admin"
    ).split(",")
    if grp.strip()
]
OIDC_UPLOAD_GROUPS = [
    grp.strip()
    for grp in os.getenv(
        "OIDC_UPLOAD_GROUPS", "archive_upload,archive_admin"
    ).split(",")
    if grp.strip()
]

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD_MB * 1024 * 1024
sock = Sock(app)

allowed_origins = [
    origin.strip()
    for origin in os.getenv("API_ALLOWED_ORIGINS", "").split(",")
    if origin.strip()
]
if allowed_origins:
    CORS(app, resources={r"/api/*": {"origins": allowed_origins}}, supports_credentials=True)
else:
    CORS(app, resources={r"/api/*": {"origins": "*"}})

ROOM_CODE_LENGTH = 6
ROOM_CAPACITY = 2
ROOM_STALE_SECONDS = max(60, int(os.getenv("BOMBER_ROOM_STALE_SECONDS", "900")))
ROOM_PASSWORD_MAX_LENGTH = max(
    4, int(os.getenv("BOMBER_ROOM_PASSWORD_MAX_LENGTH", "32"))
)
PLAYER_NAME_MAX_LENGTH = 16
ws_rooms_lock = threading.Lock()
ws_rooms: dict[str, dict[str, object]] = {}

# Initialize Proxmox stats fetcher
proxmox = ProxmoxStats()


def init_storage() -> None:
    """Create folders and database tables for archive data."""
    ARCHIVE_FILES_DIR.mkdir(parents=True, exist_ok=True)
    ARCHIVE_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(ARCHIVE_DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS archive_files (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            original_name TEXT NOT NULL,
            stored_name TEXT NOT NULL UNIQUE,
            size_bytes INTEGER NOT NULL,
            uploaded_by TEXT NOT NULL,
            uploaded_at TEXT NOT NULL
        )
        """
    )
    conn.commit()
    conn.close()


def get_db() -> sqlite3.Connection:
    """Get a per-request SQLite connection."""
    if "db" not in g:
        g.db = sqlite3.connect(ARCHIVE_DB_PATH)
        g.db.row_factory = sqlite3.Row
    return g.db


@app.teardown_appcontext
def close_db(_error: Exception | None) -> None:
    db = g.pop("db", None)
    if db is not None:
        db.close()


def _resolve_oidc_user() -> dict | None:
    """Validate the OIDC token against Authentik and cache the result on g."""
    if hasattr(g, "user"):
        return g.user

    if not OIDC_USERINFO_URL:
        g.user = None
        return None

    token = None
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        token = auth_header[7:]
    if not token:
        token = request.cookies.get("access_token")
    if not token:
        g.user = None
        return None

    try:
        resp = requests.get(
            OIDC_USERINFO_URL,
            headers={"Authorization": f"Bearer {token}"},
            timeout=10,
        )
        if resp.status_code != 200:
            g.user = None
            return None
        claims = resp.json()
    except (requests.RequestException, ValueError):
        g.user = None
        return None

    g.user = {
        "username": claims.get("preferred_username", claims.get("sub", "")),
        "email": claims.get("email", ""),
        "groups": claims.get("groups", []),
    }
    return g.user


def login_required(handler):
    """Require a valid OIDC token with appropriate group membership."""

    @wraps(handler)
    def wrapped(*args, **kwargs):
        user = _resolve_oidc_user()
        if user is None:
            return jsonify({"error": "Authentication required"}), 401
        if not any(grp in OIDC_REQUIRED_GROUPS for grp in user["groups"]):
            return jsonify({"error": "Insufficient group membership"}), 403
        return handler(*args, **kwargs)

    return wrapped


@app.route("/api/archive/files", methods=["GET"])
@login_required
def list_archive_files():
    """Return list of files in the archive."""
    rows = get_db().execute(
        """
        SELECT id, original_name, size_bytes, uploaded_at, uploaded_by
        FROM archive_files
        ORDER BY id DESC
        """
    ).fetchall()
    files = [
        {
            "id": row["id"],
            "name": row["original_name"],
            "size_bytes": row["size_bytes"],
            "uploaded_at": row["uploaded_at"],
            "uploaded_by": row["uploaded_by"],
        }
        for row in rows
    ]
    return jsonify({"files": files, "count": len(files), "username": g.user["username"]}), 200


@app.route("/api/archive/upload", methods=["POST"])
@login_required
def upload_archive_file():
    """Upload a file to the archive."""
    if not any(grp in OIDC_UPLOAD_GROUPS for grp in g.user["groups"]):
        return jsonify({"error": "Upload permission required"}), 403

    incoming_file = request.files.get("file")
    if incoming_file is None:
        return jsonify({"error": "Missing file field 'file'."}), 400
    if incoming_file.filename is None or not incoming_file.filename.strip():
        return jsonify({"error": "No file selected."}), 400

    original_name = secure_filename(incoming_file.filename.strip())
    if not original_name:
        return jsonify({"error": "Invalid filename."}), 400

    stored_name = f"{uuid.uuid4().hex}_{original_name}"
    output_path = (ARCHIVE_FILES_DIR / stored_name).resolve()
    if output_path.parent != ARCHIVE_FILES_DIR:
        return jsonify({"error": "Invalid destination path."}), 400

    incoming_file.save(output_path)
    size_bytes = output_path.stat().st_size

    now = datetime.now(timezone.utc).isoformat()
    db = get_db()
    cursor = db.execute(
        """
        INSERT INTO archive_files (original_name, stored_name, size_bytes, uploaded_by, uploaded_at)
        VALUES (?, ?, ?, ?, ?)
        """,
        (original_name, stored_name, size_bytes, g.user["username"], now),
    )
    db.commit()
    return jsonify(
        {
            "id": cursor.lastrowid,
            "name": original_name,
            "size_bytes": size_bytes,
            "uploaded_at": now,
            "uploaded_by": g.user["username"],
        }
    ), 201


@app.route("/api/archive/download/<int:file_id>", methods=["GET"])
@login_required
def download_archive_file(file_id: int):
    """Download a file from the archive."""
    row = get_db().execute(
        """
        SELECT id, original_name, stored_name
        FROM archive_files
        WHERE id = ?
        """,
        (file_id,),
    ).fetchone()
    if row is None:
        return jsonify({"error": "File not found."}), 404

    file_path = (ARCHIVE_FILES_DIR / row["stored_name"]).resolve()
    if file_path.parent != ARCHIVE_FILES_DIR:
        return jsonify({"error": "Invalid stored file path."}), 500
    if not file_path.exists():
        return jsonify({"error": "Stored file is missing."}), 404

    return send_file(
        file_path,
        as_attachment=True,
        download_name=row["original_name"],
        max_age=0,
    )


@app.errorhandler(413)
def file_too_large(_error):
    return jsonify({"error": f"File is too large. Max size is {MAX_UPLOAD_MB}MB."}), 413


@app.route("/api/stats", methods=["GET"])
def get_stats():
    """Endpoint to get all infrastructure statistics."""
    try:
        stats = proxmox.get_all_stats()
        return jsonify(stats), 200
    except Exception as exc:
        print(f"Error in /api/stats: {exc}")
        return jsonify({"error": str(exc)}), 500


@app.route("/api/stats/containers", methods=["GET"])
def get_container_stats():
    """Endpoint to get container statistics only."""
    try:
        stats = proxmox.get_container_stats()
        return jsonify(stats), 200
    except Exception as exc:
        print(f"Error in /api/stats/containers: {exc}")
        return jsonify({"error": str(exc)}), 500


@app.route("/api/stats/vms", methods=["GET"])
def get_vm_stats():
    """Endpoint to get VM statistics only."""
    try:
        stats = proxmox.get_qemu_stats()
        return jsonify(stats), 200
    except Exception as exc:
        print(f"Error in /api/stats/vms: {exc}")
        return jsonify({"error": str(exc)}), 500


@app.route("/api/stats/node", methods=["GET"])
def get_node_stats():
    """Endpoint to get node statistics only."""
    try:
        stats = proxmox.get_node_stats()
        return jsonify(stats), 200
    except Exception as exc:
        print(f"Error in /api/stats/node: {exc}")
        return jsonify({"error": str(exc)}), 500


@app.route("/health", methods=["GET"])
def health():
    """Health check endpoint."""
    return jsonify({"status": "ok"}), 200


def _normalize_room_code(raw: str) -> str:
    code = "".join(ch for ch in str(raw).upper() if ch.isalnum())
    return code[:ROOM_CODE_LENGTH]


def _normalize_room_password(raw: object) -> str:
    password = str(raw or "").strip()
    return password[:ROOM_PASSWORD_MAX_LENGTH]


def _password_hash(password: str) -> str:
    return hashlib.sha256(password.encode("utf-8")).hexdigest()


def _normalize_player_name(raw: object, fallback: str = "Player") -> str:
    allowed = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 _-")
    cleaned = "".join(ch for ch in str(raw or "") if ch in allowed).strip()
    if not cleaned:
        cleaned = fallback
    return cleaned[:PLAYER_NAME_MAX_LENGTH]


def _now_seconds() -> float:
    return time.time()


def _touch_room(room: dict[str, object]) -> None:
    room["updated_at"] = _now_seconds()


def _cleanup_stale_rooms() -> None:
    now = _now_seconds()
    stale_codes: list[str] = []
    with ws_rooms_lock:
        for code, room in list(ws_rooms.items()):
            order = room.get("order", [])
            clients = room.get("clients", {})
            updated_at = room.get("updated_at", now)
            has_clients = (
                isinstance(order, list)
                and isinstance(clients, dict)
                and len(order) > 0
                and len(clients) > 0
            )
            try:
                age = now - float(updated_at)
            except (TypeError, ValueError):
                age = ROOM_STALE_SECONDS + 1
            if (not has_clients) or age > ROOM_STALE_SECONDS:
                stale_codes.append(code)
                ws_rooms.pop(code, None)
    if stale_codes:
        print(
            "Bomber Raid: cleaned stale rooms:",
            ", ".join(sorted(stale_codes)),
        )


def _room_can_start(participants: list[dict[str, object]]) -> bool:
    if len(participants) != ROOM_CAPACITY:
        return False
    return all(bool(p.get("ready")) for p in participants)


def _ws_send_json(ws, payload: dict) -> bool:
    try:
        ws.send(json.dumps(payload))
        return True
    except Exception:
        return False


def _room_participants(room: dict[str, object]) -> list[dict[str, object]]:
    participants: list[dict[str, object]] = []
    order = room.get("order", [])
    meta = room.get("meta", {})
    if not isinstance(order, list):
        return participants
    for idx, client_id in enumerate(order):
        member_meta: dict[str, object] = {}
        if isinstance(meta, dict):
            raw_meta = meta.get(client_id, {})
            if isinstance(raw_meta, dict):
                member_meta = raw_meta
        default_name = f"P{idx + 1}"
        name = _normalize_player_name(member_meta.get("name", default_name), default_name)
        participants.append(
            {
                "id": str(client_id),
                "role": "host" if idx == 0 else "guest",
                "name": name,
                "ready": bool(member_meta.get("ready", False)),
            }
        )
    return participants


def _broadcast_room_state(room_code: str) -> None:
    with ws_rooms_lock:
        room = ws_rooms.get(room_code)
        if room is None:
            return
        sockets = list(room.get("clients", {}).values())
        participants = _room_participants(room)
        has_password = bool(room.get("password_hash"))
        can_start = _room_can_start(participants)

    message = {
        "type": "room_state",
        "room": room_code,
        "participants": participants,
        "can_start": can_start,
        "has_password": has_password,
    }
    for ws in sockets:
        _ws_send_json(ws, message)


def _relay_room_payload(room_code: str, sender_id: str, payload: dict) -> None:
    with ws_rooms_lock:
        room = ws_rooms.get(room_code)
        if room is None:
            return
        _touch_room(room)
        clients = room.get("clients", {})
        if not isinstance(clients, dict):
            return
        targets = [
            socket
            for client_id, socket in clients.items()
            if str(client_id) != sender_id
        ]

    relay_message = {
        "type": "relay",
        "room": room_code,
        "from": sender_id,
        "payload": payload,
    }
    for ws in targets:
        _ws_send_json(ws, relay_message)


def _remove_ws_client(room_code: str, client_id: str) -> None:
    with ws_rooms_lock:
        room = ws_rooms.get(room_code)
        if room is None:
            return

        clients = room.get("clients", {})
        order = room.get("order", [])
        meta = room.get("meta", {})

        if isinstance(clients, dict):
            clients.pop(client_id, None)
        if isinstance(order, list) and client_id in order:
            order.remove(client_id)
        if isinstance(meta, dict):
            meta.pop(client_id, None)

        has_clients = isinstance(order, list) and len(order) > 0
        if not has_clients:
            ws_rooms.pop(room_code, None)
            return
        _touch_room(room)

    _broadcast_room_state(room_code)


def _update_lobby_client(room_code: str, client_id: str, payload: dict) -> None:
    changed = False
    with ws_rooms_lock:
        room = ws_rooms.get(room_code)
        if room is None:
            return
        meta = room.get("meta", {})
        if not isinstance(meta, dict):
            meta = {}
            room["meta"] = meta
        member = meta.get(client_id, {})
        if not isinstance(member, dict):
            member = {}
            meta[client_id] = member

        if "name" in payload:
            new_name = _normalize_player_name(payload.get("name"), "Player")
            if member.get("name") != new_name:
                member["name"] = new_name
                changed = True
        if "ready" in payload:
            ready_value = payload.get("ready")
            if isinstance(ready_value, bool):
                new_ready = ready_value
            elif isinstance(ready_value, (int, float)):
                new_ready = bool(ready_value)
            else:
                new_ready = False
            if member.get("ready") != new_ready:
                member["ready"] = new_ready
                changed = True

        if changed:
            _touch_room(room)

    if changed:
        _broadcast_room_state(room_code)


@sock.route("/ws/bomber-raid")
def bomber_raid_socket(ws):
    """WebSocket room relay for Bomber Raid online multiplayer."""
    client_id = uuid.uuid4().hex
    room_code: str | None = None

    try:
        _cleanup_stale_rooms()
        join_raw = ws.receive()
        if join_raw is None:
            return

        try:
            join_data = json.loads(join_raw)
        except json.JSONDecodeError:
            _ws_send_json(ws, {"type": "error", "message": "Invalid JSON payload."})
            return

        if not isinstance(join_data, dict) or join_data.get("type") != "join":
            _ws_send_json(
                ws,
                {"type": "error", "message": "First message must be a join payload."},
            )
            return

        room_code = _normalize_room_code(str(join_data.get("room", "")))
        if len(room_code) < 4:
            _ws_send_json(
                ws,
                {
                    "type": "error",
                    "message": "Room code must be at least 4 alphanumeric characters.",
                },
            )
            return

        join_password = _normalize_room_password(join_data.get("password", ""))
        join_name = _normalize_player_name(join_data.get("name", ""), "Player")

        room_full = False
        password_invalid = False
        participants: list[dict[str, object]] = []
        role = "guest"
        has_password = False
        can_start = False
        with ws_rooms_lock:
            now = _now_seconds()
            room = ws_rooms.get(room_code)
            if room is not None:
                try:
                    age = now - float(room.get("updated_at", now))
                except (TypeError, ValueError):
                    age = ROOM_STALE_SECONDS + 1
                if age > ROOM_STALE_SECONDS:
                    ws_rooms.pop(room_code, None)
                    room = None
            if room is None:
                room = {
                    "clients": {},
                    "order": [],
                    "meta": {},
                    "password_hash": _password_hash(join_password) if join_password else "",
                    "created_at": now,
                    "updated_at": now,
                }
                ws_rooms[room_code] = room

            clients = room.get("clients", {})
            order = room.get("order", [])
            meta = room.get("meta", {})
            password_hash = room.get("password_hash", "")
            if (
                not isinstance(clients, dict)
                or not isinstance(order, list)
                or not isinstance(meta, dict)
                or not isinstance(password_hash, str)
            ):
                ws_rooms[room_code] = {
                    "clients": {},
                    "order": [],
                    "meta": {},
                    "password_hash": password_hash if isinstance(password_hash, str) else "",
                    "created_at": room.get("created_at", now),
                    "updated_at": now,
                }
                room = ws_rooms[room_code]
                clients = room["clients"]
                order = room["order"]
                meta = room["meta"]
                password_hash = room["password_hash"]

            has_password = bool(password_hash)
            if has_password:
                candidate_hash = _password_hash(join_password) if join_password else ""
                if not candidate_hash or not hmac.compare_digest(password_hash, candidate_hash):
                    password_invalid = True
            if password_invalid:
                pass
            elif len(order) >= ROOM_CAPACITY:
                room_full = True
            else:
                clients[client_id] = ws
                order.append(client_id)
                default_name = f"P{len(order)}"
                meta[client_id] = {
                    "name": _normalize_player_name(join_name, default_name),
                    "ready": False,
                }
                _touch_room(room)
                participants = _room_participants(room)
                role = "host" if participants and participants[0]["id"] == client_id else "guest"
                can_start = _room_can_start(participants)
                has_password = bool(room.get("password_hash"))

        if password_invalid:
            _ws_send_json(ws, {"type": "error", "message": "Room password is incorrect."})
            return
        if room_full:
            _ws_send_json(ws, {"type": "error", "message": "Room is full."})
            return

        _ws_send_json(
            ws,
            {
                "type": "joined",
                "room": room_code,
                "client_id": client_id,
                "role": role,
                "participants": participants,
                "can_start": can_start,
                "has_password": has_password,
                "stale_seconds": ROOM_STALE_SECONDS,
            },
        )
        _broadcast_room_state(room_code)

        while True:
            incoming_raw = ws.receive()
            if incoming_raw is None:
                break
            try:
                incoming = json.loads(incoming_raw)
            except json.JSONDecodeError:
                continue
            if not isinstance(incoming, dict):
                continue
            if incoming.get("type") == "leave":
                break
            if incoming.get("type") == "heartbeat":
                with ws_rooms_lock:
                    room = ws_rooms.get(room_code)
                    if room is not None:
                        _touch_room(room)
                _ws_send_json(ws, {"type": "heartbeat_ack", "room": room_code})
                continue
            if incoming.get("type") == "lobby":
                _update_lobby_client(room_code, client_id, incoming)
                continue
            _relay_room_payload(room_code, client_id, incoming)
            _cleanup_stale_rooms()

    except Exception as exc:
        print(f"Error in /ws/bomber-raid for client {client_id}: {exc}")
    finally:
        if room_code is not None:
            _remove_ws_client(room_code, client_id)


init_storage()


if __name__ == "__main__":
    port = int(os.getenv("API_PORT", "5000"))
    debug = os.getenv("FLASK_ENV", "production") == "development"
    app.run(host="0.0.0.0", port=port, debug=debug)
