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

# --- 可配置變數 ---
URL = "https://manager.yokaiexpress.com/#/standStoreManager"

def get_credentials():
    """從環境變數中獲取帳號密碼，如果未設定則拋出錯誤。"""
    username = os.getenv('YOKAI_USERNAME')
    password = os.getenv('YOKAI_PASSWORD')
    if not username or not password:
        raise ValueError("錯誤：環境變數 YOKAI_USERNAME 或 YOKAI_PASSWORD 未設定。")
    return username, password

def run_warehouse_scraper(headless=False):
    """
    啟動瀏覽器、登入、導航並下載倉庫庫存報告。
    可以在無頭模式（伺服器默認）或有頭模式（本地調試）下運行。
    """
    download_dir = os.path.join(os.getcwd(), 'temp_downloads', str(uuid.uuid4()))
    os.makedirs(download_dir, exist_ok=True)
    logging.info(f"已建立臨時下載目錄：{download_dir}")

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
        # --- 登入（只執行一次） ---
        username, password = get_credentials()
        driver.get(URL)
        wait = WebDriverWait(driver, 30)
        
        logging.info("步驟 1：正在登入...")
        logging.info("等待使用者名稱欄位...")
        username_field = wait.until(EC.presence_of_element_located((By.XPATH, "//input[@placeholder='User name']")))
        logging.info("找到使用者名稱欄位。輸入中...")
        username_field.send_keys(username)
        
        logging.info("等待密碼欄位...")
        password_field = wait.until(EC.presence_of_element_located((By.XPATH, "//input[@placeholder='Password']")))
        logging.info("找到密碼欄位。輸入中...")
        password_field.send_keys(password)

        logging.info("等待登入按鈕...")
        login_button = wait.until(EC.element_to_be_clickable((By.XPATH, "//button[contains(., 'Login') or contains(., 'Sign in')]")))
        logging.info("找到登入按鈕。點擊中...")
        login_button.click()
        logging.info("登入成功。")

        try:
            logging.info("--- 開始倉庫庫存下載 ---")

            # 步驟 2：導航到倉庫管理，使用穩健的邏輯
            logging.info("導航到倉庫管理...")
            
            # 首先確保點擊 Warehouse 主選單
            warehouse_menu_xpath = "//div[contains(@class, 'el-submenu__title')][.//span[text()='Warehouse']]"
            warehouse_menu = wait.until(EC.element_to_be_clickable((By.XPATH, warehouse_menu_xpath)))
            warehouse_menu.click()
            logging.info(" > Warehouse 主選單已點擊")
            time.sleep(0.5)  # 給選單展開一些時間
            
            try:
                # 嘗試點擊子選單項目
                warehouse_item_xpath = "//li[contains(@class, 'el-menu-item') and normalize-space()='Location Inventory Item']"
                warehouse_item = wait.until(EC.element_to_be_clickable((By.XPATH, warehouse_item_xpath)))
                warehouse_item.click()
                logging.info(" > Location Inventory Item 選單項目點擊成功")
            except TimeoutException:
                # 如果直接點擊失敗，選單可能是關閉的。先展開它
                logging.info(" > 直接點擊失敗。先展開選單...")
                warehouse_menu_xpath = "//div[contains(@class, 'el-submenu__title')][.//i[contains(@class, 'el-icon-notebook-2')]]"
                warehouse_menu = wait.until(EC.element_to_be_clickable((By.XPATH, warehouse_menu_xpath)))
                warehouse_menu.click()
                
                # 現在點擊項目
                warehouse_item_xpath = "//li[contains(@class, 'el-menu-item') and normalize-space()='Location Inventory Item']"
                warehouse_item = wait.until(EC.element_to_be_clickable((By.XPATH, warehouse_item_xpath)))
                warehouse_item.click()
                logging.info(" > 展開選單並點擊項目。")

            logging.info("導航點擊已發送。等待頁面載入...")
            # 檢查當前選擇的 region
            region_input = wait.until(EC.presence_of_element_located((By.XPATH, "//input[@placeholder='Select region']")))
            current_region = region_input.get_attribute("value")
            
            if current_region != "TW":
                logging.info(f"Current region is {current_region}, changing to TW...")
                # 點擊 region 選擇器
                region_input.click()
                time.sleep(0.5)
                
                # 在下拉選單中找到並點擊 TW 選項
                tw_option = wait.until(EC.element_to_be_clickable((
                    By.XPATH, 
                    "//li[contains(@class, 'el-select-dropdown__item')]//span[text()='TW']"
                )))
                driver.execute_script("arguments[0].click();", tw_option.find_element(By.XPATH, ".."))
                time.sleep(1.5)  # 增加等待時間確保選擇生效
                
                # 確認 region 已經變更為 TW
                if region_input.get_attribute("value") != "TW":
                    raise Exception("Failed to change region to TW")
                logging.info("Successfully changed region to TW")
            else:
                logging.info("Region is already set to TW")

            logging.info("Proceeding to export...")

            # 步驟 3：點擊匯出按鈕並下載檔案
            export_button_xpath = "//button[contains(@class, 'el-button--primary')]//span[contains(text(), 'Export remain stock as excel')]"
            
            max_export_attempts = 3
            for attempt in range(max_export_attempts):
                logging.info(f"--- 匯出嘗試 {attempt + 1}/{max_export_attempts} ---")
                
                # 1. 點擊匯出按鈕
                try:
                    export_button = wait.until(EC.element_to_be_clickable((By.XPATH, export_button_xpath)))
                    driver.execute_script("arguments[0].click();", export_button)
                    logging.info(" > 匯出按鈕已點擊。")
                except Exception as e:
                    logging.error(f" > 無法在嘗試 {attempt + 1} 中點擊匯出按鈕：{e}", exc_info=True)
                    if attempt + 1 < max_export_attempts:
                        time.sleep(2)  # 等待下一次主要嘗試
                        continue  # 進行下一次匯出嘗試
                    else:
                        raise Exception("多次嘗試後仍無法點擊匯出按鈕。")

                # 2. 等待並檢查檔案系統以確認下載是否開始
                logging.info(" > 等待 3 秒後檢查檔案系統...")
                time.sleep(3)

                max_file_checks = 5
                download_started = False
                for check_num in range(max_file_checks):
                    # 如果有任何檔案（.xlsx 或 .crdownload）存在，表示下載已開始
                    if os.listdir(download_dir):
                        logging.info(" > 成功：在下載目錄中檢測到檔案。下載已開始。")
                        download_started = True
                        break  # 退出檔案系統檢查迴圈
                    
                    logging.info(f" > 檔案系統檢查 {check_num + 1}/{max_file_checks}... 未找到檔案。等待 2 秒。")
                    time.sleep(2)

                if download_started:
                    # 3. 如果下載已開始，輪詢完成情況並返回路徑
                    # 給予 60 秒的寬裕時間來完成下載
                    return poll_for_download(download_dir, 60)
                
                # 如果我們在這裡，表示所有檢查後都沒有出現檔案
                logging.warning(f" > 匯出嘗試 {attempt + 1} 失敗。下載目錄中未出現檔案。")
                # 迴圈將繼續進行下一次主要匯出嘗試

            # 如果所有匯出嘗試都無法建立檔案，拋出最終錯誤
            raise Exception(f"經過 {max_export_attempts} 次嘗試後仍無法開始下載。")

        except Exception as e:
            # 捕獲過程中的任何異常，記錄並重新拋出
            logging.error(f"倉庫爬蟲程序失敗：{e}", exc_info=True)
            raise  # 重新拋出異常以供 server.py 背景作業運行器處理

    finally:
        driver.quit()
        logging.info("瀏覽器已關閉。")


