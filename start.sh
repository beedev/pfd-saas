#!/bin/bash

PORT=4000

# Kill existing server on the port
echo "Stopping existing server on port $PORT..."
lsof -ti:$PORT | xargs kill -9 2>/dev/null

# Wait a moment for port to be released
sleep 1

# Start the dev server on specified port
echo "Starting dev server on port $PORT..."
npm run dev -- -p $PORT
