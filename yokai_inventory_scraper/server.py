import sys
import os
from flask import Flask, jsonify, send_from_directory
from flask_cors import CORS
import subprocess
import sqlite3
from datetime import datetime
import schedule
import time
import threading
from dotenv import load_dotenv

# --- Pre-startup Configuration ---
# Get the directory where the script is located
# This is crucial for making file paths work correctly in any environment
script_dir = os.path.dirname(os.path.abspath(__file__))

# Load environment variables from .env file located in the same directory
# This needs to happen before any other part of the app uses them
dotenv_path = os.path.join(script_dir, '.env')
if os.path.exists(dotenv_path):
    print(f"Loading environment variables from: {dotenv_path}")
    load_dotenv(dotenv_path=dotenv_path)
else:
    print(f".env file not found at {dotenv_path}. Relying on system-set environment variables.")


# --- Flask App Setup ---
app = Flask(__name__, static_folder=script_dir, static_url_path='')
CORS(app) # 允許所有來源的跨域請求，方便本地開發

# --- Global Variables & Constants ---
# Use the script's directory to build absolute paths
DB_PATH = os.path.join(script_dir, 'inventory.db')
SCRAPER_SCRIPT_PATH = os.path.join(script_dir, 'scraper.py')
PYTHON_EXECUTABLE = sys.executable


# --- API Endpoints ---
@app.route('/run-scraper', methods=['POST'])
def run_scraper():
    """
    Triggers the scraper script to run as a separate process.
    """
    print(f"[{datetime.now()}] Received request to run scraper.")
    try:
        # Run scraper.py using the determined python executable and script path
        process = subprocess.run(
            [PYTHON_EXECUTABLE, SCRAPER_SCRIPT_PATH],
            capture_output=True,
            text=True,
            check=True,  # This will raise CalledProcessError if the script returns a non-zero exit code
            encoding='utf-8',
            errors='replace',
            timeout=300  # 5-minute timeout for the scraper
        )
        print(f"[{datetime.now()}] Scraper executed successfully via subprocess.")
        print("Scraper Output:", process.stdout)
        return jsonify({'success': True, 'message': '爬蟲腳本執行成功。'})
    except subprocess.CalledProcessError as e:
        # This catches errors from within the scraper script itself
        error_message = f"爬蟲腳本執行時發生錯誤: {e.stderr}"
        print(f"[{datetime.now()}] {error_message}")
        return jsonify({'success': False, 'message': error_message}), 500
    except Exception as e:
        # This catches other errors, like timeout or setup issues
        error_message = f"手動更新失敗: {str(e)}"
        print(f"[{datetime.now()}] {error_message}")
        return jsonify({'success': False, 'message': '手動更新失敗。', 'error': error_message}), 500


@app.route('/get-data', methods=['GET'])
def get_data():
    """
    Retrieves all inventory data from the database.
    """
    try:
        db = sqlite3.connect(DB_PATH)
        cursor = db.cursor()
        cursor.execute("""
            SELECT 
                store, machineId, productName, quantity, 
                lastUpdated, lastCleaned, processTime 
            FROM inventory
        """)
        rows = cursor.fetchall()
        
        # Convert rows to a list of dictionaries
        data = [dict(zip([column[0] for column in cursor.description], row)) for row in rows]
        
        db.close()
        return jsonify({"success": True, "data": data})
    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 500

# --- Static File Serving ---
@app.route('/')
def serve_index():
    return send_from_directory(script_dir, 'index.html')

@app.route('/<path:path>')
def serve_static_files(path):
    # This will serve other files like script.js and presentation.html
    return send_from_directory(script_dir, path)


# --- Scheduler Setup ---
def run_scraper_job():
    """
    The actual job of running the scraper script.
    Called by the scheduler.
    """
    print(f"[{datetime.now()}] --- Starting scheduled scraper job ---")
    try:
        process = subprocess.run(
            [PYTHON_EXECUTABLE, SCRAPER_SCRIPT_PATH],
            capture_output=True,
            text=True,
            check=True,
            encoding='utf-8',
            errors='replace',
            timeout=300
        )
        print(f"[{datetime.now()}] Scraper job finished successfully.")
        print("Output:", process.stdout)
        return True, "Scraper job successful."
    except Exception as e:
        error_message = f"An error occurred in scraper job: {getattr(e, 'stderr', str(e))}"
        print(f"[{datetime.now()}] {error_message}")
        return False, error_message

def run_scheduler():
    """
    Sets up and runs the scheduler in a loop.
    """
    # Define the schedule
    schedule.every().hour.at(":10").do(run_scraper_job)
    # schedule.every().day.at("08:00").do(run_scraper_job)

    print("Scheduler started. Waiting for scheduled jobs...")
    while True:
        schedule.run_pending()
        time.sleep(1)

# --- Main Execution ---
if __name__ == '__main__':
    # Run the scheduler in a separate thread
    scheduler_thread = threading.Thread(target=run_scheduler, daemon=True)
    scheduler_thread.start()
    
    # Start the Flask app
    # Render will use gunicorn, but for local testing, this is fine.
    # The host '0.0.0.0' makes it accessible on your local network.
    app.run(host='0.0.0.0', port=5001, debug=False) 