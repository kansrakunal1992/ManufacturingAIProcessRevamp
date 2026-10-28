const {createClient}=require('@supabase/supabase-js');
const sb=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_KEY);
const CANDS=require('./candidates');
const TH=(+process.env.READINESS_THRESHOLD||99)/100,CAP=+process.env.DAILY_TOKEN_CAP||300000,RATE=+process.env.LABOUR_INR_PER_MIN||5;
const RULES=`You are a skeptical manufacturing cost-reduction analyst advising a beginner in India (first-test budget max ₹50,000, Delhi NCR). Use ONLY facts found in the provided search results and cite their exact URLs. Never invent suppliers, prices, contacts, certifications or savings. Label every claim category: verified (backed by a provided URL), estimate, or ai_hypothesis. Allow that the current method may already be best. Avoid safety-critical uses. Reply with ONE JSON object only. Always include "plain": two short everyday-language sentences for a non-engineer saying what you found.`;
async function llm(system,user){
 const r=await fetch((process.env.DEEPSEEK_BASE_URL||'https://api.deepseek.com')+'/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+process.env.DEEPSEEK_API_KEY},body:JSON.stringify({model:process.env.DEEPSEEK_MODEL||'deepseek-chat',temperature:0.2,messages:[{role:'system',content:system},{role:'user',content:user}]})});
 const j=await r.json();if(!r.ok)throw new Error(j.error?.message||'DeepSeek '+r.status);
 const m=(j.choices[0].message.content||'').match(/\{[\s\S]*\}/);if(!m)throw new Error('Model returned no JSON');
 return {data:JSON.parse(m[0]),tokens:j.usage?.total_tokens||0};
}
async function search(q){
 if(!process.env.SEARCH_API_KEY)return [];
 const r=await fetch('https://api.tavily.com/search',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+process.env.SEARCH_API_KEY},body:JSON.stringify({query:q,max_results:5})});
 const j=await r.json();return (j.results||[]).map(x=>({title:x.title,url:x.url,text:(x.content||'').slice(0,500)}));
}
const S=async(...q)=>(await Promise.all(q.map(search))).flat();
const tri=(a,m,b)=>{const u=Math.random(),c=(m-a)/((b-a)||1);return u<c?a+Math.sqrt(u*(b-a)*(m-a)):b-Math.sqrt((1-u)*(b-a)*(b-m));};
const R=x=>{if(x&&typeof x==='object'){const v=[+x.min||0,+(x.mode??x.min)||0,+(x.max??x.mode)||0].sort((a,b)=>a-b);return {min:v[0],mode:v[1],max:v[2],src:x.src};}return {min:+x||0,mode:+x||0,max:+x||0};};
// Deterministic maths in code (not by the AI): Monte Carlo over the AI's sourced ranges.
function simulate(a){
 const K=[['baseline','cost_per_part'],['baseline','labour_min'],['alt','cost_per_part'],['alt','finishing_per_part'],['alt','labour_min'],['alt','scrap_rate'],['alt','setup_cost'],['alt','shipping_total'],['alt','inspection_total']];
 const g=i=>R((a[K[i][0]]||{})[K[i][1]]),Q=R(a.quantity);
 const sourced=[...K.map((_,i)=>g(i)),Q].filter(x=>/^https?:/.test(x.src||'')).length/(K.length+1);
 const one=w=>{const v=(r,hi)=>w?(hi?r.max:r.min):tri(r.min,r.mode,r.max);
  const q=Math.max(1,w?Q.min:v(Q)),bp=v(g(0))+v(g(1))*RATE,sc=Math.min(.9,v(g(5),1));
  const av=(v(g(2),1)+v(g(3),1)+v(g(4),1)*RATE)/(1-sc)+(v(g(7),1)+v(g(8),1))/q,setup=v(g(6),1);
  return {bp,ac:av+setup/q,be:bp>av?setup/(bp-av):null,t:v(g(1))-v(g(4),1)};};
 const N=5000,s=[],be=[],t=[];let win=0;
 for(let i=0;i<N;i++){const o=one(false),p=(o.bp-o.ac)/(o.bp||1);s.push(p*100);if(p>0)win++;if(o.be)be.push(o.be);t.push(o.t);}
 const pc=(x,p)=>{x.sort((a,b)=>a-b);return x.length?x[Math.floor(p*(x.length-1))]:null;},w=one(true);
 return {winProb:win/N,p10:pc(s,.1),p50:pc(s,.5),p90:pc(s,.9),pessimistic:(w.bp-w.ac)/(w.bp||1)*100,breakeven:pc(be,.5),timeSavedMin:pc(t,.5),sourced,at:new Date().toISOString()};
}
function gate(sim,stress){const f=[];
 if(sim.winProb<TH)f.push(`Cheaper in only ${Math.round(sim.winProb*100)}% of simulations (needs ${Math.round(TH*100)}%)`);
 if(sim.pessimistic<=0)f.push('Worst-case inputs show no saving');
 if(stress.safety_flag)f.push('Safety or regulatory concern still open');
 if(sim.sourced<.6)f.push('Too many inputs are guesses (need 60% backed by sources)');
 return f;}
