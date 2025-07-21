import sys
import os
from datetime import datetime
from flask import Flask, jsonify, send_from_directory, request, redirect, render_template, session, flash
from flask_cors import CORS
import schedule
import time
import threading
from dotenv import load_dotenv
from sqlalchemy.orm import Session
from sqlalchemy.exc import OperationalError
import subprocess
import logging
import traceback
from dateutil.parser import parse as parse_date
import pandas as pd
import shutil


# --- Custom Imports ---
from database import init_db, get_db, Inventory, Store, Transaction, UpdateLog
from scraper import run_scraper as run_inventory_scraper_function, parse_inventory_from_text, save_to_database, save_to_json
from salesscraper import run_sales_scraper

# Setup logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

# --- Pre-startup Configuration ---
# Get the directory where the script is located
# This is crucial for making file paths work correctly in any environment
script_dir = os.path.dirname(os.path.abspath(__file__))

# Load environment variables from .env file located in the same directory
# This needs to happen before any other part of the app uses them
dotenv_path = os.path.join(script_dir, '.env')
if os.path.exists(dotenv_path):
    logging.info(f"Loading environment variables from: {dotenv_path}")
    load_dotenv(dotenv_path=dotenv_path)
else:
    logging.info(f".env file not found at {dotenv_path}. Relying on system-set environment variables.")


# --- Flask App Setup ---
app = Flask(__name__, 
            static_folder=script_dir, 
            static_url_path='',
            template_folder=os.path.join(script_dir, 'templates')) # Point to the templates folder
CORS(app) # 允許所有來源的跨域請求，方便本地開發

# --- Secret Key for Session Management ---
# It's crucial this is set and kept secret in production.
# We'll load it from an environment variable.
app.secret_key = os.getenv("FLASK_SECRET_KEY", "dev-secret-key-for-local-testing")

# --- Global State for Scraper ---
# This dictionary will hold the state of our scraper job.
# Using a lock to ensure thread-safe updates.
scraper_state = {
    "status": "idle", # Can be 'idle', 'running', 'success', 'error'
    "last_run_output": ""
}
state_lock = threading.Lock()

# --- Global State for Sales Scraper ---
sales_scraper_state = {
    "status": "idle", # Can be 'idle', 'running', 'success', 'error'
    "last_run_output": ""
}
sales_state_lock = threading.Lock()


# --- Global Variables & Constants ---
# Use the script's directory to build absolute paths
# DB_PATH = os.path.join(script_dir, 'inventory.db') # This line is no longer needed
# SCRAPER_SCRIPT_PATH = os.path.join(script_dir, 'scraper.py') # This line is no longer needed
# PYTHON_EXECUTABLE = sys.executable # This line is no longer needed

# --- Database Initialization ---
# Ensure the database and table exist before the app starts serving requests.
# This is crucial for the first run on a new server deployment.
logging.info(f"Initializing database at: {script_dir}")
init_db() # This command creates the tables in our PostgreSQL or SQLite database if they don't exist.
logging.info("Database initialization complete.")


def run_inventory_scraper_background():
    """
    This function runs the scraper in a background thread and updates the global state.
    It now uses the new database functions.
    It's also thread-safe, checking if another job is already running.
    """
    global scraper_state
    
    with state_lock:
        if scraper_state['status'] == 'running':
            logging.warning(f"[{datetime.now()}] Scraper start requested, but a job is already in progress. Aborting.")
            return
        
        # Update state to 'running'
        scraper_state['status'] = 'running'
        scraper_state['last_run_output'] = ''
        logging.info(f"[{datetime.now()}] Scraper status set to 'running'. Starting job.")

    try:
        # We need to call the actual scraper logic here.
        # Since scraper.py's main execution block is complex,
        # we directly call the necessary functions.
        
        # 1. Execute the web scraper to get raw text
        raw_inventory_text = run_inventory_scraper_function(headless=True)
        
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
            items_saved_count = len(structured_data)
            save_to_database(structured_data)
            
            output = f"Scraper finished successfully. Processed {items_saved_count} items."
            status = "success"
        else:
            output = "Scraper ran but returned no data."
            status = "error"
            
    except Exception as e:
        output = f"An error occurred in background scraper: {str(e)}"
        status = "error"
        logging.error(output, exc_info=True)
    
    # Update state with the final result
    with state_lock:
        scraper_state['status'] = status
        scraper_state['last_run_output'] = output
        
    # Log the update to the database with a retry mechanism
    log_db_update(scraper_type='inventory', status=status, details=output)


