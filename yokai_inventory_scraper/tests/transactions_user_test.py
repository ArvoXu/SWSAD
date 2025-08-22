import sys, time
sys.path.insert(0, r'c:\Users\UserPC_01\Documents\GitHub\SWSAD1\yokai_inventory_scraper')
from database import get_db, Transaction, Store
import server
app = server.app
client = app.test_client()

username = f"txn_test_user_{int(time.time())}"
password = 'test1234'

with client.session_transaction() as sess:
    sess['logged_in'] = True

# pick an inventory store
r = client.get('/api/stores-list')
stores = r.get_json().get('stores', [])
print('stores sample:', stores[:5])
if not stores:
    print('no stores'); sys.exit(0)
assign = stores[0]
print('assigning', assign)
# create user
r2 = client.post('/api/users', json={'username': username, 'password': password, 'displayName':'T', 'stores':[assign]})
print('/api/users', r2.status_code, r2.get_json())
# add transactions: one matching assigned, one not
db = next(get_db())
try:
    # commit directly
    # ensure store exists in stores table
    store_key = assign + '-provisional_sales' if not assign.endswith('-provisional_sales') else assign
    s = db.query(Store).filter(Store.store_key==store_key).first()
    if not s:
        s = Store(store_key=store_key)
        db.add(s); db.flush()
    # create txn for assigned
    from datetime import datetime
    t1 = Transaction(store_key=store_key, transaction_time=datetime.fromisoformat('2025-08-01T00:00:00'), amount=100, product_name='P1', payment_type='cash')
    # create txn for other store
    other_key = db.query(Store.store_key).filter(Store.store_key != store_key).first()[0]
    t2 = Transaction(store_key=other_key, transaction_time=datetime.fromisoformat('2025-08-02T00:00:00'), amount=200, product_name='P2', payment_type='card')
    db.add_all([t1,t2])
    db.commit()
finally:
    db.close()

# login as user
r3 = client.post('/api/user-login', json={'username': username, 'password': password})
print('/api/user-login', r3.status_code, r3.get_json())
# fetch transactions
r4 = client.get('/api/transactions')
print('/api/transactions', r4.status_code)
print(r4.get_json())
