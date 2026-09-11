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
- `PUT /api/leaderboard/:userId` updates an existing user only.
- `GET /api/leaderboard/top50` returns the sorted top 50.

Each request should include `name`, numeric `subscribers`, `growth`, `video`, `short`, `offlineduration`, and `userId`. `offlineduration` must be the Unix timestamp in seconds when the data is sent. Discord `userId` and `guildId` values must be JSON strings, not numbers, because Discord snowflake IDs can be rounded when parsed as numbers.

Persistence:
- The API stores entries in Firebase Realtime Database under `/leaderboard`.
- Set the Vercel environment variable `FIREBASE_DB_URL` to your Firebase database URL. If omitted, the project uses the existing FYSC database URL.

Notes:
- Firebase Realtime Database rules must allow the deployed API to read and write `/leaderboard`.
- The leaderboard refreshes every 15 seconds and sorts by `subscribers` descending.
- Offline growth is calculated in the browser as `growth * (1 - 0.9999 ^ (0.2 * (currentUnixTime - offlineduration)))` and is not written back to Firebase.
