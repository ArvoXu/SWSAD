import sys
import os
from datetime import datetime
from flask import Flask, jsonify, send_from_directory, request
from flask_cors import CORS
import schedule
import time
import threading
from dotenv import load_dotenv
from sqlalchemy.orm import Session
from dateutil.parser import parse as parse_date


# --- Custom Imports ---
from database import init_db, get_db, Inventory, Store
from scraper import run_scraper as run_scraper_function, parse_inventory_from_text, save_to_database, save_to_json

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
# DB_PATH = os.path.join(script_dir, 'inventory.db') # This line is no longer needed
# SCRAPER_SCRIPT_PATH = os.path.join(script_dir, 'scraper.py') # This line is no longer needed
# PYTHON_EXECUTABLE = sys.executable # This line is no longer needed

# --- Database Initialization ---
# Ensure the database and table exist before the app starts serving requests.
# This is crucial for the first run on a new server deployment.
print(f"Initializing database at: {script_dir}")
init_db() # This command creates the tables in our PostgreSQL or SQLite database if they don't exist.
print("Database initialization complete.")


def run_scraper_background():
    """
    This function runs the scraper in a background thread and updates the global state.
    It now uses the new database functions.
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
            structured_data = parse_inventory_from_text(raw_inventory_text)
            
            # --- Define output paths ---
            output_json_path = os.path.join(script_dir, 'structured_inventory.json')
            
            # 3. Save to JSON and Database
            # Convert datetime objects for JSON serialization
            json_serializable_data = []
            for item in structured_data:
                item_copy = item.copy()
                if 'process_time' in item_copy and hasattr(item_copy['process_time'], 'isoformat'):
                    item_copy['process_time'] = item_copy['process_time'].isoformat()
                json_serializable_data.append(item_copy)
            
            save_to_json(json_serializable_data, output_json_path)
            
            # The data is already parsed with datetime objects, so we can save it directly
            save_to_database(structured_data)
            
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
    Retrieves all inventory and custom store data, merges them,
    and returns them as a single JSON response with camelCase keys.
    """
    db: Session = next(get_db())
    try:
        # 1. Fetch all inventory data
        inventory_items = db.query(Inventory).all()
        
        # 2. Fetch all custom store data
        stores = db.query(Store).all()
        # Create a dictionary for quick lookups: {'store_key': {address: '...', 'note': '...'}}
        store_info_map = {store.store_key: store.to_dict() for store in stores}

        # 3. Merge the data
        merged_data = []
        for item in inventory_items:
            item_dict = item.to_dict()
            store_key = f"{item.store}-{item.machine_id}"
            
            # Get custom data for this store, if it exists
            custom_store_data = store_info_map.get(store_key, {})
            
            # Merge inventory data with custom store data
            full_item_data = {**item_dict, **custom_store_data}
            
            # 4. Convert all keys to camelCase for the frontend
            camel_case_data = {to_camel_case(key): value for key, value in full_item_data.items()}
            
            # Ensure process_time is in ISO format string
            if 'processTime' in camel_case_data and hasattr(camel_case_data['processTime'], 'isoformat'):
                camel_case_data['processTime'] = camel_case_data['processTime'].isoformat()

            merged_data.append(camel_case_data)
        
        return jsonify({"success": True, "data": merged_data})
        
    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 500
    finally:
        db.close()

@app.route('/api/stores/<string:store_key>', methods=['POST'])
def update_store_data(store_key):
    """
    Updates the custom data for a specific store (address, note, sales, hidden status).
    This is the new endpoint for saving user edits.
    """
    data = request.get_json()
    if not data:
        return jsonify({"success": False, "message": "No data provided"}), 400

    db: Session = next(get_db())
    try:
        store = db.query(Store).filter(Store.store_key == store_key).first()
        
        # If the store doesn't exist in our custom table, create it
        if not store:
            store = Store(store_key=store_key)
            db.add(store)
        
        # Update fields if they are present in the request
        if 'address' in data:
            store.address = data['address']
        if 'note' in data:
            store.note = data['note']
        if 'manualSales' in data:
            store.manual_sales = data['manualSales']
        if 'isHidden' in data:
            store.is_hidden = data['isHidden']
            
        db.commit()
        db.refresh(store) # Refresh to get the latest state from DB
        
        return jsonify({"success": True, "data": store.to_dict()})
        
    except Exception as e:
        db.rollback()
        return jsonify({"success": False, "message": str(e)}), 500
    finally:
        db.close()


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
    We'll disable this for now as the background trigger is the main focus.
    TODO: Re-evaluate the need for a scheduler with the new architecture.
    """
    # schedule.every().hour.at(":10").do(run_scraper_job)
    print("Scheduler is currently disabled.")
    while True:
        time.sleep(3600) # Sleep for an hour

# --- Main Execution ---
if __name__ == '__main__':
    # Run the scheduler in a separate thread
    scheduler_thread = threading.Thread(target=run_scheduler, daemon=True)
    scheduler_thread.start()
    
    # Start the Flask app
    # Render will use gunicorn, but for local testing, this is fine.
    # The host '0.0.0.0' makes it accessible on your local network.
    app.run(host='0.0.0.0', port=5001, debug=False) 