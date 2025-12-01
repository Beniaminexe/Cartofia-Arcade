# src/cartofia_bot/proxmox_client.py
from __future__ import annotations

from dataclasses import dataclass
import logging
from typing import Any

import requests

log = logging.getLogger(__name__)


@dataclass
class ProxmoxConfig:
    host: str
    port: int
    token_id: str
    token_secret: str# src/cartofia_bot/proxmox_client.py
from __future__ import annotations

from dataclasses import dataclass
import logging
from typing import Any

import requests

log = logging.getLogger(__name__)


@dataclass
class ProxmoxConfig:
    host: str
    port: int
    token_id: str
    token_secret: str
    node: str
    ct_cartofia_id: int
    verify_ssl: bool = False

    @property
    def base_url(self) -> str:
        return f"https://{self.host}:{self.port}/api2/json"


class ProxmoxClient:
    def __init__(self, config: ProxmoxConfig) -> None:
        self.config = config
        self.session = requests.Session()
        self.session.headers.update(
            {
                "Authorization": f"PVEAPIToken={config.token_id}={config.token_secret}",
            }
        )
        self.session.verify = config.verify_ssl

    def _get(self, path: str) -> dict[str, Any]:
        url = f"{self.config.base_url}/{path.lstrip('/')}"
        log.debug("GET %s", url)
        resp = self.session.get(url, timeout=5)
        resp.raise_for_status()
        data = resp.json()
        return data["data"]

    def _post(self, path: str, data: dict[str, Any] | None = None) -> dict[str, Any]:
        url = f"{self.config.base_url}/{path.lstrip('/')}"
        log.debug("POST %s data=%s", url, data)
        resp = self.session.post(url, data=data or {}, timeout=5)
        resp.raise_for_status()
        # most Proxmox POSTs return {"data": <UPID or None>}
        if resp.content:
            body = resp.json()
            return body.get("data", {})
        return {}

    # ----- LXC helpers -----

    def get_ct_status(self, vmid: int) -> dict[str, Any]:
        path = f"nodes/{self.config.node}/lxc/{vmid}/status/current"
        return self._get(path)

    def get_cartofia_status(self) -> dict[str, Any]:
        return self.get_ct_status(self.config.ct_cartofia_id)

    def start_ct(self, vmid: int) -> dict[str, Any]:
        path = f"nodes/{self.config.node}/lxc/{vmid}/status/start"
        return self._post(path)

    def stop_ct(self, vmid: int) -> dict[str, Any]:
        # hard stop; for a clean shutdown you could use "shutdown"
        path = f"nodes/{self.config.node}/lxc/{vmid}/status/stop"
        return self._post(path)

    def start_cartofia(self) -> dict[str, Any]:
        return self.start_ct(self.config.ct_cartofia_id)

    def stop_cartofia(self) -> dict[str, Any]:
        return self.stop_ct(self.config.ct_cartofia_id)

    node: str
    ct_cartofia_id: int
    verify_ssl: bool = False

    @property
    def base_url(self) -> str:
        return f"https://{self.host}:{self.port}/api2/json"


class ProxmoxClient:
    def __init__(self, config: ProxmoxConfig) -> None:
        self.config = config
        self.session = requests.Session()
        self.session.headers.update(
            {
                "Authorization": f"PVEAPIToken={config.token_id}={config.token_secret}",
            }
        )
        self.session.verify = config.verify_ssl

    def _get(self, path: str) -> dict[str, Any]:
        url = f"{self.config.base_url}/{path.lstrip('/')}"
        log.debug("GET %s", url)
        resp = self.session.get(url, timeout=5)
        resp.raise_for_status()
        data = resp.json()
        return data["data"]

    def get_ct_status(self, vmid: int) -> dict[str, Any]:
        path = f"nodes/{self.config.node}/lxc/{vmid}/status/current"
        return self._get(path)

    def get_cartofia_status(self) -> dict[str, Any]:
        return self.get_ct_status(self.config.ct_cartofia_id)
