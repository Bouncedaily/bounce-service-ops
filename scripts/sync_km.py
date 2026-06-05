import json, requests, os, sys
from datetime import date, timedelta

SUPABASE_URL = os.environ['SUPABASE_URL']
SUPABASE_KEY = os.environ['SUPABASE_KEY']
METABASE_URL = os.environ['METABASE_URL']

yesterday = str(date.today() - timedelta(days=1))
print(f"Syncing data for: {yesterday}")

res = requests.get(METABASE_URL, timeout=300)
print(f"Metabase status: {res.status_code}, size: {len(res.content)} bytes")
raw = res.json()
print(f"Total rows: {len(raw)}")

if raw:
    print(f"Sample keys: {list(raw[0].keys())}")

rows = []
for r in raw:
    row_date = str(r.get('Date') or r.get('date') or '').split('T')[0]
    if row_date != yesterday:
        continue
    rows.append({
        'id': r.get('ID') or r.get('id'),
        'booking_id': r.get('Booking ID') or r.get('booking_id'),
        'bike_id': str(r.get('Bike ID') or r.get('bike_id') or ''),
        'date': row_date,
        'starting_odo': r.get('Starting Odo') or r.get('starting_odo'),
        'ending_odo': r.get('Ending Odo') or r.get('ending_odo'),
        'km_run_for_the_day': r.get('Km Run For The Day') or r.get('km_run_for_the_day'),
        'starting_soc': r.get('Starting Soc') or r.get('starting_soc'),
        'ending_soc': r.get('Ending Soc') or r.get('ending_soc'),
        'soc_delta': r.get('Soc Delta') or r.get('soc_delta'),
    })

print(f"Rows for {yesterday}: {len(rows)}")

if not rows:
    print("No rows for yesterday")
    sys.exit(0)

headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': f'Bearer {SUPABASE_KEY}',
    'Content-Type': 'application/json',
    'Prefer': 'resolution=merge-duplicates'
}

for i in range(0, len(rows), 1000):
    batch = rows[i:i+1000]
    r = requests.post(f"{SUPABASE_URL}/rest/v1/km_run_everyday", json=batch, headers=headers)
    print(f"Batch {i//1000+1}: {r.status_code}")
    if r.status_code not in (200, 201):
        print(f"Error: {r.text[:300]}")

r = requests.post(f"{SUPABASE_URL}/rest/v1/rpc/update_running_km_from_daily", json={}, headers=headers)
print(f"Running km update: {r.status_code}")
print("Done!")
