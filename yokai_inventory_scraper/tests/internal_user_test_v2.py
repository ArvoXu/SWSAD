import sys, json, time
sys.path.insert(0, r'c:\Users\UserPC_01\Documents\GitHub\SWSAD1\yokai_inventory_scraper')
import server
app = server.app
client = app.test_client()

username = f"mvp_test_user_v2_{int(time.time())}"
password = "MvpPass123"
print('TEST V2 START', username)

# create admin session
with client.session_transaction() as sess:
    sess['logged_in'] = True

r = client.get('/api/stores-list')
stores = r.get_json().get('stores', [])
print('stores count', len(stores))
if not stores:
    print('no stores'); sys.exit(0)
store_to_assign = stores[0]
print('assigning store:', store_to_assign)

payload = {'username': username, 'password': password, 'displayName': 'MVP Tester', 'stores': [store_to_assign]}
r2 = client.post('/api/users', json=payload)
print('/api/users ->', r2.status_code, r2.get_json())

# remove admin flag
with client.session_transaction() as sess:
    sess.pop('logged_in', None)

r3 = client.post('/api/user-login', json={'username': username, 'password': password})
print('/api/user-login ->', r3.status_code, r3.get_json())

r4 = client.get('/get-data')
print('/get-data ->', r4.status_code)
full = r4.get_json()
print('full keys:', list(full.keys()))
items = full.get('data', [])
print('data length:', len(items))
if items:
    print('sample item keys:', list(items[0].keys()))
    print('sample item store/machine:', items[0].get('store'), items[0].get('machineId'))
print('TEST V2 END')
