import os
import json
import random
import string
import logging
from flask import Flask, render_template
from flask_cors import CORS
from flask_sock import Sock

# --- Logging ---
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

# --- Globals ---
USERS_FILE = "users.json"
clients = {}
registered_users = {}

# --- Allowed Origins (for WebSockets) ---
ALLOWED_ORIGINS = [
    "http://localhost:5000",
    "https://openchat-h54k.onrender.com",
    "https://openchat-h54k.onrender.com/"
]

# --- Flask app ---
app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})  # Allow all for HTTP routes
sock = Sock(app)

@app.route("/")
def home():
    return render_template("chat.html")

# --- Utility functions ---
def load_users():
    try:
        if os.path.exists(USERS_FILE):
            with open(USERS_FILE, "r") as f:
                return json.load(f)
    except Exception as e:
        logger.error(f"Error loading users: {e}")
    return {}

def save_users():
    try:
        with open(USERS_FILE, "w") as f:
            json.dump(registered_users, f, indent=2)
    except Exception as e:
        logger.error(f"Error saving users: {e}")

def generate_user_code(length=6):
    return "".join(random.choices(string.ascii_uppercase + string.digits, k=length))

def broadcast_user_list():
    user_list = [
        {"name": name, "code": info["code"], "is_online": name in clients}
        for name, info in registered_users.items()
    ]
    message = json.dumps({"type": "user_list", "users": user_list})
    for ws in list(clients.values()):
        try:
            ws.send(message)
        except Exception as e:
            logger.warning(f"Failed sending user list: {e}")

# --- WebSocket endpoint ---
@sock.route("/ws")
def ws_handler(ws):
    # --- Check WebSocket Origin ---
    origin = (ws.environ.get("HTTP_ORIGIN") or "").rstrip("/")
    if origin not in [o.rstrip("/") for o in ALLOWED_ORIGINS]:
        logger.warning(f"Blocked WS connection from origin: {origin}")
        ws.close()
        return

    username = None
    try:
        while True:
            message = ws.receive()
            if not message:
                break
            data = json.loads(message)
            msg_type = data.get("type")

            if msg_type == "register":
                username = data.get("name")
                if not username:
                    continue

                # Close old connection if user already connected
                if username in clients:
                    try:
                        clients[username].close()
                    except:
                        pass

                # Register new user if not exists
                if username not in registered_users:
                    registered_users[username] = {"code": generate_user_code()}
                    save_users()

                clients[username] = ws
                broadcast_user_list()
                ws.send(json.dumps({
                    "type": "registered",
                    "name": username,
                    "code": registered_users[username]["code"]
                }))

            # Forward signaling and chat messages
            elif msg_type in ("offer", "answer", "candidate", "call-reject", "call-ended", "chat", "read"):
                target = data.get("to")
                if target in clients:
                    try:
                        clients[target].send(json.dumps(data))
                    except:
                        pass

    except:
        logger.info(f"Connection closed for {username}")
    finally:
        if username and clients.get(username) == ws:
            del clients[username]
            broadcast_user_list()

# --- Entry Point ---
if __name__ == "__main__":
    registered_users = load_users()
    port = int(os.environ.get("PORT", 5000))  # Render sets PORT automatically

    from hypercorn.asyncio import serve
    from hypercorn.config import Config
    import asyncio

    config = Config()
    config.bind = [f"0.0.0.0:{port}"]

    asyncio.run(serve(app, config))
