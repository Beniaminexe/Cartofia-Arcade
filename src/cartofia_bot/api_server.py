"""Flask API server for Proxmox stats and protected Cartofia archive files."""

from __future__ import annotations

import os
import sqlite3
import uuid
from datetime import datetime, timezone
from functools import wraps
from pathlib import Path

import requests
from flask import Flask, g, jsonify, request, send_file
from flask_cors import CORS
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

allowed_origins = [
    origin.strip()
    for origin in os.getenv("API_ALLOWED_ORIGINS", "").split(",")
    if origin.strip()
]
if allowed_origins:
    CORS(app, resources={r"/api/*": {"origins": allowed_origins}}, supports_credentials=True)
else:
    CORS(app, resources={r"/api/*": {"origins": "*"}})

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


init_storage()


if __name__ == "__main__":
    port = int(os.getenv("API_PORT", "5000"))
    debug = os.getenv("FLASK_ENV", "production") == "development"
    app.run(host="0.0.0.0", port=port, debug=debug)
