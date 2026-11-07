# Trig Blitz!

A 60-second mental trigonometry game for the mathematics club. Players make an account, race the clock, and compete on a monthly and an all-time leaderboard. It is the trig sibling of Math Blitz, with the same comic-book look and the same server.

No npm packages are needed. You only need Node.js 18 or newer.

## How a ranked game works

- The clock runs for 60 seconds after a 3-2-1 countdown.
- Players type the answer; it goes through the instant it's right. There is no Enter key and no wrong-answer penalty, only lost time.
- Every answer is a whole number. **Angles are always answered in degrees.** No calculators.
- Space (or the Skip button) skips a problem, but freezes the player for 2 seconds.
- Problems get harder as the player gets more right, and harder ones are worth more:

| Level | Unlocks after | Points each | Problems |
|---|---|---|---|
| 1 | start | 1 | complements, supplements, third angle of a triangle, `n × sin 30°`, `n × cos 60°`, `n × tan 45°` |
| 2 | 8 correct | 2 | sums of exact values, Pythagorean triples, SOH-CAH-TOA with a ratio, 30-60-90 and 45-45-90 triangles, π/n in degrees, `arcsin(1/2) + 25°` |
| 3 | 20 correct | 3 | reference and coterminal angles, radians both ways, `sin θ = −√3/2 in QIII`, `arccos(−1/2)`, `n × sin² 60°`, `n × (sin² x + cos² x)`, triangle area ½ab sin C, period of sine and cosine |
| 4 | 35 correct | 4 | law of cosines (60° and 120°), law of sines, angles past one turn like `12 × sin 750°`, double-angle and cofunction identities, max and min of `a sin(bx) + c`, period of tan, bigger Pythagorean triples |

The leaderboard ranks by points. Each player's best score counts. The monthly board resets on the 1st, using Philippine time (change it with the `TIMEZONE` setting).

Practice mode lets players pick topics (angles and radians, exact values, triangles, inverse functions and quadrants, identities and graphs), a level, and 30 s, 60 s or 2 minutes. Practice scores are not saved.

## No repeated problems

Problems are generated on the spot, not pulled from a fixed list. Every problem gets a fingerprint.

- Within a game, a problem never appears twice.
- Across games, the server remembers the last 5,000 problems each player has seen and avoids all of them. Each level has thousands of distinct problems, so repeats are very rare.
- Every answer is a whole number from 1 up, so players never type a minus sign, a decimal or a fraction.
- The generator was checked on more than 220,000 problems by parsing the text each player would see and recomputing the answer independently with floating-point trigonometry. There were no mismatches.

## Cheating protection

The server creates each ranked game's problems and keeps its own copy. When the game ends, the server replays every answer and rejects the score if an answer is wrong, if answers came in faster than a person can type (under 0.1 s apart), if someone answered during a skip freeze, or if the game finished faster than real time allows.

This stops the easy tricks, like editing a score in the browser. A determined student who can write code could still script the game, since the browser needs the answers to check them instantly. For a club leaderboard this is a reasonable trade for a game that feels instant.

## Running it on one computer or over Wi-Fi

1. Install Node.js (the LTS version) from nodejs.org.
2. Unzip this folder.
3. Open the folder in File Explorer, click the address bar, type `cmd`, and press Enter. A command window opens in the right folder.
4. Run:
   ```
   node server.js
   ```
5. Open the address it prints. On this computer, that's `http://localhost:3000`. Other devices on the same Wi-Fi use the "Same Wi-Fi" address. If Windows asks about the firewall, allow access on **Private** networks.

Accounts and scores are saved in `data/db.json`. Back up that file to keep them.

## Hosting it online

See `RENDER-DEPLOY.md`, a step-by-step guide to GitHub, Upstash and Render, all free. Render's free tier wipes files on every restart, so online hosting keeps accounts and scores in a free Upstash Redis database.

If you also host Math Blitz, both games can share one Upstash database. Trig Blitz stores its data under the `tb:` prefix, so nothing collides.

## Club officer tools

Set an `ADMIN_KEY` (any long password) when starting the server:

```
set ADMIN_KEY=choose-a-long-secret
node server.js
```

(On Render, add it as an environment variable instead.) Then open `/admin.html` to:

- reset a player's password (it also signs them out everywhere),
- remove a player from every leaderboard,
- delete an account so the username is free again.

Without `ADMIN_KEY`, the admin page is switched off.

## Settings

| Setting | What it does | Default |
|---|---|---|
| `PORT` | port to listen on | 3000 |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | store data in Upstash instead of a local file | not set |
| `DATA_DIR` | folder for the local data file | `./data` |
| `ADMIN_KEY` | turns on `/admin.html` | not set |
| `TIMEZONE` | when the monthly board rolls over | `Asia/Manila` |

Game rules (60 s, 2 s skip freeze, level thresholds) are at the top of `server.js` and in `public/generator.js`. To add a new kind of problem, write a small function in `generator.js` that returns `{ op, text, answer, key }` and add it to a tier's `makers` list.

## Files

```
trig-blitz/
├── server.js            accounts, game checking, leaderboards, admin
├── storage.js           local file storage or Upstash Redis (keys start with tb:)
├── package.json
├── README.md
├── RENDER-DEPLOY.md     how to put it online
└── public/
    ├── index.html       the game
    ├── generator.js     trig problem generator (used by the server and the browser)
    └── admin.html       club officer tools
```
