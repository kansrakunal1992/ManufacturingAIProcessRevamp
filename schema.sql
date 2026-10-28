create table if not exists candidates(id text primary key,name text,stage text default 'learn',readiness numeric default 0,state jsonb default '{}',updated_at timestamptz default now());
create table if not exists runs(id bigserial primary key,started_at timestamptz default now(),finished_at timestamptz,candidate_id text,stage text,status text default 'running',plain text,outcome jsonb,tokens int default 0,error text);
create table if not exists evidence(id bigserial primary key,candidate_id text,claim text,category text,url text,confidence text,created_at timestamptz default now());
alter table candidates enable row level security;
alter table runs enable row level security;
alter table evidence enable row level security;
