# Put Trig Blitz online (free): GitHub + Upstash + Render

Three free services, each with one job:

| Service | Job |
|---|---|
| **GitHub** | Stores the game's code. |
| **Upstash** | Stores accounts and scores. Render's free plan erases its own files on every restart, so without this everyone's accounts would vanish. |
| **Render** | Runs the game and gives you a public link like `https://trig-blitz.onrender.com`. |

Plan for about 30 minutes the first time. You never need to type a command.

**Before you start:** unzip `trig-blitz.zip` somewhere you can find it. You should see `server.js`, `storage.js`, `package.json` and a `public` folder inside.

---

## Step 1. Make the database (Upstash)

1. Go to **upstash.com** and sign up (a Google or GitHub login works).
2. Create a new **Redis** database.
   - Name: `trig-blitz` (any name works).
   - Region: pick one close to your players. **Singapore** is closest to the Philippines.
   - Plan: **Free**.
3. Open the database. Find the **REST API** section and copy two values into a notepad:
   - `UPSTASH_REDIS_REST_URL` (starts with `https://`)
   - `UPSTASH_REDIS_REST_TOKEN` (a long string)

Use the normal token, not the "read-only" one. Keep the token private, because anyone who has it can edit your scores.

> **Already hosting Math Blitz?** Upstash's free plan allows **one** database, and you can share it. Trig Blitz saves everything under its own `tb:` prefix and Math Blitz uses `mb:`, so accounts and scores never mix. Just reuse the same two values in Step 3.

## Step 2. Put the code on GitHub

1. Sign up at **github.com** if you don't have an account.
2. Click **+** (top right) → **New repository**. Name it `trig-blitz`, leave it Public or Private, and click **Create repository**.
3. On the empty repository page, click **uploading an existing file**.
4. Open the unzipped folder, select **everything inside it** (`server.js`, `storage.js`, `package.json`, `README.md`, `RENDER-DEPLOY.md` and the `public` folder), and drag it all into the browser page. Wait until every file finishes uploading.
5. Click **Commit changes**.

**Check this carefully.** On the repository's front page you must see `server.js`, `storage.js`, `package.json` and a folder called `public` right at the top. And inside `public` there must be `index.html`, `generator.js` and `admin.html`.

If you see only one folder called `trig-blitz`, or `index.html` sitting next to `server.js` instead of inside `public`, the structure is wrong and the site will say "Not found". Delete the repository and upload again, this time dragging the contents of the folder, not the folder itself.

## Step 3. Run it on Render

1. Sign up at **render.com**. Choose **Sign in with GitHub**, which also lets Render see your repository.
2. Click **New +** → **Web Service**, then pick your `trig-blitz` repository.
3. Fill in the settings:

   | Setting | Value |
   |---|---|
   | Name | `trig-blitz` (this becomes your link) |
   | Region | the same area as your Upstash database (Singapore) |
   | Branch | `main` |
   | Runtime / Language | **Node** |
   | Build Command | `npm install` |
   | Start Command | `node server.js` |
   | Instance Type | **Free** |

4. Open **Environment Variables** and add these:

   | Name | Value |
   |---|---|
   | `UPSTASH_REDIS_REST_URL` | the URL from Step 1 |
   | `UPSTASH_REDIS_REST_TOKEN` | the token from Step 1 |
   | `ADMIN_KEY` | a long password only you know. **Needed for the teacher tools** at `/admin.html` |
   | `TIMEZONE` | optional, like `Asia/Singapore`. It decides what "today" is on the Recitation page. The default is `Asia/Manila`. |

5. Click **Create Web Service**. Render builds it, which takes a few minutes. When the page says **Live**, your link is at the top of the page.

## Step 4. Check that it really works

1. On Render, open the **Logs** tab. Near the top you should see:

   ```
   TRIG BLITZ is running!
   Storage: Upstash Redis
   ```

   If it says `Storage: local file` with a warning, the two Upstash variables are missing or misspelled. Fix them under **Environment**, and Render redeploys by itself.
2. Open your `.onrender.com` link, create a test account and play a practice game, then a ranked one. Your score should appear on the leaderboards (the boards refresh every 15 seconds).
3. In Render, use **Manual Deploy → Restart service**, then reload the site and sign in again. The account and score should still be there. That proves the database is working.

**Done.** Send the link to your students.

---

## Things to know

- **The first visit can be slow.** A free Render service falls asleep after **15 minutes** without visitors, and waking it takes about **a minute**. Open the site yourself a few minutes before an event. If the game shows "Can't reach the server", wait a minute and reload.
- **Free hours.** Render gives each account **750 free instance hours a month**. That covers one service running all month, and a sleeping service doesn't use hours. Math Blitz and Trig Blitz together are fine because they sleep when nobody plays.
- **Upstash limits.** The free plan includes **500,000 commands a month** and **one database**. A game uses about 8 commands, and the leaderboards are worked out once every 15 seconds no matter how many students look, so 100 students over 4 days stays far below the limit.
- **Updating the game.** Change a file on GitHub (open it, click the pencil icon, then **Commit changes**) or upload new files. Render redeploys automatically. Accounts and scores live in Upstash, so they survive every update.
- **Teacher tools.** With `ADMIN_KEY` set, open `your-link/admin.html` to see every section's boards, edit or delete profiles, reset passwords, enter recitation and download CSV records.
- **Before the event.** Open the admin page, go to **Tools** and press **Reset all scores** to wipe test scores. Delete any test accounts under **Profiles**.
- **School Wi-Fi.** A whole class shares one public address. Wrong passwords are counted per account, so a few typos won't lock anyone else out.
- **Sign-in rush.** If 100 students sign in at the very same minute, the last few may wait a few seconds on the free tier. Letting classes start a few minutes apart helps. Signing in is only needed once per device, because logins last 30 days.
- **Keep it awake.** Open the site yourself 5 minutes before each class, or use a free uptime pinger on `your-link/healthz` during the event.
- **A fresh start.** To wipe everything, delete the Upstash database, create a new one, and update the two variables on Render.

## If something goes wrong

| What you see | Likely cause and fix |
|---|---|
| "Not found" on the website | The `public` folder is in the wrong place on GitHub. Re-check Step 2. |
| Build fails on Render | Check Build Command is `npm install` and Start Command is `node server.js`. |
| Logs say `Storage: local file` | `UPSTASH_REDIS_REST_URL` or `UPSTASH_REDIS_REST_TOKEN` is missing or has a typo. Copy them again without extra spaces. |
| Accounts disappear after a while | Same as above: the game is saving to Render's temporary disk instead of Upstash. |
| "Can't reach the server" | The service was asleep. Wait a minute and reload. |
| Scores say "was not saved" | The game took too long to submit or lost its connection. Play another game. |
| Upstash errors in the logs | You may have copied the read-only token. Use the regular one. |

## Playing without putting it online

To run it on one computer, or for people on the same Wi-Fi, install Node.js (the LTS version) from nodejs.org, open a command window in the game's folder and run `node server.js`. It prints the addresses to open. Accounts and scores are then saved in `data/db.json`.
