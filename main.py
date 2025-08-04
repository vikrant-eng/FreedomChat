import subprocess
import os
import sys

# --- Optional: Activate venv automatically ---
# Get path to venv's python
venv_python = os.path.join("venv", "Scripts", "python.exe") if os.name == "nt" else os.path.join("venv", "bin", "python")

# If venv is not activated, use its python
python_exec = venv_python if os.path.exists(venv_python) else sys.executable

# --- Start Flask app (app.py) ---
flask_process = subprocess.Popen([python_exec, "app.py"])
print("✅ Flask app started (app.py)")

# --- Start WebSocket server (server.py) ---
server_process = subprocess.Popen([python_exec, "server.py"])
print("✅ WebSocket server started (server.py)")

try:
    # Wait for both processes
    flask_process.wait()
    server_process.wait()
except KeyboardInterrupt:
    print("🛑 Shutting down...")
    flask_process.terminate()
    server_process.terminate()