def run_sales_scraper_background():
    """
    Runs the sales scraper in a background thread, processes the downloaded file,
    and updates the database with a retry mechanism.
    """
    global sales_scraper_state
    
    with sales_state_lock:
        if sales_scraper_state['status'] == 'running':
            logging.warning(f"[{datetime.now()}] Sales scraper start requested, but a job is already in progress. Aborting.")
            return
        sales_scraper_state['status'] = 'running'
        sales_scraper_state['last_run_output'] = ''
        logging.info(f"[{datetime.now()}] Sales scraper status set to 'running'. Starting job.")

    downloaded_file_path = None
    try:
        # 1. Run the scraper to download the file
        downloaded_file_path = run_sales_scraper()
        
        # 2. Process the downloaded Excel file
        if downloaded_file_path:
            df = pd.read_excel(downloaded_file_path)
            df.rename(columns={
                'Shop name': 'shopName',
                'Product': 'product',
                'Trasaction Date': 'date',
                'Total Transaction Amount': 'amount',
                'Pay type': 'payType'
            }, inplace=True)
            transactions_data = df.to_dict('records')
            
            # 3. Add transactions to the DB with retry logic
            max_retries = 3
            retry_delay_seconds = 5
            for attempt in range(max_retries):
                db: Session = next(get_db())
                try:
                    # This block is a simplified version of the logic in add_transactions endpoint
                    db.query(Transaction).delete()
                    
                    all_stores = db.query(Store).all()
                    store_name_map = {}
                    for s in all_stores:
                        name_parts = s.store_key.rsplit('-', 1)
                        name = name_parts[0]
                        if name not in store_name_map:
                            store_name_map[name] = s

                    new_transactions = []
                    for item in transactions_data:
                        shop_name_raw = item.get('shopName')
                        if not shop_name_raw or pd.isna(item.get('date')):
                            continue
                        
                        shop_name = str(shop_name_raw).strip()
                        store = store_name_map.get(shop_name)
                        
                        if not store:
                            new_store_key = f"{shop_name}-provisional_sales"
                            store = db.query(Store).filter(Store.store_key == new_store_key).first()
                            if not store:
                                store = Store(store_key=new_store_key)
                                db.add(store)
                                db.flush()
                            store_name_map[shop_name] = store

                        new_transactions.append(Transaction(
                            store_key=store.store_key,
                            transaction_time=pd.to_datetime(item.get('date')),
                            amount=int(float(item.get('amount', 0))),
                            product_name=str(item.get('product')),
                            payment_type=str(item.get('payType'))
                        ))

                    if new_transactions:
                        db.bulk_save_objects(new_transactions)
                    
                    db.commit()
                    processed_count = len(new_transactions)
                    output = f"Sales scraper finished successfully. Processed {processed_count} transactions."
                    status = "success"
                    logging.info(f"Database operation successful on attempt {attempt + 1}.")
                    db.close()
                    break # Exit retry loop on success
                except OperationalError as e:
                    db.rollback()
                    db.close()
                    logging.error(f"Sales DB error (Attempt {attempt + 1}/{max_retries}): {e}")
                    if attempt + 1 >= max_retries:
                        output = f"Sales scraper failed after {max_retries} attempts: {e}"
                        status = "error"
                        raise
                    logging.info(f"Retrying in {retry_delay_seconds} seconds...")
                    time.sleep(retry_delay_seconds)
                finally:
                    # Ensure db is closed if it's still open
                    if 'db' in locals() and db.is_active:
                         db.close()
        else:
            output = "Sales scraper ran but did not return a file path."
            status = "error"
            
    except Exception as e:
        output = f"An error occurred in background sales scraper: {str(e)}"
        status = "error"
        logging.error(output, exc_info=True)
    finally:
        # 4. Clean up downloaded file and temp directory
        if downloaded_file_path:
            download_dir = os.path.dirname(downloaded_file_path)
            try:
                shutil.rmtree(download_dir)
                logging.info(f"Successfully cleaned up temporary directory: {download_dir}")
            except OSError as e:
                logging.error(f"Error removing directory {download_dir}: {e.strerror}")
                
        with sales_state_lock:
            sales_scraper_state['status'] = status
            sales_scraper_state['last_run_output'] = output
            
        # Log the update to the database with a retry mechanism
        log_db_update(scraper_type='sales', status=status, details=output)


