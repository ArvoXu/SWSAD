import sys
import os
from flask import Flask, jsonify, send_from_directory, request
from flask_cors import CORS
import sqlite3
from datetime import datetime
import schedule
import time
import threading
from dotenv import load_dotenv

# --- Custom Imports ---
# Import the function to set up the database from our scraper script
from scraper import run_scraper as run_scraper_main # Rename to avoid conflict

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
# SCRAPER_SCRIPT_PATH = os.path.join(script_dir, 'scraper.py') # No longer needed
# PYTHON_EXECUTABLE = sys.executable # No longer needed

# --- State Management for Scraper ---
# A simple in-memory state tracker for the scraper job
scraper_status = {
    "status": "idle", # Can be "idle", "running", "success", "error"
    "last_run_start_time": None,
    "last_run_end_time": None,
    "last_run_output": ""
}

# --- Database Initialization ---
def setup_database(db_path):
    """
    Sets up the database connection and creates the inventory table if it doesn't exist.
    This function is defined here because it's a server concern.
    """
    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS inventory (
                store TEXT NOT NULL,
                machine_id TEXT NOT NULL,
                product_name TEXT NOT NULL,
                quantity INTEGER NOT NULL,
                last_updated TEXT,
                process_time TEXT NOT NULL,
                PRIMARY KEY (store, machine_id, product_name)
            )
        ''')
        conn.commit()
        print(f"Database setup complete. Table 'inventory' is ready at {db_path}")
    except Exception as e:
        print(f"Database setup error: {e}")
    finally:
        if conn:
            conn.close()

# Ensure the database and table exist before the app starts serving requests.
print(f"Initializing database at: {DB_PATH}")
setup_database(DB_PATH)
print("Database initialization complete.")


# --- Scraper Execution Logic ---
def scraper_thread_task():
    """The actual function that runs the scraper and updates status."""
    global scraper_status
    scraper_status["status"] = "running"
    scraper_status["last_run_start_time"] = datetime.now().isoformat()
    scraper_status["last_run_output"] = "" # Clear previous output
    print(f"[{datetime.now()}] --- Starting scraper via direct call in a thread ---")
    
    try:
        # We need to capture the print output of the scraper.
        # This is a bit complex, we'll redirect stdout.
        from io import StringIO
        import sys

        old_stdout = sys.stdout
        redirected_output = sys.stdout = StringIO()

        # Run the main scraper function
        run_scraper_main(headless=True)

        sys.stdout = old_stdout # Restore stdout
        
        output_str = redirected_output.getvalue()

        scraper_status["status"] = "success"
        scraper_status["last_run_output"] = output_str
        print(f"[{datetime.now()}] --- Scraper job finished successfully ---")

    except Exception as e:
        scraper_status["status"] = "error"
        error_message = f"An error occurred in scraper job: {str(e)}"
        scraper_status["last_run_output"] = error_message
        print(f"[{datetime.now()}] {error_message}")
    finally:
        scraper_status["last_run_end_time"] = datetime.now().isoformat()


# --- API Endpoints ---
@app.route('/run-scraper', methods=['POST'])
def run_scraper_endpoint():
    """
    Triggers the scraper to run in a background thread.
    Returns immediately so the frontend doesn't time out.
    """
    global scraper_status
    if scraper_status["status"] == "running":
        return jsonify({'success': False, 'message': '爬蟲已經在執行中，請稍後再試。'}), 409 # 409 Conflict

    print(f"[{datetime.now()}] Received request to run scraper.")
    # Run the scraper in a background thread
    thread = threading.Thread(target=scraper_thread_task)
    thread.start()
    
    return jsonify({'success': True, 'message': '爬蟲已在背景開始執行。'})


@app.route('/scraper-status', methods=['GET'])
def get_scraper_status():
    """Returns the current status of the scraper job."""
    global scraper_status
    return jsonify(scraper_status)


@app.route('/get-data', methods=['GET'])
def get_data():
    """
    Retrieves all inventory data from the database.
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
        # Convert rows to a list of dictionaries
        data = [dict(row) for row in cursor.fetchall()]
        
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
def run_scheduler():
    """
    Sets up and runs the scheduler in a loop.
    """
    # Define the schedule
    schedule.every().hour.at(":10").do(scraper_thread_task)
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