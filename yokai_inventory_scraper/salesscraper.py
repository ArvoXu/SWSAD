import time
import os
import sys
import uuid
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
    print(f"Created temporary download directory: {download_dir}")

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
        wait = WebDriverWait(driver, 20)
        
        print("Logging in...")
        username_field = wait.until(EC.presence_of_element_located((By.XPATH, "//input[@placeholder='User name']")))
        username_field.send_keys(username)
        password_field = wait.until(EC.presence_of_element_located((By.XPATH, "//input[@placeholder='Password']")))
        password_field.send_keys(password)
        login_button = wait.until(EC.element_to_be_clickable((By.XPATH, "//button[contains(., 'Login') or contains(., 'Sign in')]")))
        login_button.click()
        print("Login successful.")

        print("Navigating to Order Management...")
        order_management_menu = wait.until(EC.element_to_be_clickable((By.XPATH, "//div[contains(@class, 'el-submenu__title')][.//span[normalize-space()='Order management']]")))
        order_management_menu.click()
        order_management_item = wait.until(EC.element_to_be_clickable((By.XPATH, "//li[contains(@class, 'el-menu-item') and normalize-space()='Order management']")))
        order_management_item.click()
        print("Navigation complete.")
        
        print("Setting date range...")
        start_date_input = wait.until(EC.presence_of_element_located((By.XPATH, "//input[@placeholder='Select start date']")))
        start_date_input.clear()
        start_date_input.send_keys("2025-01-01")

        end_date_input = wait.until(EC.presence_of_element_located((By.XPATH, "//input[@placeholder='Select end date']")))
        end_date_input.clear()
        end_date_input.send_keys("2026-01-01")
        print("Date range set.")
        
        # Adding a small delay for search button to become interactable if needed
        time.sleep(1)
        search_button = wait.until(EC.element_to_be_clickable((By.XPATH, "//button[.//span[normalize-space()='Search']]")))
        search_button.click()
        print("Search initiated to load data...")
        
        # Wait for a table row to appear, indicating data has loaded.
        wait.until(EC.presence_of_element_located((By.XPATH, "//tbody/tr")))
        print("Data loaded in the table.")

        print("Clicking export button...")
        export_button = wait.until(EC.element_to_be_clickable((By.XPATH, "//button[.//span[normalize-space()='Export as excel']]")))
        export_button.click()
        
        print("Waiting for download to complete...")
        download_wait_time = 30 
        time_waited = 0
        while time_waited < download_wait_time:
            if any(fname.endswith('.xlsx') for fname in os.listdir(download_dir)):
                downloaded_files = [f for f in os.listdir(download_dir) if f.endswith('.xlsx')]
                print(f"Download complete. File found: {downloaded_files[0]}")
                return os.path.join(download_dir, downloaded_files[0])
            time.sleep(1)
            time_waited += 1
            
        raise Exception("Download timed out. No file was downloaded.")

    finally:
        driver.quit()
        print("Browser closed.")

if __name__ == '__main__':
    # Add dotenv loading for local testing
    try:
        dotenv_path = os.path.join(os.path.dirname(__file__), '.env')
        if os.path.exists(dotenv_path):
            print(f"Loading environment variables from {dotenv_path} for local run.")
            load_dotenv(dotenv_path=dotenv_path)
    except ImportError:
        print("python-dotenv not installed. Relying on system environment variables.")

    try:
        downloaded_file_path = run_sales_scraper()
        print(f"\n--- Success! ---")
        print(f"Script finished. File downloaded to: {downloaded_file_path}")
        # In a real scenario, you would now process this file.
        # For testing, we can just print the path.
        # os.remove(downloaded_file_path)
        # os.rmdir(os.path.dirname(downloaded_file_path))
    except Exception as e:
        print(f"\n--- Error ---")
        print(f"An error occurred: {e}")
        sys.exit(1)