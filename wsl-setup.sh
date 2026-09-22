#!/bin/bash
# ============================================================
#  LinDeploy WSL One-time Setup
#  Run inside WSL Ubuntu: bash /mnt/c/Users/riahi/LinDeploy/wsl-setup.sh
# ============================================================

set -e

echo ""
echo "============================================"
echo "  LinDeploy - WSL One-time Setup"
echo "============================================"
echo ""

# 1. Update apt
echo "[1/4] Updating package lists..."
sudo apt update -q

# 2. Install ansible + redis + ssh client if missing
echo "[2/4] Installing ansible, redis-server, openssh-client..."
sudo apt install -y ansible redis-server openssh-client

# 3. Allow redis-server to start without sudo password
#    Appends a sudoers rule for the current user
CURRENT_USER=$(whoami)
SUDOERS_FILE="/etc/sudoers.d/lindeploy-redis"
if [ ! -f "$SUDOERS_FILE" ]; then
    echo "[3/4] Granting passwordless sudo for redis-server service..."
    echo "$CURRENT_USER ALL=(ALL) NOPASSWD: /usr/sbin/service redis-server start, /usr/sbin/service redis-server stop, /usr/sbin/service redis-server restart, /usr/sbin/service redis-server status" | sudo tee $SUDOERS_FILE > /dev/null
    sudo chmod 440 $SUDOERS_FILE
    echo "      Done - redis-server can now start without a password prompt."
else
    echo "[3/4] Sudoers rule already exists, skipping."
fi

# 4. Start redis now
echo "[4/4] Starting Redis..."
sudo service redis-server start
redis-cli ping

echo ""
echo "============================================"
echo "  WSL Setup Complete!"
echo "  Ansible: $(ansible --version | head -1)"
echo "  Redis:   running"
echo "============================================"
echo ""
echo "Now run on Windows PowerShell:"
echo "  cd C:\Users\riahi\LinDeploy"
echo "  .\start-lindeploy.ps1"
echo ""

