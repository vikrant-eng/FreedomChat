import asyncio
import json
import logging
import sys
import socket
import os
import random
import string
from functools import lru_cache
from concurrent.futures import ThreadPoolExecutor 
from websockets.server import serve
from websockets.exceptions import ConnectionClosed

# --- Logging ---
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[logging.StreamHandler(sys.stdout)]
)
logger = logging.getLogger(__name__)
executor = ThreadPoolExecutor()

# --- Globals ---
USERS_FILE = "users.json"
clients = {}            # username -> websocket
registered_users = {}   # username -> {"code": str}

# --- Persistent Storage ---
def load_users():
    if os.path.exists(USERS_FILE):
        try:
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
    return ''.join(random.choices(string.ascii_uppercase + string.digits, k=length))

@lru_cache(maxsize=1)
def get_local_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"

HOST ="0.0.0.0"#get_local_ip()
PORT = 8765

# --- Broadcast users ---
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
            logger.warning(f"Failed sending user list to client: {e}")

# --- WebSocket Handler ---
async def ws_handler(websocket):
    username = None
    logger.info(f"🔌 New connection from {websocket.remote_address}")
    try:
        async for message in websocket:
            logger.info(f"📩 Message from {websocket.remote_address}: {message}")
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
                        await old_ws.close(code=1000, reason="Replaced by new connection")

                # Register new user
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
                    try:
                        await clients[target].send(json.dumps(data))
                    except Exception as e:
                        logger.warning(f"Failed to forward {msg_type} to '{target}': {e}")

    except ConnectionClosed:
        logger.info(f"❌ Connection closed for {username or websocket.remote_address}")
    finally:
        if username and clients.get(username) == websocket:
            del clients[username]
            await broadcast_user_list()

# --- Corrected process_request for HTTP health checks ---
async def process_request(path, request_headers):
    if request_headers.get("Upgrade", "").lower() != "websocket":
        return (
            200,
            [("Content-Type", "text/plain")],
            b"OK"
        )
    return None

# --- Wrapper to reject non-WebSocket requests (optional, not required with above fix) ---
async def ws_wrapper(websocket):
    if websocket.request_headers.get("Upgrade", "").lower() != "websocket":
        await websocket.close(code=1000, reason="Non-WebSocket request")
        return
    await ws_handler(websocket)

# --- Main ---
async def main():
    global registered_users
    registered_users = await async_load_users()
    logger.info(f"🚀 Server listening on ws://{HOST}:{PORT}")

    async with serve(
        ws_wrapper,
        HOST,
        PORT,
        process_request=process_request
    ):
        await asyncio.Future()  # run forever

# --- Run ---
if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("🛑 Server stopped manually")