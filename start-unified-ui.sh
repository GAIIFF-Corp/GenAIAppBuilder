#!/bin/bash

# Start the unified UI for Generative AI Application Builder
# This combines both deployment management and chat functionality

echo "Starting Unified Generative AI Application Builder UI..."
echo "This includes both deployment management and chat interface"
echo ""
echo "Access the application at: http://localhost:5175"
echo "- Dashboard: http://localhost:5175/"
echo "- Chat Interface: http://localhost:5175/chat"
echo ""
echo "Press Ctrl+C to stop the server"
echo ""

cd ui-unified && npm start
