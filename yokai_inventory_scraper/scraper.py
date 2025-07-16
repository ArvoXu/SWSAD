import time
import os
import sys
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from datetime import datetime
import re
import json
import sqlite3
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.chrome.options import Options

# --- Configurable Variables ---
URL = "https://manager.yokaiexpress.com/#/standStoreManager"
# Load credentials from environment variables for production, with fallbacks for local development
USERNAME = os.getenv("YOKAI_USERNAME", "overthere")
PASSWORD = os.getenv("YOKAI_PASSWORD", "88888888")


def get_credentials():
    """從環境變數中獲取帳號密碼"""
    username = os.getenv('YOKAI_USERNAME')
    password = os.getenv('YOKAI_PASSWORD')
    if not username or not password:
        raise ValueError("錯誤：環境變數 YOKAI_USERNAME 或 YOKAI_PASSWORD 未設定。")
    return username, password


def scrape_all_inventory_text():
    """
    Launches Selenium, logs into the website, scrapes all inventory data from all pages,
    and returns it as a single raw text string.
    Runs in headless mode for server deployment.
    """
    print("Initializing browser in headless mode...")
    
    # --- Chrome Options for Headless Execution on a Server ---
    options = webdriver.ChromeOptions()
    options.add_argument("--headless")
    options.add_argument("--no-sandbox") # A standard requirement for running as root/in a container
    options.add_argument("--disable-dev-shm-usage") # Overcomes limited resource problems
    options.add_argument("--disable-gpu") # Applicable to windows os only
    options.add_argument("window-size=1920,1080") # Set a window size to avoid issues with responsive layouts

    driver = webdriver.Chrome(options=options)
    all_scraped_text = ""

    try:
        driver.get(URL)
        wait = WebDriverWait(driver, 10)

        # --- Login ---
        print("Logging in...")
        username, password = get_credentials()
        print(f"找到輸入框，正在輸入帳號: {username[:4]}****") # 出於安全，只顯示部分帳號
        username_field = wait.until(EC.presence_of_element_located((By.XPATH, "//input[@placeholder='User name']")))
        username_field.send_keys(username)
        password_field = wait.until(EC.presence_of_element_located((By.XPATH, "//input[@placeholder='Password']")))
        password_field.send_keys(password)
        login_button = wait.until(EC.element_to_be_clickable((By.XPATH, "//button[contains(., 'Login') or contains(., 'Sign in')]")))
        login_button.click()
        print("Login successful.")

        # --- Navigate to Inventory ---
        print("Navigating to Store Management...")
        store_management_link = wait.until(EC.element_to_be_clickable((By.XPATH, "//li[.//span[contains(text(), 'Store management')]]")))
        store_management_link.click()

        # --- Full Inventory Scraping Logic with Pagination ---
        page_number = 1
        total_stores_processed = 0

        while True:
            print(f"--- Preparing to process Page {page_number} ---")
            rows_xpath = "//div[contains(@class, 'el-table__body-wrapper')]//tr"
            wait.until(EC.presence_of_all_elements_located((By.XPATH, rows_xpath)))

            num_rows_on_page = len(driver.find_elements(By.XPATH, rows_xpath))
            if num_rows_on_page == 0:
                print("No stores found on the page, assuming end of scraping.")
                break
            print(f"Found {num_rows_on_page} stores on page {page_number}.")

            for i in range(num_rows_on_page):
                total_stores_processed += 1
                print(f"Processing store #{total_stores_processed} (Page {page_number}, Row {i+1})...")
                
                inquiry_buttons = wait.until(EC.presence_of_all_elements_located((By.XPATH, "//button[.//span[contains(text(), 'Inventory inquiry')]]")))
                if i < len(inquiry_buttons):
                    driver.execute_script("arguments[0].click();", inquiry_buttons[i])
                else:
                    print(f"  > Error: Could not find button for row {i+1}. Skipping.")
                    continue

                inventory_container = wait.until(EC.visibility_of_element_located((By.XPATH, "//div[@data-v-d0a9a5c0 and @class='container']")))
                inventory_text = inventory_container.text
                print("  > Scraped inventory data.")

                # Accumulate text instead of writing to file
                all_scraped_text += f"--- Store #{total_stores_processed} ---\n{inventory_text}\n{'-'*20}\n\n"

                close_button = wait.until(EC.element_to_be_clickable((By.XPATH, "//li[contains(@class, 'tags-li') and contains(@class, 'active')]//i[contains(@class, 'el-icon-close')]")))
                close_button.click()
                print("  > Closed inventory tab.")
                wait.until(EC.presence_of_element_located((By.XPATH, rows_xpath)))

                if page_number > 1:
                    print(f"  > Navigating back to page {page_number}...")
                    target_page_button_xpath = f"//ul[contains(@class, 'el-pager')]//li[text()='{page_number}']"
                    target_page_button = wait.until(EC.element_to_be_clickable((By.XPATH, target_page_button_xpath)))
                    target_page_button.click()
                    time.sleep(0.5)
                    print(f"  > Returned to page {page_number}.")

            # --- Go to next page ---
            try:
                next_page_to_click = page_number + 1
                print(f"\nFinished page {page_number}. Attempting to move to page {next_page_to_click}...")
                next_page_button_xpath = f"//ul[contains(@class, 'el-pager')]//li[text()='{next_page_to_click}']"
                next_page_button = wait.until(EC.element_to_be_clickable((By.XPATH, next_page_button_xpath)))
                next_page_button.click()
                time.sleep(2)
                page_number += 1
            except Exception:
                print(f"\nCould not find button for page {next_page_to_click}. Assuming it's the last page.")
                break
        
        print(f"\nScraping complete. Processed {total_stores_processed} stores in total.")
        
        # Replace text in the accumulated string before returning
        print("\nReplacing 'Last replenishment time' with '上次補貨時間' in memory...")
        all_scraped_text = all_scraped_text.replace("Last replenishment time", "上次補貨時間")
        print("Replacement complete.")
        
        return all_scraped_text

    except Exception as e:
        print(f"An error occurred during scraping: {e}")
        return "" # Return empty string on error
    finally:
        print("Closing the browser.")
        driver.quit()


