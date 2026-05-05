#!/bin/sh
chown -R node:node /app/logs
exec su-exec node "$@"