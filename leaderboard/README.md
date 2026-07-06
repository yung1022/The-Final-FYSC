Top 50 Leaderboard

Files:
- index.html — main page
- style.css — styling
- script.js — fetches data and renders top 50

Usage:
1. Serve the `leaderboard/` folder with a static server (or open `index.html` in a browser).
2. The page fetches data from the Realtime Database at `https://final-fysc-default-rtdb.asia-southeast1.firebasedatabase.app/` using the REST `/.json` endpoint.

Notes:
- The script expects entries under the database root. Each entry should include a name and a numeric subscriber field (common keys: `subscriberCount`, `subscribers`, `subs`).
- If your data is under a nested path (for example `/channels/`), update `DB_URL` in `script.js` to point at `.../channels.json`.
