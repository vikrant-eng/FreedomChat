from flask import Flask, render_template
import socket

app = Flask(__name__)

@app.route('/')
def home():
    return render_template('chat.html')

if __name__ == '__main__':
    # Find a free port
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.bind(('', 0))
    port = s.getsockname()[1]
    s.close()

    app.run(host='10.204.39.98', port=port, debug=True)
