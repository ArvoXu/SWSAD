import sys
sys.path.insert(0, r'c:\Users\UserPC_01\Documents\GitHub\SWSAD1\yokai_inventory_scraper')
from database import get_db, Inventory, Store
from sqlalchemy import and_, or_

def run():
    db = next(get_db())
    try:
        sk = 'TW Lion HQ 1.0-provisional_sales'
        print('Debugging for store_key:', sk)
        left, right = sk.rsplit('-', 1)
        print('left:', left, 'right:', right)
        c1 = db.query(Inventory).filter(and_(Inventory.store == left, Inventory.machine_id == right)).count()
        c2 = db.query(Inventory).filter(Inventory.store == left).count()
        c3 = db.query(Inventory).filter(Inventory.store.ilike(left)).count()
        c4 = db.query(Inventory).filter(Inventory.store.ilike(f"{left}%")).count()
        c5 = db.query(Inventory).filter(Inventory.store.ilike(f"%{left}%")).count()
        print('counts: exact store+machine:', c1)
        print('counts: store == left:', c2)
        print('counts: ilike(left):', c3)
        print('counts: ilike(left%):', c4)
        print('counts: ilike(%left%):', c5)
        # Combined
        filters = [and_(Inventory.store == left, Inventory.machine_id == right), Inventory.store.ilike(left), Inventory.store.ilike(f"{left}%"), Inventory.store.ilike(f"%{left}%")]
        tot = db.query(Inventory).filter(or_(*filters)).count()
        print('combined OR count:', tot)

        # Show sample rows for ilike(%left%)
        rows = db.query(Inventory).filter(Inventory.store.ilike(f"%{left}%")).limit(10).all()
        print('\nSample rows for ilike(%left%):')
        for r in rows:
            print(r.id, r.store, r.machine_id, r.product_name)

    finally:
        db.close()

if __name__ == '__main__':
    run()
