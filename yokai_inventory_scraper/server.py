import sys
import os
from datetime import datetime, timedelta
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
import json
import pytz


# --- Custom Imports ---
from database import init_db, get_db, Inventory, Store, Transaction, UpdateLog, Warehouse
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
        # We explicitly set headless=True to ensure it runs without a GUI on the server.
        downloaded_file_path = run_sales_scraper(headless=True)
        
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

@app.route('/upload-inventory-file', methods=['POST'])
def upload_inventory_file():
    """
    接收格式化好的庫存數據文件（JSON格式）並直接保存到數據庫
    避免在伺服器上運行爬蟲腳本，減少CPU負載
    """
    try:
        # 檢查是否有文件上傳
        if 'file' not in request.files:
            return jsonify({'success': False, 'message': '沒有選擇文件'}), 400
        
        file = request.files['file']
        if file.filename == '':
            return jsonify({'success': False, 'message': '沒有選擇文件'}), 400
        
        # 檢查文件類型
        if not file.filename.endswith('.json'):
            return jsonify({'success': False, 'message': '只支持 JSON 格式的文件'}), 400
        
        # 讀取文件內容
        file_content = file.read()
        try:
            inventory_data = json.loads(file_content.decode('utf-8'))
        except json.JSONDecodeError as e:
            return jsonify({'success': False, 'message': f'JSON 格式錯誤: {str(e)}'}), 400
        
        # 驗證數據格式
        if not isinstance(inventory_data, list):
            return jsonify({'success': False, 'message': '數據格式錯誤：應該是列表格式'}), 400
        
        # 驗證每個項目是否包含必要字段
        required_fields = ['store', 'machine_id', 'product_name', 'quantity']
        for i, item in enumerate(inventory_data):
            if not isinstance(item, dict):
                return jsonify({'success': False, 'message': f'第 {i+1} 項數據格式錯誤：應該是字典格式'}), 400
            
            missing_fields = [field for field in required_fields if field not in item]
            if missing_fields:
                return jsonify({'success': False, 'message': f'第 {i+1} 項缺少必要字段: {", ".join(missing_fields)}'}), 400
            
            # 驗證數量字段
            if not isinstance(item['quantity'], int) or item['quantity'] < 0:
                return jsonify({'success': False, 'message': f'第 {i+1} 項數量字段錯誤：應該是正整數'}), 400
        
        # 處理日期時間字段
        for item in inventory_data:
            if 'process_time' in item:
                if isinstance(item['process_time'], str):
                    try:
                        item['process_time'] = parse_date(item['process_time'])
                    except Exception as e:
                        return jsonify({'success': False, 'message': f'日期時間格式錯誤: {str(e)}'}), 400
            else:
                # 如果沒有 process_time，使用當前時間
                item['process_time'] = datetime.now(pytz.timezone('Asia/Taipei'))
        
        # 保存到數據庫
        max_retries = 3
        retry_delay_seconds = 5
        
        for attempt in range(max_retries):
            db: Session = next(get_db())
            try:
                # 清空現有庫存數據
                num_deleted = db.query(Inventory).delete()
                logging.info(f"Cleared {num_deleted} old records from the inventory table.")
                
                # 創建新的庫存對象
                inventory_objects = [Inventory(**item) for item in inventory_data]
                db.bulk_save_objects(inventory_objects)
                
                db.commit()
                items_saved_count = len(inventory_objects)
                logging.info(f"Successfully saved {items_saved_count} new records to the database via file upload.")
                
                # 記錄更新日誌
                log_db_update(
                    scraper_type='inventory_upload', 
                    status='success', 
                    details=f'File upload successful. Processed {items_saved_count} items from {file.filename}'
                )
                
                db.close()
                return jsonify({
                    'success': True, 
                    'message': f'成功上傳並處理 {items_saved_count} 項庫存數據',
                    'items_processed': items_saved_count,
                    'filename': file.filename
                })
                
            except OperationalError as e:
                db.rollback()
                db.close()
                logging.error(f"Database error on attempt {attempt + 1}/{max_retries}: {e}")
                if attempt + 1 >= max_retries:
                    log_db_update(
                        scraper_type='inventory_upload', 
                        status='error', 
                        details=f'Database error after {max_retries} attempts: {str(e)}'
                    )
                    return jsonify({'success': False, 'message': f'數據庫錯誤，已重試 {max_retries} 次: {str(e)}'}), 500
                logging.info(f"Retrying in {retry_delay_seconds} seconds...")
                time.sleep(retry_delay_seconds)
                
            except Exception as e:
                db.rollback()
                db.close()
                logging.error(f"Unexpected error during file upload: {e}", exc_info=True)
                log_db_update(
                    scraper_type='inventory_upload', 
                    status='error', 
                    details=f'Unexpected error: {str(e)}'
                )
                return jsonify({'success': False, 'message': f'處理文件時發生錯誤: {str(e)}'}), 500
            finally:
                if 'db' in locals() and db.is_active:
                    db.close()
                    
    except Exception as e:
        logging.error(f"Error in file upload endpoint: {e}", exc_info=True)
        return jsonify({'success': False, 'message': f'文件上傳失敗: {str(e)}'}), 500

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


