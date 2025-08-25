import sys
from pathlib import Path
repo_root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(repo_root / 'yokai_inventory_scraper'))
import server
app = server.app
client = app.test_client()

# Ensure admin session for creating user
with client.session_transaction() as sess:
    sess['logged_in'] = True

# Try to fetch a store to assign; fallback to None
r = client.get('/api/stores-list')
stores = r.get_json().get('stores', []) if r.is_json else []
store = stores[0] if stores else None

username='manual_trigger_test'
password='abc123'
payload={'username':username,'password':password,'displayName':'Trig Tester','stores':[store] if store else []}
r2=client.post('/api/users', json=payload)
print('/api/users', r2.status_code, r2.get_json())

# Logout admin
with client.session_transaction() as sess:
    sess.pop('logged_in', None)

# login as the created user (if created)
r3=client.post('/api/user-login', json={'username':username,'password':password})
print('/api/user-login', r3.status_code, r3.get_json())

# set email and threshold for current user
r4=client.post('/api/user-profile', json={'email':'test@example.com','lowInventoryThreshold':5})
print('/api/user-profile', r4.status_code, r4.get_json())

# trigger the notify endpoint
r5=client.get('/api/notify-low-inventory/trigger')
print('/api/notify trigger', r5.status_code, r5.get_json())
