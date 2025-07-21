import time
import os
import sys
import uuid
import logging
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import TimeoutException
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

def run_sales_scraper(headless=True):
    """
    Launches a browser, logs in, navigates, and downloads the sales report.
    Can be run in headless (default for server) or headed mode (for local debugging).
    """
    download_dir = os.path.join(os.getcwd(), 'temp_downloads', str(uuid.uuid4()))
    os.makedirs(download_dir, exist_ok=True)
    logging.info(f"Created temporary download directory: {download_dir}")

    options = webdriver.ChromeOptions()
    if headless:
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
        # --- Login (only happens once) ---
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

        # The main process now runs only once. The page-refresh retry loop is removed.
        try:
            logging.info("--- Starting Sales Data Download ---")

            # Step 2: Navigate to Order Management with robust, idempotent logic
            logging.info("Navigating to Order Management...")
            try:
                # Attempt to click the final menu item directly. This works if the menu is already open.
                order_management_item_xpath = "//li[contains(@class, 'el-menu-item') and normalize-space()='Order management']"
                order_management_item = wait.until(EC.element_to_be_clickable((By.XPATH, order_management_item_xpath)))
                order_management_item.click()
                logging.info(" > Direct click on menu item successful (menu was likely open).")
            except TimeoutException:
                # If direct click fails, the menu is likely closed. Expand it first.
                logging.info(" > Direct click failed. Expanding menu first...")
                order_management_menu_xpath = "//div[contains(@class, 'el-submenu__title')][.//span[normalize-space()='Order management']]"
                order_management_menu = wait.until(EC.element_to_be_clickable((By.XPATH, order_management_menu_xpath)))
                order_management_menu.click()
                
                # Now click the item
                order_management_item_xpath = "//li[contains(@class, 'el-menu-item') and normalize-space()='Order management']"
                order_management_item = wait.until(EC.element_to_be_clickable((By.XPATH, order_management_item_xpath)))
                order_management_item.click()
                logging.info(" > Expanded menu and clicked item.")

            logging.info("Navigation click sent. Waiting for page to load...")

            # Step 3: Set date range (Search click is removed as per new strategy)
            logging.info("Waiting for date fields to be present...")
            wait.until(EC.presence_of_element_located((By.XPATH, "//input[@placeholder='Select start date']")))
            logging.info("Date fields found. Setting date range...")
            start_date_input = driver.find_element(By.XPATH, "//input[@placeholder='Select start date']")
            start_date_input.clear()
            start_date_input.send_keys("2025-01-01")
            end_date_input = driver.find_element(By.XPATH, "//input[@placeholder='Select end date']")
            end_date_input.clear()
            end_date_input.send_keys("2026-01-01")
            
            logging.info("Date range set. Clicking away to finalize date selection.")
            # This click simulates a user clicking outside the date picker, which often
            # triggers the necessary JavaScript event to update the component's state.
            driver.find_element(By.TAG_NAME, 'body').click()
            time.sleep(0.5) # Brief pause to allow any JS events to fire.

            logging.info("Proceeding directly to export.")

            # Step 4: New robust export logic based on filesystem checks
            export_button_xpath = "//button[.//span[normalize-space()='Export as excel']]"
            
            max_export_attempts = 3
            for attempt in range(max_export_attempts):
                logging.info(f"--- Export Attempt {attempt + 1}/{max_export_attempts} ---")
                
                # 1. Click the export button
                try:
                    export_button = wait.until(EC.element_to_be_clickable((By.XPATH, export_button_xpath)))
                    driver.execute_script("arguments[0].click();", export_button)
                    logging.info(" > Export button clicked.")
                except Exception as e:
                    logging.error(f" > Could not click export button on attempt {attempt + 1}: {e}", exc_info=True)
                    if attempt + 1 < max_export_attempts:
                        time.sleep(2) # Wait before next major attempt
                        continue # Go to the next export attempt
                    else:
                        raise Exception("Failed to click export button after multiple attempts.")

                # 2. Wait and then check the filesystem to see if the download started
                logging.info(" > Waiting 3 seconds before checking filesystem...")
                time.sleep(3)

                max_file_checks = 5
                download_started = False
                for check_num in range(max_file_checks):
                    # If any file (.xlsx or .crdownload) exists, the download has started
                    if os.listdir(download_dir):
                        logging.info(" > SUCCESS: File detected in download directory. Download has started.")
                        download_started = True
                        break # Exit the filesystem check loop
                    
                    logging.info(f" > Filesystem check {check_num + 1}/{max_file_checks}... No file found. Waiting 2 seconds.")
                    time.sleep(2)

                if download_started:
                    # 3. If download has started, poll for completion and return the path
                    # Give it a generous 60 seconds to complete the download.
                    return poll_for_download(download_dir, 60)
                
                # If we are here, it means no file appeared after all checks
                logging.warning(f" > Export attempt {attempt + 1} failed. No file appeared in download directory.")
                # The loop will now proceed to the next major export attempt

            # If all export attempts fail to create a file, raise a final error.
            raise Exception(f"Failed to start download after {max_export_attempts} attempts.")

        except Exception as e:
            # Catch any exception from the process, log it, and re-raise it
            logging.error(f"The sales scraper process failed: {e}", exc_info=True)
            raise  # Re-raise the exception to be handled by the server.py background job runner

    finally:
        driver.quit()
        logging.info("Browser closed.")


def poll_for_download(download_dir, timeout_seconds):
    """Polls the download directory for the completed file."""
    logging.info(f"Polling download directory for {timeout_seconds} seconds...")
    time_waited = 0
    while time_waited < timeout_seconds:
        # Check for completed .xlsx files
        completed_files = [f for f in os.listdir(download_dir) if f.endswith('.xlsx')]
        if completed_files:
            logging.info(f"Download complete. File found: {completed_files[0]}")
            return os.path.join(download_dir, completed_files[0])

        # Check for in-progress downloads
        partial_files = [f for f in os.listdir(download_dir) if f.endswith('.crdownload')]
        if partial_files:
            logging.info(f"Download in progress, found partial file: {partial_files[0]}. Continuing to wait...")
        else:
            logging.info("Download directory is empty. Waiting for download to start...")
        
        time.sleep(2)
        time_waited += 2
    
    raise Exception(f"Download poll timed out after {timeout_seconds} seconds.")


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
        # For local debugging, run in "headed" mode to see the browser in action.
        downloaded_file_path = run_sales_scraper(headless=False)
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