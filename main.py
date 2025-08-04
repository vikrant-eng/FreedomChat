 import os
import asyncio
import json
import logging
import random
import string
from functools import lru_cache
from concurrent.futures import ThreadPoolExecutor
from threading import Thread

from flask import Flask, render_template
import websockets
from websockets.exceptions import ConnectionClosed

# --- Logging ---
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)
executor = ThreadPoolExecutor()

# --- Globals ---
USERS_FILE = "users.json"
clients = {}
registered_users = {}

# --- Flask app ---
app = Flask(__name__)

@app.route("/")
def home():
    return render_template("chat.html")

# --- Persistent Storage ---
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

async def async_save_users():
    loop = asyncio.get_running_loop()
    await loop.run_in_executor(executor, save_users)

async def async_load_users():
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(executor, load_users)

# --- Utility ---
def generate_user_code(length=6):
    return "".join(random.choices(string.ascii_uppercase + string.digits, k=length))

async def broadcast_user_list():
    user_list = [
        {"name": name, "code": info["code"], "is_online": name in clients}
        for name, info in registered_users.items()
    ]
    message = json.dumps({"type": "user_list", "users": user_list})
    for ws in list(clients.values()):
        try:
            await ws.send(message)
        except Exception as e:
            logger.warning(f"Failed sending user list: {e}")

# --- WebSocket handler ---
async def ws_handler(websocket):
    username = None
    try:
        async for message in websocket:
            data = json.loads(message)
            msg_type = data.get("type")

            if msg_type == "register":
                username = data.get("name")
                if not username:
                    continue

                # Disconnect old session
                if username in clients:
                    old_ws = clients[username]
                    if old_ws.open and old_ws != websocket:
                        await old_ws.close()

                # Register user
                if username not in registered_users:
                    registered_users[username] = {"code": generate_user_code()}
                    await async_save_users()

                clients[username] = websocket
                await broadcast_user_list()
                await websocket.send(json.dumps({
                    "type": "registered",
                    "name": username,
                    "code": registered_users[username]["code"]
                }))

            elif msg_type in ("offer", "answer", "candidate", "call-reject", "call-ended", "chat", "read"):
                target = data.get("to")
                if target in clients:
                    await clients[target].send(json.dumps(data))

    except ConnectionClosed:
        logger.info(f"Connection closed for {username}")
    finally:
        if username and clients.get(username) == websocket:
            del clients[username]
            await broadcast_user_list()

# --- Combined server ---
async def start_websocket(port):
    async with websockets.serve(ws_handler, "0.0.0.0", port):
        await asyncio.Future()  # run forever

def run_flask(port):
    app.run(host="0.0.0.0", port=port, debug=False)

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    registered_users = asyncio.run(async_load_users())

    Thread(target=run_flask, args=(port,), daemon=True).start()
    asyncio.run(start_websocket(port))
