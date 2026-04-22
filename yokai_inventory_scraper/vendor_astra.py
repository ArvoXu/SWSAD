import os
import time
import requests
from datetime import datetime


DEFAULT_BASE_URL = "https://plus.astra.com.tw/Pages/ajax/com_sales_report.php"


def _default_headers():
    return {
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'X-Requested-With': 'XMLHttpRequest',
        'User-Agent': 'yokai-inventory-scraper/1.0'
    }


def fetch_astra_sales(start_date, end_date, token=None, rows=1000, page=1, base_url=None, timeout=30):
    """Fetches aggregated sales rows from Astra's API.

    Returns a list of dicts with keys: product_code, name_cn, name_en, quantity, amount, date
    """
    if token is None:
        token = os.getenv('ASTRA_TOKEN')
        if not token:
            raise ValueError('ASTRA_TOKEN is not set in environment and token parameter was not provided')

    if base_url is None:
        base_url = DEFAULT_BASE_URL

    params = {
        'action': 'list',
        'token': token,
        '_search': 'true',
        'nd': str(int(time.time() * 1000)),
        'rows': rows,
        'page': page,
        'sidx': 'product_code',
        'sord': 'asc',
        'searchVmID': '',
        'searchStartDate': start_date,
        'searchEndDate': end_date,
        'searchField': 'allfieldsearch'
    }

    resp = requests.get(base_url, params=params, headers=_default_headers(), timeout=timeout)
    resp.raise_for_status()

    data = None
    # Expected JSON structure: {"rows":[{"id":"02","cell":["","02","...","...",7,"1120"]}, ... ], "page":"1","total":1,"records":2}
    try:
        data = resp.json()
    except ValueError as e:
        raise ValueError(f'Failed to parse JSON from Astra API: {e}')

    rows = data.get('rows', []) if isinstance(data, dict) else []
    out = []

    for r in rows:
        cell = r.get('cell', [])
        # Guard against unexpected length
        # cell layout in examples: ["", "02", "<cn>", "<en>", 7, "1120"]
        try:
            product_code = cell[1] if len(cell) > 1 else ''
            name_cn = cell[2] if len(cell) > 2 else ''
            name_en = cell[3] if len(cell) > 3 else ''
            quantity = int(cell[4]) if len(cell) > 4 and cell[4] != '' else 0
            amount = int(float(cell[5])) if len(cell) > 5 and cell[5] != '' else 0
        except Exception:
            # fall back to safe parsing
            product_code = cell[1] if len(cell) > 1 else ''
            name_cn = cell[2] if len(cell) > 2 else ''
            name_en = cell[3] if len(cell) > 3 else ''
            try:
                quantity = int(cell[4])
            except Exception:
                quantity = 0
            try:
                amount = int(float(cell[5]))
            except Exception:
                amount = 0

        out.append({
            'product_code': product_code,
            'name_cn': name_cn,
            'name_en': name_en,
            'quantity': quantity,
            'amount': amount,
            'date': end_date
        })

    return out


def build_transactions_from_astra_rows(rows, store_key=None):
    """Convert rows (output from fetch_astra_sales) into the transaction dict format
    expected by server (shopName, product, date, amount, payType).

    By default, all transactions will be assigned to a provisional store such as
    "ASTRA-provisional" unless store_key is provided.
    """
    shop_name = store_key or 'ASTRA-provisional'
    transactions = []
    for r in rows:
        # We treat each aggregated row as a single transaction record for simplicity.
        product = f"{r.get('product_code','')}-{r.get('name_en') or r.get('name_cn')}".strip('-')
        transactions.append({
            'shopName': shop_name,
            'product': product,
            'date': r.get('date'),
            'amount': r.get('amount', 0),
            'payType': 'ASTRA_API'
        })
    return transactions
