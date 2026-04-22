# Astra (plus.astra.com.tw) Sales API Integration

This module integrates the Astra vendor sales API into the system.

## Setup

1. Add the API token to your environment or `.env` file:

   ASTRA_TOKEN=your_api_token_here

2. (Optional) Set default store key to assign Astra sales to a store:

   ASTRA_STORE_KEY=ASTRA-provisional

## How it works

- `vendor_astra.fetch_astra_sales(start_date, end_date)` calls the vendor endpoint and returns a list of rows.
- `vendor_astra.build_transactions_from_astra_rows(rows, store_key)` creates transaction-like dicts.
- Trigger the background job (server will insert into DB):

  POST /run-astra-sales
  Body (optional JSON): {"start_date": "2026-01-30", "end_date": "2026-02-02"}

The background job will write transactions into the `transactions` table and add a provisional store if needed.
