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

# --- Custom Imports ---
# Import the function to set up the database from our scraper script
from scraper import setup_database, run_scraper as run_scraper_function

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

# --- Global State for Scraper ---
# This dictionary will hold the state of our scraper job.
# Using a lock to ensure thread-safe updates.
scraper_state = {
    "status": "idle", # Can be 'idle', 'running', 'success', 'error'
    "last_run_output": ""
}
state_lock = threading.Lock()

# --- Global Variables & Constants ---
# Use the script's directory to build absolute paths
DB_PATH = os.path.join(script_dir, 'inventory.db')
SCRAPER_SCRIPT_PATH = os.path.join(script_dir, 'scraper.py')
PYTHON_EXECUTABLE = sys.executable

# --- Database Initialization ---
# Ensure the database and table exist before the app starts serving requests.
# This is crucial for the first run on a new server deployment.
print(f"Initializing database at: {DB_PATH}")
setup_database(DB_PATH)
print("Database initialization complete.")


def run_scraper_background():
    """
    This function runs the scraper in a background thread and updates the global state.
    """
    global scraper_state
    
    # Update state to 'running'
    with state_lock:
        scraper_state['status'] = 'running'
        scraper_state['last_run_output'] = ''

    try:
        # We need to call the actual scraper logic here.
        # Since scraper.py's main execution block is complex,
        # we directly call the necessary functions.
        
        # 1. Execute the web scraper to get raw text
        raw_inventory_text = run_scraper_function(headless=True)
        
        if raw_inventory_text:
            # 2. Parse the raw text into structured data
            from scraper import parse_inventory_from_text, save_to_json, save_to_database
            structured_data = parse_inventory_from_text(raw_inventory_text)
            
            # --- Define output paths ---
            output_json_path = os.path.join(script_dir, 'structured_inventory.json')
            
            # 3. Save to JSON and Database
            save_to_json(structured_data, output_json_path)
            setup_database(DB_PATH) # Ensure table exists
            save_to_database(DB_PATH, structured_data)
            
            output = "Scraper finished successfully."
            status = "success"
        else:
            output = "Scraper ran but returned no data."
            status = "error"
            
    except Exception as e:
        output = f"An error occurred in background scraper: {str(e)}"
        status = "error"
    
    # Update state with the final result
    with state_lock:
        scraper_state['status'] = status
        scraper_state['last_run_output'] = output
        

# --- API Endpoints ---
@app.route('/run-scraper', methods=['POST'])
def trigger_scraper():
    """
    Triggers the scraper script to run in a background thread.
    Returns immediately so the client doesn't time out.
    """
    with state_lock:
        if scraper_state['status'] == 'running':
            return jsonify({'success': False, 'message': 'Scraper is already running.'}), 409

    print(f"[{datetime.now()}] Received request to run scraper in background.")
    # Run the scraper in a separate thread
    thread = threading.Thread(target=run_scraper_background)
    thread.start()
    
    return jsonify({'success': True, 'message': 'Scraper job started in the background.'}), 202

@app.route('/scraper-status', methods=['GET'])
def get_scraper_status():
    """
    Returns the current status of the scraper job.
    """
    with state_lock:
        return jsonify(scraper_state)

def to_camel_case(snake_str):
    """
    Converts a snake_case string to camelCase.
    Example: 'product_name' -> 'productName'
    """
    components = snake_str.split('_')
    # Capitalize the first letter of each component except the first one
    # and join them together.
    return components[0] + ''.join(x.title() for x in components[1:])

@app.route('/get-data', methods=['GET'])
def get_data():
    """
    Retrieves all inventory data from the database and converts keys to camelCase.
    """
    try:
        db = sqlite3.connect(DB_PATH)
        db.row_factory = sqlite3.Row # This allows accessing columns by name
        cursor = db.cursor()
        cursor.execute("""
            SELECT 
                store, machine_id, product_name, quantity, 
                last_updated, process_time
            FROM inventory
        """)
        
        # Fetch all rows
        rows = cursor.fetchall()
        db.close()

        # Convert list of Row objects to list of dicts with camelCase keys
        data = []
        for row in rows:
            camel_case_row = {to_camel_case(key): value for key, value in dict(row).items()}
            data.append(camel_case_row)
        
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