def log_db_update(scraper_type, status, details):
    """Logs an update record to the database with a retry mechanism."""
    max_retries = 3
    retry_delay = 5
    for attempt in range(max_retries):
        db_log: Session = next(get_db())
        try:
            log_entry = UpdateLog(scraper_type=scraper_type, status=status, details=details)
            db_log.add(log_entry)
            db_log.commit()
            logging.info(f"Successfully logged '{status}' for '{scraper_type}' scraper.")
            return
        except OperationalError as e:
            db_log.rollback()
            logging.error(f"Failed to write to update_logs (Attempt {attempt + 1}/{max_retries}): {e}")
            if attempt + 1 >= max_retries:
                logging.error(f"Giving up on logging after {max_retries} attempts.")
            else:
                logging.info(f"Retrying log write in {retry_delay} seconds...")
                time.sleep(retry_delay)
        except Exception as e:
            db_log.rollback()
            logging.error(f"An unexpected error occurred while writing to update_logs: {e}", exc_info=True)
            return # Don't retry on unexpected errors
        finally:
            db_log.close()


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

    logging.info(f"[{datetime.now()}] Received request to run scraper in background.")
    # Run the scraper in a separate thread
    thread = threading.Thread(target=run_inventory_scraper_background)
    thread.start()
    
    return jsonify({'success': True, 'message': 'Scraper job started in the background.'}), 202

@app.route('/scraper-status', methods=['GET'])
def get_scraper_status():
    """
    Returns the current status of the scraper job.
    """
    with state_lock:
        return jsonify(scraper_state)

@app.route('/run-sales-scraper', methods=['POST'])
def trigger_sales_scraper():
    """
    Triggers the sales scraper to run in a background thread.
    """
    with sales_state_lock:
        if sales_scraper_state['status'] == 'running':
            return jsonify({'success': False, 'message': 'Sales scraper is already running.'}), 409

    logging.info(f"[{datetime.now()}] Received request to run sales scraper in background.")
    thread = threading.Thread(target=run_sales_scraper_background)
    thread.start()
    
    return jsonify({'success': True, 'message': 'Sales scraper job started in the background.'}), 202

@app.route('/sales-scraper-status', methods=['GET'])
def get_sales_scraper_status():
    """
    Returns the current status of the sales scraper job.
    """
    with sales_state_lock:
        return jsonify(sales_scraper_state)

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

@app.route('/api/update-logs', methods=['GET'])
def get_update_logs():
    """Returns the last 50 update log entries, newest first."""
    db: Session = next(get_db())
    try:
        logs = db.query(UpdateLog).order_by(UpdateLog.ran_at.desc()).limit(50).all()
        result = [
            {
                "scraperType": log.scraper_type,
                "ranAt": log.ran_at.isoformat(),
                "status": log.status,
                "details": log.details
            }
            for log in logs
        ]
        return jsonify(result)
    except Exception as e:
        logging.error(f"Error getting update logs: {e}", exc_info=True)
        return jsonify({"error": "Could not retrieve update logs"}), 500
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
        
        if not store:
            store = Store(store_key=store_key)
            db.add(store)
        
        if 'address' in data:
            store.address = data['address']
        if 'note' in data:
            store.note = data['note']
        if 'manualSales' in data:
            store.manual_sales = data['manualSales']
        if 'isHidden' in data:
            store.is_hidden = data['isHidden']
            
        db.commit()
        db.refresh(store)
        
        return jsonify({"success": True, "data": store.to_dict()})
        
    except Exception as e:
        db.rollback()
        return jsonify({"success": False, "message": str(e)}), 500
    finally:
        db.close()

