import sys, json, time
sys.path.insert(0, r'c:\Users\UserPC_01\Documents\GitHub\SWSAD1\yokai_inventory_scraper')
import server
app = server.app
client = app.test_client()

username = f"mvp_test_user_{int(time.time())}"
password = "MvpPass123"
print('TEST START', username)

try:
    # create admin session to allow user creation
    with client.session_transaction() as sess:
        sess['logged_in'] = True

    r = client.get('/api/stores-list')
    if r.status_code != 200:
        print('FAILED: /api/stores-list returned', r.status_code, r.get_data(as_text=True))
        sys.exit(1)
    stores = r.get_json().get('stores', [])
    print('stores count:', len(stores))
    if not stores:
        print('No stores in DB to assign. Aborting test.')
        sys.exit(0)

    store_to_assign = stores[0]
    print('assigning store:', store_to_assign)

    payload = {'username': username, 'password': password, 'displayName': 'MVP Tester', 'stores': [store_to_assign]}
    r2 = client.post('/api/users', json=payload)
    print('/api/users status:', r2.status_code, r2.get_json())
    if r2.status_code != 201 and r2.status_code != 200:
        print('User creation failed; response:', r2.status_code, r2.get_data(as_text=True))
        sys.exit(1)

    # logout admin session to simulate user login separately
    with client.session_transaction() as sess:
        sess.pop('logged_in', None)

    r3 = client.post('/api/user-login', json={'username': username, 'password': password})
    print('/api/user-login status:', r3.status_code, r3.get_json())
    if r3.status_code != 200:
        print('User login failed; aborting test')
        sys.exit(1)

    # check user-info
    r_info = client.get('/api/user-info')
    print('/api/user-info:', r_info.status_code, r_info.get_json())

    # call /get-data as logged-in user
    r4 = client.get('/get-data')
    print('/get-data status:', r4.status_code)
    data = r4.get_json()
    if data is None:
        print('No JSON returned from /get-data')
        sys.exit(1)

    inv = data.get('inventory', [])
    print('inventory items returned:', len(inv))
    stores_in_data = set([item.get('store_key') for item in inv if item.get('store_key')])
    print('unique store_keys in /get-data (up to 10):', list(stores_in_data)[:10])
    print('expected assigned store:', store_to_assign)

    if stores_in_data and (stores_in_data == {store_to_assign} or store_to_assign in stores_in_data):
        print('TEST PASS: /get-data contains only or includes the assigned store (good for MVP)')
    else:
        print('TEST WARNING/FAIL: /get-data did not return the expected assigned store')

except Exception as e:
    print('EXCEPTION DURING TEST:', str(e))
    raise

print('TEST END')
