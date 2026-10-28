# Manufacturing Research Lab: setup (about 20 minutes)

## 1. Supabase
Create a project, open SQL Editor, paste `schema.sql`, run it. **If you already ran an older version, run `migrate_v2.sql` instead.** Copy the Project URL and the service_role key (Settings, API). The service key stays on the server only.

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
| ALLOW_OVERSEAS | optional, default true. Set false for Indian suppliers only |
| DELIVERY_LOCATION | optional, default Delhi NCR. Used only for shipping quotes, never to filter suppliers |
| READINESS_THRESHOLD | optional, default 99 |
| DAILY_TOKEN_CAP | optional, default 300000 |
| LABOUR_INR_PER_MIN | optional, default 5 (₹300 per hour) |

Generate a public domain under Settings, Networking.

## 3. cron-jobs.org
Create a job: URL `https://YOUR-APP.up.railway.app/api/run?key=YOUR_CRON_SECRET`, timezone Asia/Kolkata. Two runs a day (06:00, 18:00) is the minimum; four a day gets through the first cycle faster. The app replies "started" at once and works in the background.

## 4. Open the dashboard
Visit your Railway URL on your phone. Username: anything. Password: DASHBOARD_PASSWORD. Tap Run now to test.

## How each idea moves
Learn, Options, Ideas (brainstorm six bold ideas, then test them against sources), Simulate, Stress-test, then Supplier pilot. If the numbers fail three times, the idea is dropped and a new one is brainstormed.

## Good to know
- "Sourced" means a claim traces to a link, not that it is confirmed. Only your own written quotes and tests count as verified.
- Overseas suppliers are flagged and should carry import costs (duty, GST, freight, clearance).
- Savings come from simulated estimates, never from supplier quotes. The supplier stage is last and outreach is done by you.