@app.route('/api/transactions', methods=['POST'])
def add_transactions():
    """
    Receives a list of transactions, clears existing ones, and saves the new ones.
    Includes a retry mechanism for database operations.
    """
    transactions_data = request.get_json()
    if not isinstance(transactions_data, list):
        return jsonify({"success": False, "message": "Invalid data format. Expected a list of transactions."}), 400

    max_retries = 3
    retry_delay_seconds = 5
    for attempt in range(max_retries):
        db: Session = next(get_db())
        try:
            # Clear existing transactions
            db.query(Transaction).delete()
            logging.info("Cleared existing transactions.")
            
            new_transactions = []
            
            all_stores = db.query(Store).all()
            store_name_map = {}
            for s in all_stores:
                name_parts = s.store_key.rsplit('-', 1)
                name = name_parts[0]
                if name not in store_name_map:
                    store_name_map[name] = s

            for item in transactions_data:
                shop_name_raw = item.get('shopName')
                if not shop_name_raw or not item.get('date'):
                    continue
                
                shop_name = shop_name_raw.strip()
                store = store_name_map.get(shop_name)
                
                if not store:
                    logging.info(f"Shop '{shop_name}' not found in DB. Creating a new provisional store.")
                    new_store_key = f"{shop_name}-provisional_sales"
                    
                    existing_provisional = db.query(Store).filter(Store.store_key == new_store_key).first()
                    if existing_provisional:
                        store = existing_provisional
                    else:
                        store = Store(store_key=new_store_key)
                        db.add(store)
                        db.flush()
                    
                    store_name_map[shop_name] = store

                new_transactions.append(Transaction(
                    store_key=store.store_key,
                    transaction_time=parse_date(item.get('date')),
                    amount=int(float(item.get('amount', 0))),
                    product_name=item.get('product'),
                    payment_type=item.get('payType')
                ))

            if new_transactions:
                db.bulk_save_objects(new_transactions)
                logging.info(f"Preparing to save {len(new_transactions)} new transactions.")
            
            db.commit()
            logging.info("Successfully committed transactions.")
            db.close()
            return jsonify({"success": True, "message": f"Successfully added {len(new_transactions)} transactions."})

        except OperationalError as e:
            db.rollback()
            db.close()
            logging.error(f"DB Error on attempt {attempt + 1}: {e}")
            if attempt + 1 >= max_retries:
                logging.error("Max retries reached. Aborting.")
                return jsonify({"success": False, "message": f"Database error after {max_retries} attempts: {e}"}), 500
            logging.info(f"Retrying in {retry_delay_seconds} seconds...")
            time.sleep(retry_delay_seconds)
        except Exception as e:
            db.rollback()
            db.close()
            logging.error(f"Error adding transactions: {e}")
            traceback.print_exc()
            return jsonify({"success": False, "message": str(e)}), 500
        finally:
            if 'db' in locals() and db.is_active:
                db.close()


@app.route('/api/transactions', methods=['GET'])
def get_transactions():
    """
    Returns all transactions in the format expected by presentation.html.
    """
    db: Session = next(get_db())
    try:
        transactions = db.query(Transaction).all()
        
        # Create a map of store_key to store_name for quick lookup
        # The store name is the part of the key before the last hyphen
        stores = {s.store_key: s.store_key.rsplit('-', 1)[0] for s in db.query(Store).all()}

        result = [
            {
                "shopName": stores.get(t.store_key, t.store_key), # Fallback to store_key if not in map
                "date": t.transaction_time.isoformat(),
                "amount": t.amount,
                "product": t.product_name,
                "payType": t.payment_type,
            }
            for t in transactions
        ]
        return jsonify(result)
    except Exception as e:
        logging.error(f"Error getting transactions: {e}")
        traceback.print_exc()
        return jsonify({"success": False, "message": str(e)}), 500
    finally:
        db.close()


