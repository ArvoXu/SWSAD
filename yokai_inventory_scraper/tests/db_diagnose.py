import sys
sys.path.insert(0, r'c:\Users\UserPC_01\Documents\GitHub\SWSAD1\yokai_inventory_scraper')
from database import get_db, Inventory, Store, User
from sqlalchemy import func

def main():
    db = next(get_db())
    try:
        inv_count = db.query(Inventory).count()
        store_count = db.query(Store).count()
        distinct_inv = db.query(Inventory.store).distinct().limit(50).all()
        store_keys = db.query(Store.store_key).limit(50).all()
        print('inventory_count:', inv_count)
        print('stores_table_count:', store_count)
        print('distinct_inventory_stores (up to 50):')
        for r in distinct_inv:
            print(' -', r[0])
        print('stores.store_key (up to 50):')
        for r in store_keys:
            print(' -', r[0])
        # sample a few inventory rows
        print('\nSample inventory rows (up to 10):')
        rows = db.query(Inventory).limit(10).all()
        for it in rows:
            print(it.id, it.store, it.machine_id, it.product_name, it.quantity)
    finally:
        db.close()

if __name__ == '__main__':
    main()
