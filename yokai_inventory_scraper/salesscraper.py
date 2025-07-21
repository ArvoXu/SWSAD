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

def run_sales_scraper():
    """
    Launches a headless browser, logs in, directly navigates to the sales page,
    and downloads the report. This version completely removes UI-based download
    verification and relies solely on polling the file system after the click.
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
    
    # These preferences are crucial for preventing the "Save As" dialog
    prefs = {
        "download.default_directory": download_dir,
        "download.prompt_for_download": False, # Do not ask where to save
        "download.directory_upgrade": True,
        "safebrowsing.enabled": True # Enable safe browsing
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

        # --- Main process, simplified and direct ---
        try:
            logging.info("--- Starting Sales Data Download ---")

            # Step 2: Directly navigate to the sales list page
            sales_list_url = "https://manager.yokaiexpress.com/#/standSaleList"
            logging.info(f"Directly navigating to {sales_list_url}...")
            driver.get(sales_list_url)

            # Step 3: Set date range and search
            logging.info("Waiting for date fields to be present...")
            wait.until(EC.presence_of_element_located((By.XPATH, "//input[@placeholder='Select start date']")))
            logging.info("Date fields found. Setting date range...")
            start_date_input = driver.find_element(By.XPATH, "//input[@placeholder='Select start date']")
            start_date_input.clear()
            start_date_input.send_keys("2025-01-01")
            end_date_input = driver.find_element(By.XPATH, "//input[@placeholder='Select end date']")
            end_date_input.clear()
            end_date_input.send_keys("2026-01-01")
            
            logging.info("Searching for data...")
            search_button = wait.until(EC.element_to_be_clickable((By.XPATH, "//button[.//span[normalize-space()='Search']]")))
            search_button.click()
            
            logging.info("Waiting for data table to load after search...")
            wait.until(EC.presence_of_element_located((By.XPATH, "//tbody/tr")))
            logging.info("Data table loaded.")

            # Step 4: Click export and immediately start polling for the file
            logging.info("Attempting to click export button...")
            export_button_xpath = "//button[.//span[normalize-space()='Export as excel']]"
            export_button = wait.until(EC.element_to_be_clickable((By.XPATH, export_button_xpath)))
            driver.execute_script("arguments[0].click();", export_button)
            logging.info("Export button clicked. Now polling for downloaded file...")

            # Step 5: Poll for the downloaded file for an extended period
            # We no longer wait for UI feedback, so we must rely on polling.
            return poll_for_download(download_dir, 60) # Poll for up to 60 seconds

        except Exception as e:
            # Catch any exception from the process, log it, and re-raise it
            logging.error(f"The sales scraper process failed: {e}", exc_info=True)
            # Take a screenshot on failure for debugging
            screenshot_path = os.path.join(os.getcwd(), f"error_screenshot_{uuid.uuid4()}.png")
            try:
                driver.save_screenshot(screenshot_path)
                logging.info(f"Saved screenshot of the error page to: {screenshot_path}")
            except Exception as screenshot_error:
                logging.error(f"Failed to save screenshot: {screenshot_error}")
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