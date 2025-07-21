from flask import Flask, render_template

app = Flask(__name__)

@app.route('/')
def home():
    return render_template('chat.html')

if __name__ == '__main__':
    # Replace '0.0.0.0' with your custom IP address
    # For example, '192.168.1.100'
    app.run(host='10.0.3.8', port=8080, debug=True)
