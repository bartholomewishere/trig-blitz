# Trig Blitz!

A 60-second mental trigonometry game for a class event. Students make an account, race the clock, and compete on an all-time board plus section, group and recitation boards. It is the trig sibling of Math Blitz, with the same comic-book look and the same server.

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

Every board ranks by points, and each student's best score is the one that counts.

Practice mode lets players pick topics (angles and radians, exact values, triangles, inverse functions and quadrants, identities and graphs), a level, and 30 s, 60 s or 2 minutes. Practice scores are not saved.

## No repeated problems

Problems are generated on the spot, not pulled from a fixed list. Every problem gets a fingerprint.

- Within a game, a problem never appears twice.
- Across games, the server remembers the last 5,000 problems each player has seen and avoids all of them. Each level has thousands of distinct problems, so repeats are very rare.
- Every answer is a whole number from 1 up, so players never type a minus sign, a decimal or a fraction.
- The generator was checked on more than 220,000 problems by parsing the text each player would see and recomputing the answer independently with floating-point trigonometry. There were no mismatches.

## Cheating protection

The server creates each ranked game's problems and keeps its own copy. When the game ends, the server replays every answer and rejects the score if an answer is wrong, if answers came in faster than a person can type (under 0.1 s apart), if someone answered during a skip freeze, or if the game finished faster than real time allows.

This stops the easy tricks, like editing a score in the browser. A determined student who can write code could still script the game, since the browser needs the answers to check them instantly. For a class leaderboard this is a reasonable trade for a game that feels instant.

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

## Sections, class numbers and groups

When a student creates an account they pick, from dropdowns only (nothing can be typed):

- a **section**: Aristotle, Confucius, Lao Tzu, Plato, Socrates, or **Not a student**,
- a **class number** from 01 to 39 (a tens digit 0-3 and a ones digit 0-9; 00 is blocked),
- a **group** from 1 to 6.

The server allows one account per section and class number, so there can't be two "Plato 07"s, even if someone edits the page in their browser. Class numbers that are already taken are greyed out. Students can't change these later, only the teacher can (admin page, Profiles).

Accounts made before this update have no section and count as "Not a student". Delete them or move them from the admin page.

## Leaderboards

| Board | Who sees it | What it shows |
|---|---|---|
| **All time** | everyone | every player's best score |
| **My Section** | students, their own section only | each student's rank and best score (username only) |
| **My Groups** | students, their own section only | the 6 groups, ranked by average |
| **Section Showdown** | students | the sections, ranked by average. A section with no scores yet is left out |
| **Recitation** | students, their own section only | each student's total recitations, entered by the teacher |

"Not a student" accounts can play and appear on the all-time board, and see nothing else.

**How averages work.** A group's or section's average is the total of its students' best scores divided by the number of **registered** students, so someone who hasn't played counts as 0. Each row shows the total and "played of registered" next to the average. Tied scores share a rank.

**Who can see what is enforced on the server.** The page hides tabs, but the server also refuses a request for a board the student isn't allowed to see.

**Load.** Boards are worked out once and reused for 15 seconds, so 100 students looking at them costs the database the same as one student.

## Sign-in limits

School Wi-Fi puts a whole class behind one public address, so wrong passwords are counted **per account** (8 tries, then a 10-minute wait), not per address. "Username taken" is never counted. Each address also has a high ceiling (300 failures per 10 minutes) to stop scripted floods. Passwords are hashed without blocking the server, so many students signing in at once don't freeze each other.

## Teacher tools

Set an `ADMIN_KEY` (any long password) when starting the server:

```
set ADMIN_KEY=choose-a-long-secret
node server.js
```

(On Render, add it as an environment variable instead.) Then open `/admin.html`. The key is remembered only until you close the tab. There are four tabs:

- **Leaderboards**: Section Showdown for all five sections, then, for any section you pick, the student ranking, the group ranking and the recitation ranking. Also the top 50 all-time.
- **Profiles**: pick a section and see all 39 class numbers, taken or empty, with username, group, best score and games. For each profile: **Edit** (section, class number, group; taken seats can't be picked), **Reset password** (also signs them out everywhere), **Zero score** and **Delete** (frees the seat and the username). "Not a student" lists the accounts that have no section.
- **Recitation**: pick a section and a day, type how many times each class number recited, and save. Saving again for the same day replaces it, so fixing a mistake is easy. Students see usernames, never class numbers.
- **Tools**: download CSV records (profiles and scores, recitation by day), **Reset all scores** (run it before the event; accounts are kept) and **Clear recitation**.

Without `ADMIN_KEY`, the admin page is switched off.

## Settings

| Setting | What it does | Default |
|---|---|---|
| `PORT` | port to listen on | 3000 |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | store data in Upstash instead of a local file | not set |
| `DATA_DIR` | folder for the local data file | `./data` |
| `ADMIN_KEY` | turns on `/admin.html` | not set |
| `TIMEZONE` | what "today" means on the Recitation page | `Asia/Manila` |

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
    └── admin.html       teacher tools
```
