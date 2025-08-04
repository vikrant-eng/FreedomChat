from flask import Flask, render_template
import socket
import os

app = Flask(__name__)

@app.route('/')
def home():
    return render_template('chat.html')

if __name__ == '__main__':
    # Find a free port
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.bind(('', 0))
    #port = s.getsockname()[1]
    port = int(os.environ.get('PORT', 5000))
    s.close()

    app.run(host='0.0.0.0', port=port, debug=True)