def parse_inventory_from_text(raw_text):
    """
    Parses the raw inventory text string, which is grouped by store,
    into a structured list of dictionaries.
    """
    print("\nStarting to parse data in Python...")
    final_result = []
    
    # Split the entire text into blocks for each store
    store_blocks = raw_text.split('--- Store #')[1:]
    
    if not store_blocks:
        print("Warning: Could not find any store blocks in the raw text.")
        return []

    for block in store_blocks:
        lines = [line.strip() for line in block.split('\n') if line.strip()]
        
        if "No Data" in lines:
            continue

        # Extract time information for the current block
        last_updated = "N/A"
        replenish_match = re.search(r'上次補貨時間\s*:\s*(.+)', block)
        if replenish_match:
            last_updated = replenish_match.group(1).strip()
            
        # The actual data starts after the header 'Store name Machine name Product name Inventory quantity'
        try:
            data_start_index = lines.index('Store name Machine name Product name Inventory quantity') + 1
        except ValueError:
            # If header is not found, start from the first line that looks like data
            data_start_index = 1 

        # The lines we need to process are from data_start_index to before the '---...---' separator
        data_lines = []
        for line in lines[data_start_index:]:
            if line.startswith('Total') or line.startswith('--------------------'):
                break
            data_lines.append(line)

        # Process data in chunks of 4 lines
        if len(data_lines) % 4 != 0:
            print(f"Warning: Data lines count ({len(data_lines)}) is not a multiple of 4 for a store block. Skipping block.")
            continue
            
        for i in range(0, len(data_lines), 4):
            store_name = data_lines[i]
            machine_id = data_lines[i+1]
            product_name = data_lines[i+2]
            quantity_str = data_lines[i+3]
            
            if not quantity_str.isdigit():
                print(f"Warning: Expected a number for quantity but got '{quantity_str}'. Skipping entry.")
                continue

            final_result.append({
                'store': store_name,
                'machine_id': machine_id,
                'product_name': product_name,
                'quantity': int(quantity_str),
                'last_updated': last_updated,
                'process_time': datetime.now().isoformat() # Use ISO format for consistency
            })

    if not final_result:
        print("Warning: Failed to parse any product items from the raw data.")
        return []

    print(f"Parsing complete. Found {len(final_result)} product items.")
    return final_result


def setup_database(db_path):
    """
    Sets up the database connection and creates the inventory table if it doesn't exist.
    """
    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        # The schema is designed based on the parsed data structure.
        # A composite PRIMARY KEY ensures each product in each machine is unique.
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


