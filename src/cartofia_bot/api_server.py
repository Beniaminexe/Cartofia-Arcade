"""Simple Flask API server for exposing Proxmox stats to the website."""

from flask import Flask, jsonify
from flask_cors import CORS
from proxmox_stats import ProxmoxStats
import os

app = Flask(__name__)
CORS(app)  # Enable CORS for frontend requests

# Initialize Proxmox stats fetcher
proxmox = ProxmoxStats()

@app.route('/api/stats', methods=['GET'])
def get_stats():
    """Endpoint to get all infrastructure statistics."""
    try:
        stats = proxmox.get_all_stats()
        return jsonify(stats), 200
    except Exception as e:
        print(f"Error in /api/stats: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/stats/containers', methods=['GET'])
def get_container_stats():
    """Endpoint to get container statistics only."""
    try:
        stats = proxmox.get_container_stats()
        return jsonify(stats), 200
    except Exception as e:
        print(f"Error in /api/stats/containers: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/stats/vms', methods=['GET'])
def get_vm_stats():
    """Endpoint to get VM statistics only."""
    try:
        stats = proxmox.get_qemu_stats()
        return jsonify(stats), 200
    except Exception as e:
        print(f"Error in /api/stats/vms: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/stats/node', methods=['GET'])
def get_node_stats():
    """Endpoint to get node statistics only."""
    try:
        stats = proxmox.get_node_stats()
        return jsonify(stats), 200
    except Exception as e:
        print(f"Error in /api/stats/node: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint."""
    return jsonify({'status': 'ok'}), 200

if __name__ == '__main__':
    port = int(os.getenv('API_PORT', 5000))
    debug = os.getenv('FLASK_ENV', 'production') == 'development'
    app.run(host='0.0.0.0', port=port, debug=debug)
