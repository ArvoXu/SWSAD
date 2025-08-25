import sys, time
sys.path.insert(0, r'c:\Users\UserPC_01\Documents\GitHub\SWSAD1\yokai_inventory_scraper')
import server
app = server.app
client = app.test_client()

username = f"notify_test_{int(time.time())}"
password = "TestPass123"

with client.session_transaction() as sess:
    sess['logged_in'] = True

r = client.get('/api/stores-list')
stores = r.get_json().get('stores', [])
store = stores[0] if stores else None
payload = {'username': username, 'password': password, 'displayName': 'Notify Tester', 'stores': [store]}
r2 = client.post('/api/users', json=payload)
print('/api/users ->', r2.status_code, r2.get_json())
with client.session_transaction() as sess:
    sess.pop('logged_in', None)

r3 = client.post('/api/user-login', json={'username': username, 'password': password})
print('/api/user-login ->', r3.status_code, r3.get_json())

# set profile threshold to 10000 to avoid triggering
r4 = client.post('/api/user-profile', json={'lowInventoryThreshold': 10000})
print('/api/user-profile set threshold ->', r4.status_code, r4.get_json())

# call notify (should not send because threshold too high -> user total likely less)
r5 = client.post('/api/notify-low-inventory')
print('/api/notify-low-inventory ->', r5.status_code, r5.get_json())