def save_to_database(db_path, data):
    """
    Saves the structured data to the SQLite database, completely replacing old data.
    """
    if not data:
        print("No data to save to database.")
        return

    conn = None
    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()

        # Use a transaction to ensure atomicity (all or nothing)
        cursor.execute("BEGIN TRANSACTION")

        # Clear the table to ensure a fresh snapshot of the inventory
        cursor.execute("DELETE FROM inventory")

        # Prepare data for insertion
        to_insert = [
            (
                item['store'],
                item['machine_id'],
                item['product_name'],
                item['quantity'],
                item['last_updated'],
                item['process_time']
            ) for item in data
        ]

        # Use executemany for efficient bulk insertion
        cursor.executemany('''
            INSERT INTO inventory (store, machine_id, product_name, quantity, last_updated, process_time)
            VALUES (?, ?, ?, ?, ?, ?)
        ''', to_insert)

        # Commit the transaction to make the changes permanent
        conn.commit()
        print(f"Successfully saved {len(to_insert)} records to the database.")

    except sqlite3.Error as e:
        print(f"Database error during save: {e}")
        if conn:
            conn.rollback() # Roll back changes on error
    finally:
        if conn:
            conn.close()


def save_to_json(data, filename):
    """Saves the structured data to a JSON file."""
    if not data:
        print("No data to save.")
        return
        
    try:
        with open(filename, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=4, ensure_ascii=False)
        print(f"\nStructured data successfully saved to {filename}")
    except Exception as e:
        print(f"Error saving data to {filename}: {e}")


def run_scraper(headless=True):
    """
    啟動爬蟲的主函數。
    :param headless: 是否以無頭模式運行瀏覽器。
    """
    print("正在啟動爬蟲...")
    
    try:
        username, password = get_credentials()
    except ValueError as e:
        print(e, file=sys.stderr)
        sys.exit(1) # 終止腳本

    # --- Modern Selenium Setup ---
    options = Options()
    if headless:
        # These are the crucial arguments for running Chrome in a containerized environment
        options.add_argument("--headless")
        options.add_argument("--no-sandbox")
        options.add_argument("--disable-dev-shm-usage")
        options.add_argument("--disable-gpu")
        options.add_argument("window-size=1920,1080")

    # Selenium's built-in manager will handle the chromedriver
    service = Service() 
    driver = webdriver.Chrome(service=service, options=options)
    
    all_scraped_text = ""

    try:
        driver.get(URL)
        # Increase the wait time from 10 to 30 seconds to handle slower server response times
        wait = WebDriverWait(driver, 20)

        # --- Login ---
        print("Logging in...")
        print(f"找到輸入框，正在輸入帳號: {username[:4]}****") # 出於安全，只顯示部分帳號
        username_field = wait.until(EC.presence_of_element_located((By.XPATH, "//input[@placeholder='User name']")))
        username_field.send_keys(username)
        password_field = wait.until(EC.presence_of_element_located((By.XPATH, "//input[@placeholder='Password']")))
        password_field.send_keys(password)
        login_button = wait.until(EC.element_to_be_clickable((By.XPATH, "//button[contains(., 'Login') or contains(., 'Sign in')]")))
        login_button.click()
        print("Login successful.")

        # --- Navigate to Inventory ---
        print("Navigating to Store Management...")
        store_management_link = wait.until(EC.element_to_be_clickable((By.XPATH, "//li[.//span[contains(text(), 'Store management')]]")))
        store_management_link.click()

        # --- Full Inventory Scraping Logic with Pagination ---
        page_number = 1
        total_stores_processed = 0

        while True:
            print(f"--- Preparing to process Page {page_number} ---")
            rows_xpath = "//div[contains(@class, 'el-table__body-wrapper')]//tr"
            wait.until(EC.presence_of_all_elements_located((By.XPATH, rows_xpath)))

            num_rows_on_page = len(driver.find_elements(By.XPATH, rows_xpath))
            if num_rows_on_page == 0:
                print("No stores found on the page, assuming end of scraping.")
                break
            print(f"Found {num_rows_on_page} stores on page {page_number}.")

            for i in range(num_rows_on_page):
                total_stores_processed += 1
                print(f"Processing store #{total_stores_processed} (Page {page_number}, Row {i+1})...")
                
                inquiry_buttons = wait.until(EC.presence_of_all_elements_located((By.XPATH, "//button[.//span[contains(text(), 'Inventory inquiry')]]")))
                if i < len(inquiry_buttons):
                    driver.execute_script("arguments[0].click();", inquiry_buttons[i])
                else:
                    print(f"  > Error: Could not find button for row {i+1}. Skipping.")
                    continue

                inventory_container = wait.until(EC.visibility_of_element_located((By.XPATH, "//div[@data-v-d0a9a5c0 and @class='container']")))
                inventory_text = inventory_container.text
                print("  > Scraped inventory data.")

                # Accumulate text instead of writing to file
                all_scraped_text += f"--- Store #{total_stores_processed} ---\n{inventory_text}\n{'-'*20}\n\n"

                close_button = wait.until(EC.element_to_be_clickable((By.XPATH, "//li[contains(@class, 'tags-li') and contains(@class, 'active')]//i[contains(@class, 'el-icon-close')]")))
                close_button.click()
                print("  > Closed inventory tab.")
                wait.until(EC.presence_of_element_located((By.XPATH, rows_xpath)))

                if page_number > 1:
                    print(f"  > Navigating back to page {page_number}...")
                    target_page_button_xpath = f"//ul[contains(@class, 'el-pager')]//li[text()='{page_number}']"
                    target_page_button = wait.until(EC.element_to_be_clickable((By.XPATH, target_page_button_xpath)))
                    target_page_button.click()
                    time.sleep(0.5)
                    print(f"  > Returned to page {page_number}.")

            # --- Go to next page ---
            try:
                next_page_to_click = page_number + 1
                print(f"\nFinished page {page_number}. Attempting to move to page {next_page_to_click}...")
                next_page_button_xpath = f"//ul[contains(@class, 'el-pager')]//li[text()='{next_page_to_click}']"
                next_page_button = wait.until(EC.element_to_be_clickable((By.XPATH, next_page_button_xpath)))
                next_page_button.click()
                time.sleep(2)
                page_number += 1
            except Exception:
                print(f"\nCould not find button for page {next_page_to_click}. Assuming it's the last page.")
                break
        
        print(f"\nScraping complete. Processed {total_stores_processed} stores in total.")
        
        # Replace text in the accumulated string before returning
        print("\nReplacing 'Last replenishment time' with '上次補貨時間' in memory...")
        all_scraped_text = all_scraped_text.replace("Last replenishment time", "上次補貨時間")
        print("Replacement complete.")
        
        return all_scraped_text

    except Exception as e:
        print(f"An error occurred during scraping: {e}")
        return "" # Return empty string on error
    finally:
        print("Closing the browser.")
        driver.quit()


