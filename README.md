# Manufacturing Research Lab: setup (about 20 minutes)

## 1. Supabase
Create a project, open SQL Editor, paste `schema.sql`, run it. Copy the Project URL and the service_role key (Settings, API). The service key stays on the server only.

## 2. Railway
Push this folder to a GitHub repo, then New Project, Deploy from GitHub. Add these variables:

| Variable | Value |
|---|---|
| DEEPSEEK_API_KEY | your DeepSeek key |
| DEEPSEEK_MODEL | model name from the DeepSeek docs (default deepseek-chat) |
| SEARCH_API_KEY | Tavily key (tavily.com) |
| SUPABASE_URL / SUPABASE_SERVICE_KEY | from step 1 |
| CRON_SECRET | any long random string |
| DASHBOARD_PASSWORD | your dashboard password |
| READINESS_THRESHOLD | optional, default 99 |
| DAILY_TOKEN_CAP | optional, default 300000 |
| LABOUR_INR_PER_MIN | optional, default 5 (₹300 per hour) |

Generate a public domain under Settings, Networking.

## 3. cron-jobs.org
Create a job: URL `https://YOUR-APP.up.railway.app/api/run?key=YOUR_CRON_SECRET`, timezone Asia/Kolkata, run at 06:00 and 18:00. The app replies "started" at once and works in the background.

## 4. Open the dashboard
Visit your Railway URL on your phone. Username: anything. Password: DASHBOARD_PASSWORD. Tap Run now to test.

## Good to know
- Without SEARCH_API_KEY nothing can be marked verified.
- Each run advances one idea by one step; ideas take turns, oldest first.
- Savings come from simulated estimates, never from supplier quotes. The supplier stage is last and outreach is done by you.
