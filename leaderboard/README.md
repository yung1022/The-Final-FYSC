Top 50 Leaderboard

Files:
- index.html — main page
- style.css — styling
- script.js — fetches data and renders top 50

Usage:
1. Serve the `leaderboard/` folder with a static server (or open `index.html` in a browser).
2. The page fetches the Vercel API at `/api/leaderboard/top50`.

API routes:
- `POST /api/leaderboard` adds a user.
- `POST /api/leaderboard/update` updates an existing user using the same JSON body.
- `PUT /api/leaderboard/:userId` also updates an existing user.
- `GET /api/leaderboard/top50` returns the sorted top 50.

Each request should include `name`, numeric `subscribers`, `growth`, `video`, `short`, and `userId`.

Persistence:
- The API stores entries in Firebase Realtime Database under `/leaderboard`.
- Set the Vercel environment variable `FIREBASE_DB_URL` to your Firebase database URL. If omitted, the project uses the existing FYSC database URL.

Notes:
- Firebase Realtime Database rules must allow the deployed API to read and write `/leaderboard`.
- The leaderboard refreshes every 15 seconds and sorts by `subscribers` descending.