if __name__ == "__main__":
    try:
        # 這裡的代碼只在直接運行 scraper.py 時執行，方便本地測試
        # 在伺服器環境中，server.py 會導入 run_scraper 函數並調用它
        
        # 為了本地測試，我們需要手動加載 .env 文件
        try:
            from dotenv import load_dotenv
            # 我們假設 .env 文件與 scraper.py 在同一個目錄
            dotenv_path = os.path.join(os.path.dirname(__file__), '.env')
            if os.path.exists(dotenv_path):
                print(f"正在從 {dotenv_path} 加載環境變數...")
                load_dotenv(dotenv_path=dotenv_path)
            else:
                print(".env 文件未找到，將依賴於系統已設置的環境變數。")

        except ImportError:
            print("警告: python-dotenv 未安裝。本地測試時請確保手動設置環境變數。")

        # 1. Execute the web scraper to get raw text
        # We set headless=True for any automated run, local test or server.
        raw_inventory_text = run_scraper(headless=True)
        
        if raw_inventory_text:
            # 2. Parse the raw text into structured data
            structured_data = parse_inventory_from_text(raw_inventory_text)
            
            # --- Define output paths ---
            script_dir = os.path.dirname(os.path.abspath(__file__))
            output_json_path = os.path.join(script_dir, 'structured_inventory.json')
            db_path = os.path.join(script_dir, 'inventory.db')

            # 3. Save to JSON for verification
            save_to_json(structured_data, output_json_path)
            
            # 4. Setup and save to SQLite database
            setup_database(db_path)
            save_to_database(db_path, structured_data)
            
    except Exception as e:
        print(f"An error occurred in the main execution block: {e}")
