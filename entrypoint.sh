#!/bin/sh
set -e

# Fix ownership of bind-mounted data directories.
# Docker bind mounts inherit host file ownership which may not match the
# container's hondabot user (UID 1001). This runs as root at container
# start, before dropping privileges to run the application.
for dir in /app/credentials /app/instances /app/logs /app/maps; do
    if [ -d "$dir" ]; then
        chown -R hondabot:hondabot "$dir" 2>/dev/null || true
    fi
done

# Drop privileges and exec the main command as hondabot
exec gosu hondabot "$@"
