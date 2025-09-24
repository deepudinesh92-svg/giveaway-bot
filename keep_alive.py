from flask import Flask
app = Flask(__app__)

@app.route('/')
def home():
    return "✅ Bot is alive!"