async function saveEv(c,out,res){
 const urls=new Set(res.map(r=>r.url));
 const rows=(out.evidence||[]).slice(0,10).map(e=>({candidate_id:c.id,claim:String(e.claim||'').slice(0,300),category:e.category==='verified'&&urls.has(e.url)?'verified':e.category==='estimate'?'estimate':'ai_hypothesis',url:urls.has(e.url)?e.url:null,confidence:e.confidence||'low'}));
 if(rows.length)await sb.from('evidence').insert(rows);
}
const A3='{min,mode,max,src} where src is a search-result URL or "estimate"';
async function runOnce(){
 const now=new Date(),day=now.toISOString().slice(0,10);
 const {data:t}=await sb.from('runs').select('tokens').gte('started_at',day);
 if((t||[]).reduce((a,r)=>a+(r.tokens||0),0)>=CAP){await sb.from('runs').insert({status:'skipped',plain:'Skipped: today’s AI usage limit was reached. It resumes tomorrow.',finished_at:now});return;}
 for(const c of CANDS)await sb.from('candidates').upsert({id:c.id,name:c.name},{onConflict:'id',ignoreDuplicates:true});
 const {data:cs}=await sb.from('candidates').select('*').not('stage','in','(pilot_ready,rejected)').order('updated_at',{ascending:true}).limit(1);
 const row=cs&&cs[0];if(!row)return;
 const c=CANDS.find(x=>x.id===row.id),k=row.state||{};
 const {data:run}=await sb.from('runs').insert({candidate_id:c.id,stage:row.stage}).select().single();
 let tokens=0,plain,stage=row.stage,status='ok',error=null,readiness=row.readiness;
 const A=async(task,res)=>{
  const user=`CANDIDATE: ${c.name}\nProduct: ${c.product}\nBaseline: ${c.base}\nAlternatives: ${c.alts}\nLimits: ${c.limits}\n\nTASK: ${task}\n\nPRIOR STATE: ${JSON.stringify(k).slice(0,6000)}\n\nSEARCH RESULTS (only citable sources):\n${res.map((r,i)=>`[${i}] ${r.title} ${r.url}\n${r.text}`).join('\n')||'(none: mark everything estimate or ai_hypothesis)'}`;
  const o=await llm(RULES,user);tokens+=o.tokens;await saveEv(c,o.data,res);return o.data;};
 try{
  if(stage==='learn'){const o=await A('LEARN. Explain what the part does, how it is made and what drives cost. JSON {plain,summary,cost_drivers:[],must_not_compromise:[],evidence:[{claim,category,url,confidence}]}',await S(`${c.name} how manufactured cost drivers`,`${c.product} manufacturing India`));k.learn=o;stage='options';plain=o.plain;}
  else if(stage==='options'){const o=await A('OPTIONS. List technically plausible cheaper ways, including that the current method may be best. JSON {plain,options:[{name,how,not_suitable_when,setup_cost_inr}],current_may_be_best,evidence:[]}',await S(`${c.alts} India`,`${c.name} cost reduction alternative process`));k.options=o;stage='simulate';plain=o.plain;}
  else if(stage==='simulate'){const o=await A(`SIMULATE. Give cost and time ranges in ₹ and minutes per part for the baseline and the best alternative, plus order quantity. Include every hidden cost listed in stress.hidden_costs_missing. Use wide ranges when unsure. JSON {plain,assumptions:{baseline:{cost_per_part,labour_min},alt:{cost_per_part,finishing_per_part,labour_min,scrap_rate,setup_cost,shipping_total,inspection_total},quantity},evidence:[]} where each value is ${A3}`,await S(`${c.name} price per piece India`,`${c.alts} cost per piece`));
   k.prevSim=k.sim;k.assumptions=o.assumptions;k.sim=simulate(o.assumptions||{});readiness=Math.round(k.sim.winProb*100);stage='stress';
   plain=`${o.plain} Simulation: cheaper in ${readiness}% of ${5000} scenarios, typical saving ${Math.round(k.sim.p50)}%.`;}
  else if(stage==='stress'){const o=await A('STRESS-TEST. Try to prove this idea is not worth pursuing: demand, tooling, hidden costs, safety. JSON {plain,fail_reasons:[],unknowns:[],hidden_costs_missing:[],safety_flag:boolean,safety_note}',[]);
   k.stress=o;k.gateFails=gate(k.sim,o);k.todos=(o.unknowns||[]).slice(0,3);stage=k.gateFails.length?'simulate':'pilot';
   plain=`${o.plain} ${k.gateFails.length?'Not ready yet: '+k.gateFails[0]+'. Going back to refine the numbers.':'All checks passed, moving to the supplier pilot step.'}`;}
  else if(stage==='pilot'){const res=await S(`${c.alts} manufacturer India`,`${c.name} supplier Delhi NCR`);const o=await A('PILOT. Shortlist real Indian suppliers found in the results only, and draft a short quote request asking for unit price, setup, finishing, minimum order, taxes, shipping to Delhi NCR, lead time and reject rate at several quantities. JSON {plain,suppliers:[{name,website,city,process,evidence_url,small_batch}],quote_request_message,questions_for_suppliers:[]}',res);
   const hosts=res.map(r=>r.url);o.suppliers=(o.suppliers||[]).filter(s=>hosts.includes(s.evidence_url));k.pilot=o;k.todos=['Review the supplier shortlist','Send the quote request to three suppliers','Record the quotes and dates you receive'];stage='pilot_ready';plain=o.plain;}
 }catch(e){status='failed';error=String(e.message||e);plain='This run hit an error and stopped safely. Nothing was changed.';}
 if(status==='ok')await sb.from('candidates').update({stage,readiness,state:k,updated_at:new Date()}).eq('id',c.id);
 else await sb.from('candidates').update({updated_at:new Date()}).eq('id',c.id);
 await sb.from('runs').update({finished_at:new Date(),status,plain,tokens,error,outcome:{from:row.stage,to:stage,readiness}}).eq('id',run.id);
}
module.exports={sb,runOnce,TH};
