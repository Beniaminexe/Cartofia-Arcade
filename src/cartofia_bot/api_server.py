"""Flask API server for Proxmox stats and protected Cartofia archive files."""

from __future__ import annotations

import os
import re
import sqlite3
import uuid
from datetime import datetime, timedelta, timezone
from functools import wraps
from pathlib import Path

from flask import Flask, g, jsonify, request, send_file, session
from flask_cors import CORS
from werkzeug.security import check_password_hash, generate_password_hash
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
USERNAME_RE = re.compile(r"^[a-zA-Z0-9_-]{3,32}$")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

app = Flask(__name__)
app.config["SECRET_KEY"] = os.getenv("API_SECRET_KEY", "change-me-in-production")
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
app.config["SESSION_COOKIE_SECURE"] = (
    os.getenv("SESSION_COOKIE_SECURE", "false").lower() == "true"
)
app.config["PERMANENT_SESSION_LIFETIME"] = timedelta(
    days=int(os.getenv("SESSION_LIFETIME_DAYS", "14"))
)
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
    """Create folders and database tables for account and archive data."""
    ARCHIVE_FILES_DIR.mkdir(parents=True, exist_ok=True)
    ARCHIVE_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(ARCHIVE_DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            email TEXT UNIQUE,
            password_hash TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS archive_files (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            original_name TEXT NOT NULL,
            stored_name TEXT NOT NULL UNIQUE,
            size_bytes INTEGER NOT NULL,
            uploaded_by INTEGER NOT NULL,
            uploaded_at TEXT NOT NULL,
            FOREIGN KEY(uploaded_by) REFERENCES users(id)
        )
        """
    )
    # Backfill email column/index for pre-existing databases.
    existing_columns = {row["name"] for row in conn.execute("PRAGMA table_info(users)")}
    if "email" not in existing_columns:
        conn.execute("ALTER TABLE users ADD COLUMN email TEXT")
    conn.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS users_email_idx
        ON users(email) WHERE email IS NOT NULL
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


def current_user() -> dict | None:
    """Resolve the authenticated user from session state."""
    user_id = session.get("user_id")
    if not user_id:
        return None

    row = get_db().execute(
        "SELECT id, username, email, created_at FROM users WHERE id = ?",
        (user_id,),
    ).fetchone()
    if row is None:
        session.clear()
        return None
    return dict(row)


def login_required(handler):
    """Require a logged-in user before serving protected endpoints."""

    @wraps(handler)
    def wrapped(*args, **kwargs):
        user = current_user()
        if user is None:
            return jsonify({"error": "Authentication required"}), 401
        return handler(*args, user=user, **kwargs)

    return wrapped


def validate_credentials(username: str, password: str) -> str | None:
    """Validate register/login payload inputs."""
    if not USERNAME_RE.fullmatch(username):
        return "Username must be 3-32 chars and use letters, numbers, _ or -."
    if len(password) < 8:
        return "Password must be at least 8 characters."
    return None


def validate_email(email: str) -> str | None:
    """Lightweight email validation."""
    if not email:
        return "Email is required."
    if not EMAIL_RE.fullmatch(email):
        return "Provide a valid email address."
    return None


def set_session(user_id: int, username: str, remember: bool) -> None:
    """Persist session keys and apply remember-me lifetime."""
    session["user_id"] = user_id
    session["username"] = username
    session.permanent = bool(remember)


@app.route("/api/auth/register", methods=["POST"])
def register():
    """Create a new account and start a session."""
    payload = request.get_json(silent=True) or {}
    username = str(payload.get("username", "")).strip()
    email = str(payload.get("email", "")).strip().lower()
    password = str(payload.get("password", ""))
    confirm_password = str(payload.get("confirm_password", ""))
    accept_terms = bool(payload.get("accept_terms"))
    remember = bool(payload.get("remember"))

    error = validate_credentials(username, password)
    if error:
        return jsonify({"error": error}), 400
    email_error = validate_email(email)
    if email_error:
        return jsonify({"error": email_error}), 400
    if password != confirm_password:
        return jsonify({"error": "Passwords do not match."}), 400
    if not accept_terms:
        return jsonify({"error": "You must accept the terms to register."}), 400

    db = get_db()
    now = datetime.now(timezone.utc).isoformat()
    try:
        cursor = db.execute(
            "INSERT INTO users (username, email, password_hash, created_at) VALUES (?, ?, ?, ?)",
            (username, email, generate_password_hash(password), now),
        )
        db.commit()
    except sqlite3.IntegrityError:
        return jsonify({"error": "Username or email is already taken."}), 409

    user_id = cursor.lastrowid
    set_session(user_id, username, remember)
    return jsonify({"id": user_id, "username": username, "email": email, "created_at": now}), 201


@app.route("/api/auth/login", methods=["POST"])
def login():
    """Authenticate user and start a session."""
    payload = request.get_json(silent=True) or {}
    username = str(payload.get("username", "")).strip()
    password = str(payload.get("password", ""))
    remember = bool(payload.get("remember"))

    if not username or not password:
        return jsonify({"error": "Username and password are required."}), 400

    row = get_db().execute(
        "SELECT id, username, email, password_hash, created_at FROM users WHERE username = ?",
        (username,),
    ).fetchone()
    if row is None or not check_password_hash(row["password_hash"], password):
        return jsonify({"error": "Invalid username or password."}), 401

    set_session(row["id"], row["username"], remember)
        return jsonify(
                {
                    "id": row["id"],
                    "username": row["username"],
                    "email": row["email"],
                    "created_at": row["created_at"],
                }
        ), 200


@app.route("/api/auth/logout", methods=["POST"])
def logout():
    """Clear active session."""
    session.clear()
    return jsonify({"ok": True}), 200


@app.route("/api/auth/me", methods=["GET"])
def me():
    """Get currently authenticated user."""
    user = current_user()
    if user is None:
        return jsonify({"authenticated": False}), 200
    return jsonify({"authenticated": True, "user": user}), 200


@app.route("/api/archive/files", methods=["GET"])
@login_required
def list_archive_files(user: dict):
    """Return list of files in the archive."""
    rows = get_db().execute(
        """
        SELECT
            f.id,
            f.original_name,
            f.size_bytes,
            f.uploaded_at,
            u.username AS uploaded_by_username
        FROM archive_files f
        JOIN users u ON u.id = f.uploaded_by
        ORDER BY f.id DESC
        """
    ).fetchall()
    files = [
        {
            "id": row["id"],
            "name": row["original_name"],
            "size_bytes": row["size_bytes"],
            "uploaded_at": row["uploaded_at"],
            "uploaded_by": row["uploaded_by_username"],
        }
        for row in rows
    ]
    return jsonify({"files": files, "count": len(files), "username": user["username"]}), 200


@app.route("/api/archive/upload", methods=["POST"])
@login_required
def upload_archive_file(user: dict):
    """Upload a file to the archive."""
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
        (original_name, stored_name, size_bytes, user["id"], now),
    )
    db.commit()
    return jsonify(
        {
            "id": cursor.lastrowid,
            "name": original_name,
            "size_bytes": size_bytes,
            "uploaded_at": now,
            "uploaded_by": user["username"],
        }
    ), 201


@app.route("/api/archive/download/<int:file_id>", methods=["GET"])
@login_required
def download_archive_file(file_id: int, user: dict):
    """Download a file from the archive."""
    del user  # user is validated by decorator
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
