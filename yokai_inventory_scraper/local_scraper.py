#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
本地爬蟲腳本 - 用於在本地運行爬蟲並生成可上傳到伺服器的 JSON 文件
避免在伺服器上運行爬蟲，減少 CPU 負載
"""

import os
import sys
import json
import logging
from datetime import datetime
import pytz
from dotenv import load_dotenv

# 添加當前目錄到 Python 路徑，以便導入其他模組
current_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.append(current_dir)

# 導入爬蟲相關函數
from scraper import run_scraper, parse_inventory_from_text

def setup_logging():
    """設置日誌配置"""
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(levelname)s - %(message)s',
        handlers=[
            logging.FileHandler('local_scraper.log', encoding='utf-8'),
            logging.StreamHandler(sys.stdout)
        ]
    )

def load_environment():
    """加載環境變數"""
    dotenv_path = os.path.join(current_dir, '.env')
    if os.path.exists(dotenv_path):
        logging.info(f"正在從 {dotenv_path} 加載環境變數...")
        load_dotenv(dotenv_path=dotenv_path)
    else:
        logging.warning(".env 文件未找到，請確保已設置必要的環境變數")

def generate_upload_file():
    """
    運行爬蟲並生成可上傳的 JSON 文件
    """
    try:
        logging.info("=== 開始本地爬蟲任務 ===")
        
        # 1. 運行爬蟲獲取原始數據
        logging.info("正在運行爬蟲...")
        raw_inventory_text = run_scraper(headless=True)
        
        if not raw_inventory_text:
            logging.error("爬蟲未返回任何數據")
            return False
        
        # 2. 解析原始數據
        logging.info("正在解析數據...")
        structured_data = parse_inventory_from_text(raw_inventory_text)
        
        if not structured_data:
            logging.error("數據解析失敗")
            return False
        
        # 3. 處理日期時間格式
        taipei_tz = pytz.timezone('Asia/Taipei')
        current_time = datetime.now(taipei_tz)
        
        for item in structured_data:
            # 確保 process_time 是字符串格式
            if hasattr(item['process_time'], 'isoformat'):
                item['process_time'] = item['process_time'].isoformat()
            else:
                item['process_time'] = current_time.isoformat()
        
        # 4. 生成輸出文件名（包含時間戳）
        timestamp = current_time.strftime("%Y%m%d_%H%M%S")
        output_filename = f"inventory_upload_{timestamp}.json"
        output_path = os.path.join(current_dir, output_filename)
        
        # 5. 保存為 JSON 文件
        logging.info(f"正在保存數據到 {output_filename}...")
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(structured_data, f, indent=2, ensure_ascii=False)
        
        # 6. 生成統計信息
        total_items = len(structured_data)
        stores = set(item['store'] for item in structured_data)
        machines = set(f"{item['store']}-{item['machine_id']}" for item in structured_data)
        products = set(item['product_name'] for item in structured_data)
        
        logging.info("=== 爬蟲任務完成 ===")
        logging.info(f"總項目數: {total_items}")
        logging.info(f"店鋪數量: {len(stores)}")
        logging.info(f"機台數量: {len(machines)}")
        logging.info(f"產品種類: {len(products)}")
        logging.info(f"輸出文件: {output_filename}")
        logging.info(f"文件大小: {os.path.getsize(output_path) / 1024:.2f} KB")
        
        # 7. 生成上傳說明
        upload_instructions = f"""
=== 上傳說明 ===
1. 文件已生成: {output_filename}
2. 文件路徑: {output_path}
3. 上傳方式:
   - 方法1: 使用網頁界面上傳
   - 方法2: 使用 curl 命令:
     curl -X POST -F "file=@{output_filename}" http://your-server-url/upload-inventory-file
4. 數據統計:
   - 總項目數: {total_items}
   - 店鋪數量: {len(stores)}
   - 機台數量: {len(machines)}
   - 產品種類: {len(products)}
"""
        print(upload_instructions)
        
        # 8. 保存上傳說明到文件
        instructions_filename = f"upload_instructions_{timestamp}.txt"
        instructions_path = os.path.join(current_dir, instructions_filename)
        with open(instructions_path, 'w', encoding='utf-8') as f:
            f.write(upload_instructions)
        
        return True
        
    except Exception as e:
        logging.error(f"爬蟲任務失敗: {e}", exc_info=True)
        return False

def main():
    """主函數"""
    setup_logging()
    load_environment()
    
    print("=== 本地庫存爬蟲工具 ===")
    print("此工具將在本地運行爬蟲並生成可上傳到伺服器的 JSON 文件")
    print("避免在伺服器上運行爬蟲，減少 CPU 負載")
    print()
    
    # 檢查環境變數
    username = os.getenv("YOKAI_USERNAME")
    password = os.getenv("YOKAI_PASSWORD")
    
    if not username or not password:
        print("錯誤: 請在 .env 文件中設置 YOKAI_USERNAME 和 YOKAI_PASSWORD")
        return
    
    print(f"使用帳號: {username[:4]}****")
    print()
    
    # 確認是否繼續
    confirm = input("是否開始爬蟲任務? (y/N): ").strip().lower()
    if confirm not in ['y', 'yes', '是']:
        print("已取消任務")
        return
    
    # 執行爬蟲任務
    success = generate_upload_file()
    
    if success:
        print("\n✅ 爬蟲任務成功完成！")
        print("請將生成的 JSON 文件上傳到伺服器")
    else:
        print("\n❌ 爬蟲任務失敗！")
        print("請檢查日誌文件 local_scraper.log 獲取詳細錯誤信息")

if __name__ == "__main__":
    main() 