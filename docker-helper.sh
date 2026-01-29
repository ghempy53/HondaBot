#!/bin/bash
# =============================================================================
# HondaBot - Docker Helper Script for Raspberry Pi
# =============================================================================
# Usage: ./docker-helper.sh [command]
# =============================================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
CONTAINER_NAME="HondaBot"
COMPOSE_FILE="docker-compose.yml"

# Helper functions
print_header() {
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}  HondaBot Docker Helper${NC}"
    echo -e "${BLUE}========================================${NC}"
}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

# Check if Docker is running
check_docker() {
    if ! docker info > /dev/null 2>&1; then
        print_error "Docker is not running. Please start Docker first."
        exit 1
    fi
}

# Show usage
show_help() {
    print_header
    echo ""
    echo "Usage: $0 [command]"
    echo ""
    echo "Commands:"
    echo "  build         Build the Docker image"
    echo "  start         Start the container"
    echo "  stop          Stop the container"
    echo "  restart       Restart the container"
    echo "  logs          Show container logs (follow)"
    echo "  logs-tail     Show last 100 lines of logs"
    echo "  status        Show container status"
    echo "  shell         Open a shell in the container"
    echo "  clean         Remove container and image"
    echo "  clean-all     Remove everything including volumes"
    echo "  update        Pull latest code and rebuild"
    echo "  health        Check container health"
    echo "  stats         Show container resource usage"
    echo "  backup        Backup persistent data"
    echo "  fix-ipv6      Apply IPv6 fix for Raspberry Pi"
    echo "  help          Show this help message"
    echo ""
}

# Build image
cmd_build() {
    print_header
    echo "Building HondaBot..."
    echo ""
    
    # Try with BuildKit first
    if DOCKER_BUILDKIT=1 docker compose -f "$COMPOSE_FILE" build --no-cache 2>/dev/null; then
        print_success "Build completed successfully!"
    else
        print_warning "BuildKit build failed, trying without BuildKit..."
        DOCKER_BUILDKIT=0 docker compose -f "$COMPOSE_FILE" build --no-cache
        print_success "Build completed successfully!"
    fi
}

# Start container
cmd_start() {
    print_header
    echo "Starting HondaBot..."
    
    docker compose -f "$COMPOSE_FILE" up -d
    print_success "HondaBot started!"
    echo ""
    echo "View logs with: $0 logs"
}

# Stop container
cmd_stop() {
    print_header
    echo "Stopping HondaBot..."
    
    docker compose -f "$COMPOSE_FILE" down
    print_success "HondaBot stopped!"
}

# Restart container
cmd_restart() {
    print_header
    echo "Restarting HondaBot..."
    
    docker compose -f "$COMPOSE_FILE" restart
    print_success "HondaBot restarted!"
}

# Show logs
cmd_logs() {
    docker compose -f "$COMPOSE_FILE" logs -f
}

# Show last 100 lines
cmd_logs_tail() {
    docker compose -f "$COMPOSE_FILE" logs --tail=100
}

# Show status
cmd_status() {
    print_header
    echo "Container Status:"
    echo ""
    docker compose -f "$COMPOSE_FILE" ps
    echo ""
    echo "Health Status:"
    docker inspect --format='{{.State.Health.Status}}' "$CONTAINER_NAME" 2>/dev/null || echo "Not running"
}

# Open shell
cmd_shell() {
    docker exec -it "$CONTAINER_NAME" /bin/bash
}

# Clean up
cmd_clean() {
    print_header
    print_warning "This will remove the container and image."
    read -p "Are you sure? (y/N): " confirm
    
    if [[ "$confirm" =~ ^[Yy]$ ]]; then
        docker compose -f "$COMPOSE_FILE" down --rmi local
        docker builder prune -f --filter "until=24h"
        print_success "Cleaned up container and image."
    else
        echo "Cancelled."
    fi
}

# Clean everything including volumes
cmd_clean_all() {
    print_header
    print_error "WARNING: This will remove ALL data including credentials and instances!"
    read -p "Are you REALLY sure? (type 'yes' to confirm): " confirm
    
    if [[ "$confirm" == "yes" ]]; then
        docker compose -f "$COMPOSE_FILE" down --rmi local -v --remove-orphans
        docker builder prune -af
        print_success "Cleaned up everything."
    else
        echo "Cancelled."
    fi
}