@app.route('/api/inventory/<store_key>', methods=['DELETE'])
def delete_inventory_data(store_key):
    """
    Deletes all inventory and custom data associated with a specific store_key.
    """
    if not store_key:
        return jsonify({"success": False, "message": "store_key is required"}), 400

    db: Session = next(get_db())
    try:
        store_name, machine_id = store_key.split('-', 1)

        db.query(Inventory).filter_by(store=store_name, machine_id=machine_id).delete(synchronize_session=False)
        db.query(Store).filter_by(store_key=store_key).delete(synchronize_session=False)
        db.query(Transaction).filter_by(store_key=store_key).delete(synchronize_session=False)

        db.commit()

        return jsonify({"success": True, "message": "Data deleted successfully."})

    except Exception as e:
        db.rollback()
        return jsonify({"success": False, "message": str(e)}), 500
    finally:
        db.close()


# --- Password Protected Routes ---
@app.route('/login', methods=['GET', 'POST'])
def login():
    """Handles the login process."""
    if request.method == 'POST':
        password = request.form.get('password')
        # Load the access password from environment variables
        access_password = os.getenv("ACCESS_PASSWORD")
        
        if not access_password:
             flash("錯誤：應用程式未設定訪問密碼。")
             return render_template('login.html'), 500

        if password == access_password:
            session['logged_in'] = True
            return redirect('/')
        else:
            flash('密碼錯誤，請重試。')
            return redirect('/login')
            
    return render_template('login.html')

@app.route('/logout')
def logout():
    """Logs the user out."""
    session.pop('logged_in', None)
    return redirect('/login')


# --- Static File Serving ---
@app.route('/')
def serve_index():
    if not session.get('logged_in'):
        return redirect('/login')
    return send_from_directory(script_dir, 'index.html')

@app.route('/presentation')
def serve_presentation():
    return send_from_directory(script_dir, 'presentation.html')

@app.route('/<path:path>')
def serve_static_files(path):
    # This will serve other files like script.js
    if path != 'presentation.html':
    return send_from_directory(script_dir, path)
    # Redirect to the clean URL if someone tries to access the .html version directly
    return redirect('/presentation')


# --- Scheduler Setup ---
def run_scheduler():
    """
    Sets up and runs the scheduler in a loop.
    """
    # Schedule the inventory scraper to run at 1 minute past the hour.
    schedule.every().hour.at(":01").do(run_inventory_scraper_background)
    logging.info("Scheduler started for inventory: will run every hour at 1 minute past.")

    # Schedule the sales scraper to run daily at 23:55 Taiwan Time (UTC+8), which is 15:55 UTC.
    schedule.every().day.at("15:55").do(run_sales_scraper_background)
    logging.info("Scheduler started for sales: will run daily at 15:55 UTC (23:55 Taiwan Time).")
    
    while True:
        schedule.run_pending()
        time.sleep(1)

# --- Endpoints for Manual Testing ---
@app.route('/test-run-inventory-scraper', methods=['GET'])
def test_run_inventory_scraper():
    """A simple endpoint to manually trigger the inventory scraper for testing."""
    logging.info("Manual trigger for inventory scraper received.")
    thread = threading.Thread(target=run_inventory_scraper_background)
    thread.start()
    return "Inventory scraper job manually triggered for testing."

@app.route('/test-run-sales-scraper', methods=['GET'])
def test_run_sales_scraper():
    """A simple endpoint to manually trigger the sales scraper for testing."""
    logging.info("Manual trigger for sales scraper received.")
    thread = threading.Thread(target=run_sales_scraper_background)
    thread.start()
    return "Sales scraper job manually triggered for testing."


# --- Main Execution ---
if __name__ == '__main__':
    # This block is for local development testing only.
    # When deployed on Render with Gunicorn, this block will not be executed.
    # The scheduler thread is started below in the global scope.
    logging.info("Starting Flask development server for local testing...")
    app.run(host='0.0.0.0', port=5001, debug=False)

# --- Start the scheduler thread when the application module is loaded ---
# This ensures it runs even when started by Gunicorn on Render.
logging.info("Starting the background scheduler thread...")
    scheduler_thread = threading.Thread(target=run_scheduler, daemon=True)
    scheduler_thread.start()
logging.info("Background scheduler thread has been started.") 