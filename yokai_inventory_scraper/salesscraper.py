import time
import os
import sys
import uuid
import logging
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from dotenv import load_dotenv

# --- Configurable Variables ---
URL = "https://manager.yokaiexpress.com/#/standStoreManager"

def get_credentials():
    """從環境變數中獲取帳號密碼，如果未設定則拋出錯誤。"""
    username = os.getenv('YOKAI_USERNAME')
    password = os.getenv('YOKAI_PASSWORD')
    if not username or not password:
        raise ValueError("錯誤：環境變數 YOKAI_USERNAME 或 YOKAI_PASSWORD 未設定。")
    return username, password

def run_sales_scraper():
    """
    Launches a headless browser, logs in, downloads the sales report,
    and returns the path to the downloaded Excel file.
    """
    download_dir = os.path.join(os.getcwd(), 'temp_downloads', str(uuid.uuid4()))
    os.makedirs(download_dir, exist_ok=True)
    logging.info(f"Created temporary download directory: {download_dir}")

    options = webdriver.ChromeOptions()
    options.add_argument("--headless")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--disable-gpu")
    options.add_argument("window-size=1920,1080")
    
    prefs = {
        "download.default_directory": download_dir,
        "download.prompt_for_download": False,
        "download.directory_upgrade": True,
        "plugins.always_open_pdf_externally": True
    }
    options.add_experimental_option("prefs", prefs)

    driver = webdriver.Chrome(options=options)
    
    try:
        username, password = get_credentials()
        driver.get(URL)
        wait = WebDriverWait(driver, 30)
        
        logging.info("Step 1: Logging in...")
        logging.info("Waiting for username field...")
        username_field = wait.until(EC.presence_of_element_located((By.XPATH, "//input[@placeholder='User name']")))
        logging.info("Username field found. Sending keys...")
        username_field.send_keys(username)
        
        logging.info("Waiting for password field...")
        password_field = wait.until(EC.presence_of_element_located((By.XPATH, "//input[@placeholder='Password']")))
        logging.info("Password field found. Sending keys...")
        password_field.send_keys(password)

        logging.info("Waiting for login button...")
        login_button = wait.until(EC.element_to_be_clickable((By.XPATH, "//button[contains(., 'Login') or contains(., 'Sign in')]")))
        logging.info("Login button found. Clicking...")
        login_button.click()
        logging.info("Login successful.")

        logging.info("Step 2: Navigating to Order Management...")
        logging.info("Waiting for 'Order management' submenu...")
        order_management_menu = wait.until(EC.element_to_be_clickable((By.XPATH, "//div[contains(@class, 'el-submenu__title')][.//span[normalize-space()='Order management']]")))
        logging.info("'Order management' submenu found. Clicking...")
        order_management_menu.click()

        logging.info("Waiting for 'Order management' menu item...")
        order_management_item = wait.until(EC.element_to_be_clickable((By.XPATH, "//li[contains(@class, 'el-menu-item') and normalize-space()='Order management']")))
        logging.info("'Order management' menu item found. Clicking...")
        order_management_item.click()
        logging.info("Navigation complete.")
        
        logging.info("Step 3: Setting date range...")
        logging.info("Waiting for start date input...")
        start_date_input = wait.until(EC.presence_of_element_located((By.XPATH, "//input[@placeholder='Select start date']")))
        logging.info("Start date input found. Clearing and setting date...")
        start_date_input.clear()
        start_date_input.send_keys("2025-01-01")

        logging.info("Waiting for end date input...")
        end_date_input = wait.until(EC.presence_of_element_located((By.XPATH, "//input[@placeholder='Select end date']")))
        logging.info("End date input found. Clearing and setting date...")
        end_date_input.clear()
        end_date_input.send_keys("2026-01-01")
        logging.info("Date range set.")
        
        # Adding a small delay for search button to become interactable if needed
        time.sleep(1)
        logging.info("Step 4: Searching for data...")
        logging.info("Waiting for search button...")
        search_button = wait.until(EC.element_to_be_clickable((By.XPATH, "//button[.//span[normalize-space()='Search']]")))
        logging.info("Search button found. Clicking...")
        search_button.click()
        logging.info("Search initiated to load data...")
        
        # Wait for a table row to appear, indicating data has loaded.
        logging.info("Waiting for data table to load...")
        wait.until(EC.presence_of_element_located((By.XPATH, "//tbody/tr")))
        logging.info("Data loaded in the table.")

        # Give a couple of seconds for any final JS to execute after data load
        logging.info("Pausing for 2 seconds before clicking export...")
        time.sleep(2)

        logging.info("Step 5: Exporting data...")
        logging.info("Waiting for export button to be clickable...")
        export_button = wait.until(EC.element_to_be_clickable((By.XPATH, "//button[.//span[normalize-space()='Export as excel']]")))
        logging.info("Export button found.")
        
        # --- Click & Verify Loop ---
        max_click_attempts = 3
        click_successful = False
        for attempt in range(max_click_attempts):
            logging.info(f"Attempting to click export button (Attempt {attempt + 1}/{max_click_attempts})...")
            driver.execute_script("arguments[0].click();", export_button)
            
            # Verify if the download started within a short timeframe (e.g., 6 seconds)
            verification_wait_time = 6
            time_waited_for_start = 0
            while time_waited_for_start < verification_wait_time:
                time.sleep(2)
                time_waited_for_start += 2
                files_in_dir = os.listdir(download_dir)
                logging.info(f"Verifying download start... Waited {time_waited_for_start}s. Files in dir: {files_in_dir if files_in_dir else 'None'}")
                if files_in_dir: # Check if ANYTHING appeared
                    logging.info("Download has started. Proceeding to wait for completion.")
                    click_successful = True
                    break
            
            if click_successful:
                break
            else:
                logging.warning(f"Click attempt {attempt + 1} did not start a download. Retrying...")

        if not click_successful:
            raise Exception("Failed to start download after multiple click attempts.")
        
        logging.info("Waiting for download to complete...")
        download_wait_time = 60  # Reverted to 60 seconds as requested
        time_waited = 0
        
        while time_waited < download_wait_time:
            # Check for completed .xlsx files
            completed_files = [f for f in os.listdir(download_dir) if f.endswith('.xlsx')]
            if completed_files:
                logging.info(f"Download complete. File found: {completed_files[0]}")
                return os.path.join(download_dir, completed_files[0])

            # Check for in-progress downloads, which can have a .crdownload extension
            partial_files = [f for f in os.listdir(download_dir) if f.endswith('.crdownload')]
            if partial_files:
                logging.info(f"Download in progress, found partial file: {partial_files[0]}. Continuing to wait...")
            else:
                # If no partial and no complete files, log what is there (if anything)
                all_files = os.listdir(download_dir)
                if all_files:
                    logging.info(f"No .xlsx or .crdownload file found. Current files in dir: {all_files}. Waiting...")
                else:
                    logging.info("Download directory is empty. Waiting for download to start...")

            time.sleep(2) # Poll every 2 seconds to reduce log spam
            time_waited += 2
            
        raise Exception(f"Download timed out after {download_wait_time} seconds. No file was downloaded.")

    except Exception as e:
        logging.error(f"An error occurred in sales scraper: {e}", exc_info=True)
        # Re-raise the exception so the calling function in server.py knows about the failure.
        raise
    finally:
        driver.quit()
        logging.info("Browser closed.")

if __name__ == '__main__':
    # Add dotenv loading for local testing
    logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
    try:
        dotenv_path = os.path.join(os.path.dirname(__file__), '.env')
        if os.path.exists(dotenv_path):
            logging.info(f"Loading environment variables from {dotenv_path} for local run.")
            load_dotenv(dotenv_path=dotenv_path)
    except ImportError:
        logging.warning("python-dotenv not installed. Relying on system environment variables.")

    try:
        downloaded_file_path = run_sales_scraper()
        logging.info(f"\n--- Success! ---")
        logging.info(f"Script finished. File downloaded to: {downloaded_file_path}")
        # In a real scenario, you would now process this file.
        # For testing, we can just print the path.
        # os.remove(downloaded_file_path)
        # os.rmdir(os.path.dirname(downloaded_file_path))
    except Exception as e:
        logging.error(f"\n--- Error ---")
        logging.error(f"An error occurred: {e}", exc_info=True)
        sys.exit(1)