# Update and rebuild
cmd_update() {
    print_header
    echo "Updating HondaBot..."
    
    # Stop container
    docker compose -f "$COMPOSE_FILE" down || true
    
    # Pull latest changes
    git stash
    git pull --rebase origin master
    git stash pop || true
    
    # Rebuild
    cmd_build
    
    # Start
    cmd_start
    
    print_success "Update completed!"
}

# Check health
cmd_health() {
    print_header
    echo "Health Check:"
    echo ""
    
    # Container status
    status=$(docker inspect --format='{{.State.Status}}' "$CONTAINER_NAME" 2>/dev/null || echo "not found")
    echo "Container Status: $status"
    
    # Health status
    health=$(docker inspect --format='{{.State.Health.Status}}' "$CONTAINER_NAME" 2>/dev/null || echo "not available")
    echo "Health Status: $health"
    
    # Memory usage
    echo ""
    echo "Resource Usage:"
    docker stats "$CONTAINER_NAME" --no-stream --format "Memory: {{.MemUsage}}\nCPU: {{.CPUPerc}}" 2>/dev/null || echo "Container not running"
}

# Show stats
cmd_stats() {
    docker stats "$CONTAINER_NAME"
}

# Backup persistent data
cmd_backup() {
    print_header
    backup_dir="backup_$(date +%Y%m%d_%H%M%S)"
    
    echo "Creating backup in $backup_dir..."
    mkdir -p "$backup_dir"
    
    # Copy data directories
    cp -r credentials "$backup_dir/" 2>/dev/null || print_warning "No credentials to backup"
    cp -r instances "$backup_dir/" 2>/dev/null || print_warning "No instances to backup"
    cp -r logs "$backup_dir/" 2>/dev/null || print_warning "No logs to backup"
    cp -r maps "$backup_dir/" 2>/dev/null || print_warning "No maps to backup"
    cp .env "$backup_dir/" 2>/dev/null || print_warning "No .env to backup"
    
    # Create tarball
    tar -czf "${backup_dir}.tar.gz" "$backup_dir"
    rm -rf "$backup_dir"
    
    print_success "Backup created: ${backup_dir}.tar.gz"
}

# Fix IPv6 issues
cmd_fix_ipv6() {
    print_header
    print_warning "This will modify system settings to disable IPv6."
    read -p "Continue? (y/N): " confirm
    
    if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
        echo "Cancelled."
        exit 0
    fi
    
    echo "Disabling IPv6..."
    
    # Add sysctl settings
    sudo tee -a /etc/sysctl.conf > /dev/null << 'EOF'

# Disable IPv6 for Docker compatibility
net.ipv6.conf.all.disable_ipv6 = 1
net.ipv6.conf.default.disable_ipv6 = 1
net.ipv6.conf.lo.disable_ipv6 = 1
EOF
    
    # Apply settings
    sudo sysctl -p
    
    # Configure Docker daemon
    sudo mkdir -p /etc/docker
    sudo tee /etc/docker/daemon.json > /dev/null << 'EOF'
{
    "ipv6": false,
    "ip6tables": false,
    "fixed-cidr-v6": "",
    "dns": ["8.8.8.8", "8.8.4.4"]
}
EOF
    
    # Restart Docker
    sudo systemctl restart docker
    
    print_success "IPv6 disabled. Docker restarted."
}

# Main
check_docker

case "${1:-help}" in
    build)       cmd_build ;;
    start)       cmd_start ;;
    stop)        cmd_stop ;;
    restart)     cmd_restart ;;
    logs)        cmd_logs ;;
    logs-tail)   cmd_logs_tail ;;
    status)      cmd_status ;;
    shell)       cmd_shell ;;
    clean)       cmd_clean ;;
    clean-all)   cmd_clean_all ;;
    update)      cmd_update ;;
    health)      cmd_health ;;
    stats)       cmd_stats ;;
    backup)      cmd_backup ;;
    fix-ipv6)    cmd_fix_ipv6 ;;
    help|*)      show_help ;;
esac
