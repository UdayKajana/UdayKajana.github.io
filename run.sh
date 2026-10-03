#!/bin/bash
# Kill any existing process on port 8000
lsof -ti:8000 | xargs kill -9 2>/dev/null || true
pkill -f "python3 -m http.server 8000" 2>/dev/null || true
sleep 1

# Start fresh server
cd "$(dirname "$0")"
echo "Starting Language Studio on http://localhost:8000"
python3 -m http.server 8000


{
  "rules": {
    ".read": "auth != null",
    ".write": "auth != null && auth.token.firebase.sign_in_provider === 'password'",

    "content": {
      ".read": "auth != null",
      ".write": "auth != null && auth.token.firebase.sign_in_provider === 'password'"
    },

    "languages": {
      ".read": "auth != null",
      ".write": "auth != null && auth.token.firebase.sign_in_provider === 'password'",

      "japan": {
        ".read": "auth != null",
        ".write": "auth != null && auth.token.firebase.sign_in_provider === 'password'"
      }
    }
  }
}