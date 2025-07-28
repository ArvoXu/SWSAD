#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
庫存文件格式驗證腳本
用於檢查 JSON 文件是否符合上傳要求
"""

import json
import sys
import os
from datetime import datetime
from dateutil.parser import parse as parse_date

def validate_inventory_file(file_path):
    """
    驗證庫存文件格式
    """
    try:
        # 檢查文件是否存在
        if not os.path.exists(file_path):
            print(f"❌ 錯誤：文件不存在 - {file_path}")
            return False
        
        # 讀取文件
        with open(file_path, 'r', encoding='utf-8') as f:
            try:
                data = json.load(f)
            except json.JSONDecodeError as e:
                print(f"❌ JSON 格式錯誤：{e}")
                return False
        
        # 檢查是否為列表
        if not isinstance(data, list):
            print("❌ 錯誤：數據應該是列表格式")
            return False
        
        if len(data) == 0:
            print("❌ 錯誤：數據列表為空")
            return False
        
        print(f"✅ 文件格式正確，包含 {len(data)} 個項目")
        
        # 檢查必要字段
        required_fields = ['store', 'machine_id', 'product_name', 'quantity']
        optional_fields = ['last_updated', 'process_time']
        
        errors = []
        warnings = []
        
        for i, item in enumerate(data):
            # 檢查是否為字典
            if not isinstance(item, dict):
                errors.append(f"第 {i+1} 項：不是字典格式")
                continue
            
            # 檢查必要字段
            for field in required_fields:
                if field not in item:
                    errors.append(f"第 {i+1} 項：缺少必要字段 '{field}'")
                elif field == 'quantity':
                    # 檢查數量字段
                    if not isinstance(item[field], int) or item[field] < 0:
                        errors.append(f"第 {i+1} 項：數量字段必須是正整數，當前值：{item[field]}")
            
            # 檢查可選字段
            if 'process_time' in item:
                try:
                    if isinstance(item['process_time'], str):
                        parse_date(item['process_time'])
                except Exception as e:
                    warnings.append(f"第 {i+1} 項：process_time 格式可能不正確 - {e}")
        
        # 顯示錯誤
        if errors:
            print("\n❌ 發現錯誤：")
            for error in errors:
                print(f"  - {error}")
            return False
        
        # 顯示警告
        if warnings:
            print("\n⚠️ 發現警告：")
            for warning in warnings:
                print(f"  - {warning}")
        
        # 統計信息
        stores = set(item.get('store', '') for item in data)
        machines = set(f"{item.get('store', '')}-{item.get('machine_id', '')}" for item in data)
        products = set(item.get('product_name', '') for item in data)
        total_quantity = sum(item.get('quantity', 0) for item in data)
        
        print(f"\n📊 數據統計：")
        print(f"  - 總項目數：{len(data)}")
        print(f"  - 店鋪數量：{len(stores)}")
        print(f"  - 機台數量：{len(machines)}")
        print(f"  - 產品種類：{len(products)}")
        print(f"  - 總庫存量：{total_quantity}")
        
        # 顯示前幾個項目作為示例
        print(f"\n📋 數據示例（前3項）：")
        for i, item in enumerate(data[:3]):
            print(f"  {i+1}. {item.get('store', 'N/A')} - {item.get('machine_id', 'N/A')} - {item.get('product_name', 'N/A')} (數量: {item.get('quantity', 0)})")
        
        print(f"\n✅ 文件驗證通過！可以安全上傳到伺服器。")
        return True
        
    except Exception as e:
        print(f"❌ 驗證過程中發生錯誤：{e}")
        return False

def main():
    """
    主函數
    """
    if len(sys.argv) != 2:
        print("使用方法：python validate_inventory_file.py <json文件路徑>")
        print("示例：python validate_inventory_file.py inventory_upload_20250101_120000.json")
        return
    
    file_path = sys.argv[1]
    print(f"正在驗證文件：{file_path}")
    print("=" * 50)
    
    success = validate_inventory_file(file_path)
    
    if success:
        print("\n🎉 文件驗證成功！")
        sys.exit(0)
    else:
        print("\n💥 文件驗證失敗！請修正錯誤後重新驗證。")
        sys.exit(1)

if __name__ == "__main__":
    main() 