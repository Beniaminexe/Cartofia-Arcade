"""Proxmox statistics module for fetching live infrastructure metrics."""

import os
import requests
from typing import Dict, Any
from datetime import datetime

class ProxmoxStats:
    """Fetch and cache Proxmox infrastructure statistics."""
    
    def __init__(self):
        """Initialize Proxmox connection parameters."""
        self.proxmox_url = os.getenv('PROXMOX_URL', 'https://192.168.7.100:8006')
        self.proxmox_user = os.getenv('PROXMOX_USER', 'root@pam')
        self.proxmox_token = os.getenv('PROXMOX_TOKEN')
        self.proxmox_node = os.getenv('PROXMOX_NODE', 'pve')
        self.session = None
        self._auth_token = None
        
    def _authenticate(self) -> bool:
        """Authenticate with Proxmox API using token."""
        if not self.proxmox_token:
            print("Warning: PROXMOX_TOKEN not set. Returning mock data.")
            return False
            
        try:
            headers = {
                'Authorization': f'PVEAPIToken={self.proxmox_user}!default={self.proxmox_token}'
            }
            response = requests.get(
                f"{self.proxmox_url}/api2/json/version",
                headers=headers,
                verify=False,
                timeout=5
            )
            if response.status_code == 200:
                self.session = requests.Session()
                self.session.headers.update(headers)
                self.session.verify = False
                return True
        except Exception as e:
            print(f"Proxmox authentication failed: {e}")
        
        return False
    
    def get_container_stats(self) -> Dict[str, Any]:
        """Fetch container statistics from Proxmox."""
        if not self.session and not self._authenticate():
            return self._get_mock_stats()
        
        try:
            # Get all LXC containers on the node
            response = self.session.get(
                f"{self.proxmox_url}/api2/json/nodes/{self.proxmox_node}/lxc",
                timeout=5
            )
            
            if response.status_code != 200:
                return self._get_mock_stats()
            
            containers = response.json().get('data', [])
            online_count = sum(1 for c in containers if c.get('status') == 'running')
            total_count = len(containers)
            
            return {
                'online_containers': online_count,
                'total_containers': total_count,
                'containers': containers
            }
        except Exception as e:
            print(f"Error fetching container stats: {e}")
            return self._get_mock_stats()
    
    def get_qemu_stats(self) -> Dict[str, Any]:
        """Fetch QEMU (VM) statistics from Proxmox."""
        if not self.session and not self._authenticate():
            return {'online_vms': 0, 'total_vms': 0, 'vms': []}
        
        try:
            response = self.session.get(
                f"{self.proxmox_url}/api2/json/nodes/{self.proxmox_node}/qemu",
                timeout=5
            )
            
            if response.status_code != 200:
                return {'online_vms': 0, 'total_vms': 0, 'vms': []}
            
            vms = response.json().get('data', [])
            online_count = sum(1 for v in vms if v.get('status') == 'running')
            total_count = len(vms)
            
            return {
                'online_vms': online_count,
                'total_vms': total_count,
                'vms': vms
            }
        except Exception as e:
            print(f"Error fetching VM stats: {e}")
            return {'online_vms': 0, 'total_vms': 0, 'vms': []}
    
    def get_node_stats(self) -> Dict[str, Any]:
        """Fetch node-level statistics."""
        if not self.session and not self._authenticate():
            return self._get_mock_node_stats()
        
        try:
            response = self.session.get(
                f"{self.proxmox_url}/api2/json/nodes/{self.proxmox_node}/status",
                timeout=5
            )
            
            if response.status_code != 200:
                return self._get_mock_node_stats()
            
            data = response.json().get('data', {})
            return {
                'uptime': data.get('uptime', 0),
                'memory_used': data.get('memory', {}).get('used', 0),
                'memory_total': data.get('memory', {}).get('total', 0),
                'disk_used': data.get('disk', {}).get('used', 0),
                'disk_total': data.get('disk', {}).get('total', 0),
            }
        except Exception as e:
            print(f"Error fetching node stats: {e}")
            return self._get_mock_node_stats()
    
    def get_all_stats(self) -> Dict[str, Any]:
        """Fetch all infrastructure statistics."""
        containers = self.get_container_stats()
        vms = self.get_qemu_stats()
        node = self.get_node_stats()
        
        # Count active bots (you can customize this logic)
        active_bots = self._count_active_bots(containers.get('containers', []))
        
        return {
            'timestamp': datetime.now().isoformat(),
            'games_online': 1,  # Cartofia is always shown as online if accessible
            'active_bots': active_bots,
            'online_containers': containers.get('online_containers', 0),
            'total_containers': containers.get('total_containers', 0),
            'online_vms': vms.get('online_vms', 0),
            'total_vms': vms.get('total_vms', 0),
            'uptime_seconds': node.get('uptime', 0),
            'uptime_display': self._format_uptime(node.get('uptime', 0)),
            'memory_used_gb': round(node.get('memory_used', 0) / (1024**3), 2),
            'memory_total_gb': round(node.get('memory_total', 0) / (1024**3), 2),
            'disk_used_gb': round(node.get('disk_used', 0) / (1024**3), 2),
            'disk_total_gb': round(node.get('disk_total', 0) / (1024**3), 2),
        }
    
    def _count_active_bots(self, containers: list) -> int:
        """Count containers that appear to be bots based on name or tags."""
        bot_keywords = ['bot', 'cartofia-bot', 'discord']
        count = 0
        for container in containers:
            name = container.get('hostname', '').lower()
            if any(keyword in name for keyword in bot_keywords) and container.get('status') == 'running':
                count += 1
        return count
    
    def _format_uptime(self, seconds: int) -> str:
        """Format uptime in seconds to human-readable format."""
        if seconds < 60:
            return f"{seconds}s"
        elif seconds < 3600:
            return f"{seconds // 60}m"
        elif seconds < 86400:
            hours = seconds // 3600
            minutes = (seconds % 3600) // 60
            return f"{hours}h {minutes}m"
        else:
            days = seconds // 86400
            hours = (seconds % 86400) // 3600
            return f"{days}d {hours}h"
    
    def _get_mock_stats(self) -> Dict[str, Any]:
        """Return mock stats for development/testing."""
        return {
            'online_containers': 3,
            'total_containers': 5,
            'containers': []
        }
    
    def _get_mock_node_stats(self) -> Dict[str, Any]:
        """Return mock node stats for development/testing."""
        return {
            'uptime': 864000,  # 10 days
            'memory_used': 4 * (1024**3),
            'memory_total': 16 * (1024**3),
            'disk_used': 100 * (1024**3),
            'disk_total': 500 * (1024**3),
        }
