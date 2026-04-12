"""Proxmox statistics module for fetching live infrastructure metrics."""

from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from typing import Any

import requests

log = logging.getLogger(__name__)


def _env_bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


class ProxmoxStats:
    """Fetch and summarize Proxmox infrastructure statistics."""

    def __init__(self) -> None:
        proxmox_host = os.getenv("PROXMOX_HOST", "").strip()
        proxmox_port = int(os.getenv("PROXMOX_PORT", "8006"))
        default_url = (
            f"https://{proxmox_host}:{proxmox_port}" if proxmox_host else "https://192.168.7.100:8006"
        )

        self.proxmox_url = os.getenv("PROXMOX_URL", default_url).rstrip("/")
        self.proxmox_user = os.getenv("PROXMOX_USER", "root@pam")
        self.proxmox_node = os.getenv("PROXMOX_NODE", "proxmox")
        self.verify_ssl = _env_bool("PROXMOX_VERIFY_SSL", default=False)

        token_id = os.getenv("PROXMOX_TOKEN_ID", "").strip()
        token_secret = os.getenv("PROXMOX_TOKEN_SECRET", "").strip()
        legacy_token = os.getenv("PROXMOX_TOKEN", "").strip()

        if token_id and token_secret:
            self._auth_header = f"PVEAPIToken={token_id}={token_secret}"
        elif legacy_token:
            self._auth_header = f"PVEAPIToken={self.proxmox_user}!default={legacy_token}"
        else:
            self._auth_header = ""

        self.session: requests.Session | None = None

    def _authenticate(self) -> bool:
        """Authenticate once and initialize session headers."""
        if not self._auth_header:
            log.warning("Proxmox token config missing; returning fallback stats.")
            return False

        try:
            headers = {"Authorization": self._auth_header}
            response = requests.get(
                f"{self.proxmox_url}/api2/json/version",
                headers=headers,
                verify=self.verify_ssl,
                timeout=5,
            )
            if response.status_code != 200:
                log.warning("Proxmox auth check failed with HTTP %s.", response.status_code)
                return False

            self.session = requests.Session()
            self.session.headers.update(headers)
            self.session.verify = self.verify_ssl
            return True
        except requests.RequestException as exc:
            log.warning("Proxmox authentication failed: %s", exc)
            return False

    def _fetch_data(self, path: str) -> Any:
        if self.session is None and not self._authenticate():
            raise RuntimeError("Proxmox session unavailable.")

        assert self.session is not None
        response = self.session.get(f"{self.proxmox_url}/api2/json/{path.lstrip('/')}", timeout=5)
        response.raise_for_status()
        body = response.json()
        return body.get("data")

    def get_container_stats(self) -> dict[str, Any]:
        """Fetch LXC container statistics from Proxmox."""
        try:
            containers = self._fetch_data(f"nodes/{self.proxmox_node}/lxc")
            if not isinstance(containers, list):
                return self._fallback_container_stats()
            online_count = sum(1 for c in containers if c.get("status") == "running")
            return {
                "online_containers": online_count,
                "total_containers": len(containers),
                "containers": containers,
            }
        except Exception as exc:
            log.warning("Error fetching container stats: %s", exc)
            return self._fallback_container_stats()

    def get_qemu_stats(self) -> dict[str, Any]:
        """Fetch VM statistics from Proxmox."""
        try:
            vms = self._fetch_data(f"nodes/{self.proxmox_node}/qemu")
            if not isinstance(vms, list):
                return self._fallback_vm_stats()
            online_count = sum(1 for vm in vms if vm.get("status") == "running")
            return {
                "online_vms": online_count,
                "total_vms": len(vms),
                "vms": vms,
            }
        except Exception as exc:
            log.warning("Error fetching VM stats: %s", exc)
            return self._fallback_vm_stats()

    def get_node_stats(self) -> dict[str, Any]:
        """Fetch node-level memory, disk, and uptime information."""
        try:
            data = self._fetch_data(f"nodes/{self.proxmox_node}/status")
            if not isinstance(data, dict):
                return self._fallback_node_stats()
            return {
                "uptime": int(data.get("uptime", 0) or 0),
                "memory_used": int((data.get("memory") or {}).get("used", 0) or 0),
                "memory_total": int((data.get("memory") or {}).get("total", 0) or 0),
                "disk_used": int((data.get("disk") or {}).get("used", 0) or 0),
                "disk_total": int((data.get("disk") or {}).get("total", 0) or 0),
            }
        except Exception as exc:
            log.warning("Error fetching node stats: %s", exc)
            return self._fallback_node_stats()

    def get_all_stats(self) -> dict[str, Any]:
        """Fetch and aggregate all infrastructure statistics."""
        containers = self.get_container_stats()
        vms = self.get_qemu_stats()
        node = self.get_node_stats()

        container_list = containers.get("containers", [])
        active_bots = self._count_active_bots(container_list)
        games_online = self._count_game_containers(container_list)

        uptime_seconds = int(node.get("uptime", 0) or 0)
        memory_used = int(node.get("memory_used", 0) or 0)
        memory_total = int(node.get("memory_total", 0) or 0)
        disk_used = int(node.get("disk_used", 0) or 0)
        disk_total = int(node.get("disk_total", 0) or 0)

        return {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "games_online": games_online,
            "active_bots": active_bots,
            "online_containers": int(containers.get("online_containers", 0) or 0),
            "total_containers": int(containers.get("total_containers", 0) or 0),
            "online_vms": int(vms.get("online_vms", 0) or 0),
            "total_vms": int(vms.get("total_vms", 0) or 0),
            "uptime_seconds": uptime_seconds,
            "uptime_display": self._format_uptime(uptime_seconds),
            "memory_used_gb": round(memory_used / (1024**3), 2),
            "memory_total_gb": round(memory_total / (1024**3), 2),
            "disk_used_gb": round(disk_used / (1024**3), 2),
            "disk_total_gb": round(disk_total / (1024**3), 2),
        }

    def _count_active_bots(self, containers: list[dict[str, Any]]) -> int:
        bot_keywords = {"bot", "cartofia-bot", "discord"}
        count = 0
        for container in containers:
            name = str(container.get("hostname", "")).lower()
            if container.get("status") == "running" and any(keyword in name for keyword in bot_keywords):
                count += 1
        return count

    def _count_game_containers(self, containers: list[dict[str, Any]]) -> int:
        game_keywords = {"cartofia", "arcade", "game"}
        count = 0
        for container in containers:
            name = str(container.get("hostname", "")).lower()
            if container.get("status") == "running" and any(keyword in name for keyword in game_keywords):
                count += 1
        return count

    def _format_uptime(self, seconds: int) -> str:
        if seconds < 60:
            return f"{seconds}s"
        if seconds < 3600:
            return f"{seconds // 60}m"
        if seconds < 86400:
            hours = seconds // 3600
            minutes = (seconds % 3600) // 60
            return f"{hours}h {minutes}m"
        days = seconds // 86400
        hours = (seconds % 86400) // 3600
        return f"{days}d {hours}h"

    def _fallback_container_stats(self) -> dict[str, Any]:
        return {"online_containers": 0, "total_containers": 0, "containers": []}

    def _fallback_vm_stats(self) -> dict[str, Any]:
        return {"online_vms": 0, "total_vms": 0, "vms": []}

    def _fallback_node_stats(self) -> dict[str, Any]:
        return {"uptime": 0, "memory_used": 0, "memory_total": 0, "disk_used": 0, "disk_total": 0}
