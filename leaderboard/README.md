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
- `GET /api/leaderboard` returns every user, ranked.
- `GET /api/leaderboard/top50` returns the top 50, ranked.

Each request should include `name`, `image` (an image URL), numeric `subscribers`, `growth`, `video`, `short`, `offlineduration`, and `userId`. `offlineduration` must be the Unix timestamp in seconds when the data is sent. Discord `userId` and `guildId` values must be JSON strings, not numbers, because Discord snowflake IDs can be rounded when parsed as numbers.

Persistence:
- The API stores entries in Firebase Realtime Database under `/leaderboard`.
- Set the Vercel environment variable `FIREBASE_DB_URL` to your Firebase database URL. If omitted, the project uses the existing FYSC database URL.

Notes:
- Firebase Realtime Database rules must allow the deployed API to read and write `/leaderboard`.
- Firebase is fetched every 15 seconds. Between fetches, each player is recalculated locally at a random interval between 5 and 10 seconds using the last fetched data and current offline growth.
- Ranking uses the *displayed* subscriber count, i.e. the stored count plus offline growth. The server applies the growth formula to **every** entry and only then takes the top 50 (`sortByDisplayedSubscribers` then `slice(0, 50)` in `lib/offline-growth.js`). Sorting on the stored count before slicing would drop players whose pending growth lifts them into the top 50.
- The same formula lives in three places and they must stay in sync: `lib/offline-growth.js` (Vercel API), `leaderboard/offline-growth.js` (standalone Node server), and `calculateOfflineGrowthAt` in `leaderboard/script.js` (browser).
- The page uses the official NCS playlist `PL1rcvJR5LYrrz1XiNaDN` in a hidden autoplaying loop. Browser autoplay policies may require one interaction before audio can play.
- Offline growth is calculated in the browser as `growth * (1 - 0.9999 ^ (0.2 * (currentUnixTime - offlineduration)))` and is not written back to Firebase.