@app.route('/upload-warehouse-file', methods=['POST'])
def upload_warehouse_file():
    """
    接收倉庫庫存 Excel 文件並保存到數據庫
    文件格式：Warehouse name, Product name, Remain quantity, Time
    """
    try:
        if 'file' not in request.files:
            return jsonify({'success': False, 'message': '沒有選擇文件'}), 400
        
        file = request.files['file']
        if file.filename == '':
            return jsonify({'success': False, 'message': '沒有選擇文件'}), 400
        
        # 檢查文件類型
        if not file.filename.endswith(('.xlsx', '.xls')):
            return jsonify({'success': False, 'message': '只支持 Excel 格式的文件 (.xlsx, .xls)'}), 400
        
        # 讀取 Excel 文件
        df = pd.read_excel(file)
        required_columns = ['Warehouse name', 'Product name', 'Remain quantity']
        
        # 驗證必要欄位
        missing_columns = [col for col in required_columns if col not in df.columns]
        if missing_columns:
            return jsonify({
                'success': False, 
                'message': f'缺少必要欄位: {", ".join(missing_columns)}'
            }), 400
        
        # 資料處理和驗證
        df['Remain quantity'] = pd.to_numeric(df['Remain quantity'], errors='coerce')
        df = df.dropna(subset=['Warehouse name', 'Product name', 'Remain quantity'])
        
        # 更新資料庫
        max_retries = 3
        retry_delay_seconds = 5
        
        for attempt in range(max_retries):
            db: Session = next(get_db())
            try:
                # 清除現有倉庫數據
                db.query(Warehouse).delete()
                
                # 創建新的倉庫記錄
                warehouse_records = []
                for _, row in df.iterrows():
                    warehouse_records.append(Warehouse(
                        warehouse_name=str(row['Warehouse name']),
                        product_name=str(row['Product name']),
                        quantity=int(row['Remain quantity']),
                        updated_at=datetime.now(pytz.timezone('Asia/Taipei'))
                    ))
                
                db.bulk_save_objects(warehouse_records)
                db.commit()
                
                return jsonify({
                    'success': True,
                    'message': f'成功上傳並處理 {len(warehouse_records)} 筆倉庫數據',
                    'records_count': len(warehouse_records)
                })
                
            except OperationalError as e:
                db.rollback()
                logging.error(f"Database error on attempt {attempt + 1}/{max_retries}: {e}")
                if attempt + 1 >= max_retries:
                    return jsonify({'success': False, 'message': f'數據庫錯誤: {str(e)}'}), 500
                time.sleep(retry_delay_seconds)
            except Exception as e:
                db.rollback()
                logging.error(f"Error processing warehouse file: {e}", exc_info=True)
                return jsonify({'success': False, 'message': f'處理文件時發生錯誤: {str(e)}'}), 500
            finally:
                db.close()
                
    except Exception as e:
        logging.error(f"Error in warehouse file upload: {e}", exc_info=True)
        return jsonify({'success': False, 'message': f'文件上傳失敗: {str(e)}'}), 500

@app.route('/api/warehouses', methods=['GET'])
def get_warehouses():
    """
    獲取所有倉庫數據
    """
    db: Session = next(get_db())
    try:
        warehouses = db.query(Warehouse).all()
        result = [{
            'warehouseName': w.warehouse_name,
            'productName': w.product_name,
            'quantity': w.quantity,
            'updatedAt': w.updated_at.isoformat() if w.updated_at else None
        } for w in warehouses]
        return jsonify(result)
    except Exception as e:
        logging.error(f"Error getting warehouses: {e}", exc_info=True)
        return jsonify({"error": "Could not retrieve warehouse data"}), 500
    finally:
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


