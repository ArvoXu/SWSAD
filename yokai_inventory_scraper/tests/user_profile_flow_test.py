import sys, time
sys.path.insert(0, r'c:\Users\UserPC_01\Documents\GitHub\SWSAD1\yokai_inventory_scraper')
import server
app = server.app
client = app.test_client()

username = f"profile_test_{int(time.time())}"
password = "TestPass123"

print('creating admin session')
with client.session_transaction() as sess:
    sess['logged_in'] = True

# get a store to assign
r = client.get('/api/stores-list')
stores = r.get_json().get('stores', [])
store = stores[0] if stores else None

payload = {'username': username, 'password': password, 'displayName': 'Profile Tester', 'stores': [store]}
r2 = client.post('/api/users', json=payload)
print('/api/users ->', r2.status_code, r2.get_json())

with client.session_transaction() as sess:
    sess.pop('logged_in', None)

# login as user
r3 = client.post('/api/user-login', json={'username': username, 'password': password})
print('/api/user-login ->', r3.status_code, r3.get_json())

# update profile
r4 = client.post('/api/user-profile', json={'displayName':'New Name', 'email':'tester@example.com'})
print('/api/user-profile POST ->', r4.status_code, r4.get_json())

# fetch profile
r5 = client.get('/api/user-profile')
print('/api/user-profile GET ->', r5.status_code, r5.get_json())
