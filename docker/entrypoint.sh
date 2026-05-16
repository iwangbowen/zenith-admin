#!/bin/sh
# Server entrypoint: run Drizzle migrations then start the Hono server.
# Using exec so Node.js receives OS signals (SIGTERM) for graceful shutdown.
set -e

echo "Running database migrations..."
node dist/db/migrate.js

echo "Starting server..."
exec node dist/index.js