def distribute_remainder(items, total_slots):
    """
    一個輔助函數，用於處理補貨建議數量計算中的小數問題。
    它會確保所有產品的建議數量加總後剛好等於機台的目標總容量。
    """
    # 根據小數部分由大到小排序，小數越大的越優先獲得 +1
    items.sort(key=lambda x: x['suggestedQty_float'] - int(x['suggestedQty_float']), reverse=True)
    
    # 計算所有品項無條件捨去後的總和
    current_total = sum(int(item['suggestedQty_float']) for item in items)
    remainder = total_slots - current_total
    
    result = []
    for i, item in enumerate(items):
        qty = int(item['suggestedQty_float'])
        # 將餘下的數量逐一分配給排序最前面的品項
        if i < remainder:
            qty += 1
        result.append({'productName': item['productName'], 'suggestedQty': qty, 'sales_count': item.get('sales_count', 0)})
    
    return result

@app.route('/api/replenishment-suggestion/<string:store_key>', methods=['POST'])
def get_replenishment_suggestion(store_key):
    """
    生成補貨建議的核心API。
    接收策略和預留空位，回傳一份詳細的補貨清單。
    """
    data = request.get_json()
    if not data:
        return jsonify({"success": False, "message": "No data provided"}), 400

    strategy = data.get("strategy", "stable")
    reserve_slots = int(data.get("reserve_slots", 0))
    only_add = bool(data.get("only_add", False))
    machine_capacity = int(data.get("max_total_qty", 50))
    if machine_capacity < 1 or machine_capacity > 50:
        machine_capacity = 50
    
    available_slots = machine_capacity - reserve_slots

    db: Session = next(get_db())
    try:
        store_name, machine_id = store_key.split('-', 1)
        
        # 1. 獲取目前庫存
        inventory_items = db.query(Inventory).filter_by(store=store_name, machine_id=machine_id).all()
        current_inventory = {item.product_name: item.quantity for item in inventory_items}

        # 2. 獲取過去30天的銷售數據 (此處假設同店鋪名的所有機台共享銷售數據)
        thirty_days_ago = datetime.now() - timedelta(days=30)
        transactions = db.query(Transaction).filter(
            Transaction.store_key.startswith(store_name),
            Transaction.transaction_time >= thirty_days_ago
        ).all()

        sales_counts = {}
        for t in transactions:
            if t.product_name:
                sales_counts[t.product_name] = sales_counts.get(t.product_name, 0) + 1
        
        total_sales_volume = sum(sales_counts.values())

        if total_sales_volume == 0:
            return jsonify({
                "success": True,
                "strategy_used": "no_sales_data",
                "suggestion": [],
                "message": "過去30天沒有銷售紀錄，無法生成建議。"
            })

        # 3. 應用不同策略
        suggestion_list = []
        sorted_sales = sorted(sales_counts.items(), key=lambda item: item[1], reverse=True)

        if strategy == 'stable':
            temp_suggestions = [{'productName': p, 'suggestedQty_float': (c / total_sales_volume) * available_slots, 'sales_count': c} for p, c in sales_counts.items()]
            suggestion_list = distribute_remainder(temp_suggestions, available_slots)
        
        elif strategy == 'aggressive':
            top_3_products = sorted_sales[:3]
            other_products = sorted_sales[3:]
            
            top_3_sales_volume = sum(c for _, c in top_3_products)
            other_sales_volume = sum(c for _, c in other_products)

            slots_for_top_3 = round(available_slots * 0.8)
            slots_for_others = available_slots - slots_for_top_3
            
            temp_suggestions = []
            if top_3_sales_volume > 0:
                temp_suggestions.extend([{'productName': p, 'suggestedQty_float': (c / top_3_sales_volume) * slots_for_top_3, 'sales_count': c} for p, c in top_3_products])
            if other_sales_volume > 0 and len(other_products) > 0:
                temp_suggestions.extend([{'productName': p, 'suggestedQty_float': (c / other_sales_volume) * slots_for_others, 'sales_count': c} for p, c in other_products])
            
            suggestion_list = distribute_remainder(temp_suggestions, available_slots)

        elif strategy == 'exploratory':
            slots_for_existing = round(available_slots * 0.8)
            # 只考慮有銷量的產品進行分配
            temp_suggestions = [{'productName': p, 'suggestedQty_float': (c / total_sales_volume) * slots_for_existing, 'sales_count': c} for p, c in sales_counts.items()]
            suggestion_list = distribute_remainder(temp_suggestions, slots_for_existing)

        # 4. 組合最終結果
        final_suggestion = []
        suggestion_map = {item['productName']: item['suggestedQty'] for item in suggestion_list}
        all_product_names = set(current_inventory.keys()) | set(suggestion_map.keys())

        # 正確邏輯：最大補貨總數量是補貨後的目標庫存量
        warning = None
        total_current = sum(current_inventory.get(name, 0) for name in all_product_names)
        if total_current >= machine_capacity:
            warning = f"現有庫存總和({total_current})已達最大補貨總數量({machine_capacity})，無需補貨。"
            for name in all_product_names:
                final_suggestion.append({
                    'productName': name,
                    'currentQty': current_inventory.get(name, 0),
                    'suggestedQty': current_inventory.get(name, 0),
                    'salesCount30d': sales_counts.get(name, 0)
                })
            final_suggestion.sort(key=lambda x: x['suggestedQty'], reverse=True)
            return jsonify({
                "success": True,
                "store_key": store_key,
                "strategy_used": strategy,
                "suggestion": final_suggestion,
                "warning": warning
            })

        # 剩餘可補貨空間
        available_replenish = machine_capacity - total_current
        # 依策略分配這些空間
        # 重新計算分配：每個產品的補貨量 = 分配量，建議數量 = 現有庫存 + 分配量
        # 先依照策略分配比例
        # 取得有銷量的產品分配比例
        if strategy == 'stable':
            total_sales_volume = sum(sales_counts.values())
            temp_suggestions = []
            for p, c in sales_counts.items():
                temp_suggestions.append({'productName': p, 'suggestedQty_float': (c / total_sales_volume) * available_replenish, 'sales_count': c})
            distributed = distribute_remainder(temp_suggestions, available_replenish)
        elif strategy == 'aggressive':
            sorted_sales = sorted(sales_counts.items(), key=lambda item: item[1], reverse=True)
            top_3_products = sorted_sales[:3]
            other_products = sorted_sales[3:]
            top_3_sales_volume = sum(c for _, c in top_3_products)
            other_sales_volume = sum(c for _, c in other_products)
            slots_for_top_3 = round(available_replenish * 0.8)
            slots_for_others = available_replenish - slots_for_top_3
            temp_suggestions = []
            if top_3_sales_volume > 0:
                temp_suggestions.extend([{'productName': p, 'suggestedQty_float': (c / top_3_sales_volume) * slots_for_top_3, 'sales_count': c} for p, c in top_3_products])
            if other_sales_volume > 0 and len(other_products) > 0:
                temp_suggestions.extend([{'productName': p, 'suggestedQty_float': (c / other_sales_volume) * slots_for_others, 'sales_count': c} for p, c in other_products])
            distributed = distribute_remainder(temp_suggestions, available_replenish)
        elif strategy == 'exploratory':
            total_sales_volume = sum(sales_counts.values())
            slots_for_existing = round(available_replenish * 0.8)
            temp_suggestions = [{'productName': p, 'suggestedQty_float': (c / total_sales_volume) * slots_for_existing, 'sales_count': c} for p, c in sales_counts.items()]
            distributed = distribute_remainder(temp_suggestions, slots_for_existing)
        else:
            distributed = []

        # 將分配結果轉為 dict
        distributed_map = {item['productName']: item['suggestedQty'] for item in distributed}

        # 組合最終建議：建議數量 = 現有庫存 + 分配到的補貨量
        for name in all_product_names:
            current_qty = current_inventory.get(name, 0)
            add_qty = distributed_map.get(name, 0)
            suggested_qty = current_qty + add_qty
            # 只補貨模式下，不建議減少現有庫存
            if only_add and suggested_qty < current_qty:
                suggested_qty = current_qty
            final_suggestion.append({
                'productName': name,
                'currentQty': current_qty,
                'suggestedQty': suggested_qty,
                'salesCount30d': sales_counts.get(name, 0)
            })
        final_suggestion.sort(key=lambda x: x['suggestedQty'], reverse=True)

        # 最終檢查總和，理論上不會超過 machine_capacity
        total_final = sum(item['suggestedQty'] for item in final_suggestion)
        if total_final > machine_capacity:
            warning = f"分配後總庫存({total_final})超過最大補貨總數量({machine_capacity})，已自動調整至上限。"
            # 依現有庫存排序，依序減少至符合上限
            over = total_final - machine_capacity
            for item in sorted(final_suggestion, key=lambda x: x['suggestedQty'], reverse=True):
                if over <= 0:
                    break
                reducible = item['suggestedQty'] - item['currentQty']
                if reducible > 0:
                    reduce_by = min(reducible, over)
                    item['suggestedQty'] -= reduce_by
                    over -= reduce_by
            # 再次排序
            final_suggestion.sort(key=lambda x: x['suggestedQty'], reverse=True)

        return jsonify({
            "success": True,
            "store_key": store_key,
            "strategy_used": strategy,
            "suggestion": final_suggestion,
            "warning": warning
        })

    except Exception as e:
        db.rollback()
        logging.error(f"Error in replenishment suggestion for {store_key}: {e}", exc_info=True)
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