def poll_for_download(download_dir, timeout_seconds):
    """輪詢下載目錄以檢查已完成的檔案。"""
    logging.info(f"輪詢下載目錄 {timeout_seconds} 秒...")
    time_waited = 0
    while time_waited < timeout_seconds:
        # 檢查已完成的 .xlsx 檔案
        completed_files = [f for f in os.listdir(download_dir) if f.endswith('.xlsx')]
        if completed_files:
            logging.info(f"下載完成。找到檔案：{completed_files[0]}")
            return os.path.join(download_dir, completed_files[0])

        # 檢查進行中的下載
        partial_files = [f for f in os.listdir(download_dir) if f.endswith('.crdownload')]
        if partial_files:
            logging.info(f"下載進行中，發現部分檔案：{partial_files[0]}。繼續等待...")
        else:
            logging.info("下載目錄為空。等待下載開始...")
        
        time.sleep(2)
        time_waited += 2
    
    raise Exception(f"下載輪詢在 {timeout_seconds} 秒後超時。")


if __name__ == '__main__':
    # 添加 dotenv 載入以進行本地測試
    logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
    try:
        dotenv_path = os.path.join(os.path.dirname(__file__), '.env')
        if os.path.exists(dotenv_path):
            logging.info(f"從 {dotenv_path} 載入環境變數進行本地運行。")
            load_dotenv(dotenv_path=dotenv_path)
    except ImportError:
        logging.warning("未安裝 python-dotenv。依賴系統環境變數。")

    try:
        # 本地調試時，以"有頭"模式運行以查看瀏覽器操作
        downloaded_file_path = run_warehouse_scraper(headless=False)
        logging.info(f"\n--- 成功！ ---")
        logging.info(f"腳本完成。檔案已下載到：{downloaded_file_path}")
        # 在實際場景中，您現在會處理這個檔案
        # 對於測試，我們可以只印出路徑
        # os.remove(downloaded_file_path)
        # os.rmdir(os.path.dirname(downloaded_file_path))
    except Exception as e:
        logging.error(f"\n--- 錯誤 ---")
        logging.error(f"發生錯誤：{e}", exc_info=True)
        sys.exit(1)
