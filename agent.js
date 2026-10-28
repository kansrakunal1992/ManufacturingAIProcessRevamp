const {createClient}=require('@supabase/supabase-js');
const sb=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_KEY);
const CANDS=require('./candidates');
const TH=(+process.env.READINESS_THRESHOLD||99)/100,CAP=+process.env.DAILY_TOKEN_CAP||300000,RATE=+process.env.LABOUR_INR_PER_MIN||5;
const OVERSEAS=(process.env.ALLOW_OVERSEAS||'true').toLowerCase()!=='false',DELIVERY=process.env.DELIVERY_LOCATION||'Delhi NCR';
const RULES=`You are a skeptical manufacturing cost-reduction analyst advising a beginner buyer in India (first-test budget max ₹50,000). Ground facts in the provided search results and cite their exact URLs. Never invent suppliers, prices, contacts, certifications or savings. Label every claim category: sourced (backed by a provided URL), estimate, or ai_hypothesis. Allow that the current method may already be best. Avoid safety-critical uses. Suppliers anywhere in India are equally welcome. ${OVERSEAS?'Overseas suppliers are also allowed, but flag them as overseas and include import costs (customs duty, import GST, freight, clearance, longer lead time, any certification needed).':'Use Indian suppliers only.'} The delivery destination (${DELIVERY}) is for shipping quotes only, never a supplier filter. Reply with ONE JSON object only. Always include "plain": two short everyday-language sentences for a non-engineer.`;
const BOLD=RULES+' For this task be inventive and lateral: you may go beyond the search results, but label such ideas ai_hypothesis. Think like a design-for-manufacture engineer borrowing tricks from other industries.';
async function llm(system,user,temp=0.2){
 const r=await fetch((process.env.DEEPSEEK_BASE_URL||'https://api.deepseek.com')+'/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+process.env.DEEPSEEK_API_KEY},body:JSON.stringify({model:process.env.DEEPSEEK_MODEL||'deepseek-chat',temperature:temp,messages:[{role:'system',content:system},{role:'user',content:user}]})});
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
// Deterministic maths in code (not by the AI): Monte Carlo over the AI's ranges.
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
// "sourced" only means the claim traces to a link in the search results. "verified" is reserved for your own written quotes and tests.
const srcType=(u,t)=>/indiamart|tradeindia|made-in-china|alibaba|aliexpress|exportersindia/.test(u)?'marketplace_listing':/gem\.gov\.in|\.gov\./.test(u)?'government_portal':['supplier_site','independent'].includes(t)?t:'supplier_site';
async function saveEv(c,out,res){
 const urls=new Set(res.map(r=>r.url));
 const rows=(out.evidence||[]).slice(0,10).map(e=>{const ok=urls.has(e.url);return {candidate_id:c.id,claim:String(e.claim||'').slice(0,300),category:['verified','sourced'].includes(e.category)&&ok?'sourced':e.category==='estimate'?'estimate':'ai_hypothesis',url:ok?e.url:null,source_type:ok?srcType(e.url,e.source_type):null,confidence:e.confidence||'low'};});
 if(!rows.length)return;
 const r=await sb.from('evidence').insert(rows);
 if(r.error)await sb.from('evidence').insert(rows.map(({source_type,...x})=>x));
}
const EV='evidence:[{claim,category,url,source_type,confidence}]';
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
 const A=async(task,res,o={})=>{
  const user=`CANDIDATE: ${c.name}\nProduct: ${c.product}\nCurrent method: ${c.base}\nKnown alternatives (a starting point, not a limit): ${c.alts}\nLimits: ${c.limits}\n\nTASK: ${task}\n\nPRIOR STATE: ${JSON.stringify(k).slice(0,6000)}\n\nSEARCH RESULTS (only citable sources):\n${res.map((r,i)=>`[${i}] ${r.title} ${r.url}\n${r.text}`).join('\n')||'(none: mark everything estimate or ai_hypothesis)'}`;
  const r=await llm(o.system||RULES,user,o.temp);tokens+=r.tokens;await saveEv(c,r.data,res);return r.data;};
 try{
  if(stage==='learn'){const o=await A(`LEARN. Explain what the part does, how it is made and what drives cost. JSON {plain,summary,cost_drivers:[],must_not_compromise:[],${EV}}`,await S(`${c.name} how manufactured cost drivers`,`${c.product} manufacturing India`));k.learn=o;stage='options';plain=o.plain;}
  else if(stage==='options'){const o=await A(`OPTIONS. Benchmark the known ways to make this cheaper, including that the current method may be best. JSON {plain,options:[{name,how,not_suitable_when,setup_cost_inr}],current_may_be_best,${EV}}`,await S(`${c.alts} India`,`${c.name} cost reduction alternative process India`));k.options=o;stage='ideas';plain=o.plain;}
  else if(stage==='ideas'){
   const d=await A(`IDEAS (divergent). Propose 6 bold, non-obvious ways to get this function far cheaper, one per lens: part consolidation; a process borrowed from another industry; replace with a standard off-the-shelf part; cut the buyer’s labour or time (jig, kit, pre-assembled); redesign geometry or material to cut waste; sell it differently (kit, bundle, repeat supply, buy-versus-make flip). Do not repeat anything in state.rejected. JSON {plain,ideas:[{name,lens,how,why_cheaper,must_be_true:[],kill_test}]}`,await S(`${c.name} innovative low cost design India`),{system:BOLD,temp:.9});
   const top=(d.ideas||[]).slice(0,4),res=await S(...top.map(i=>`${i.name} ${(i.must_be_true||[])[0]||''} India`));
   const v=await A(`IDEAS (check). Act as a skeptic. Test each idea's must_be_true claims against the search results: verdict supported, killed or unclear, one-line reason. Then choose the single boldest idea that is not killed, or null. JSON {plain,verdicts:[{name,verdict,reason}],chosen:{name,how,why_cheaper}|null,${EV}}\nIDEAS: ${JSON.stringify(top)}`,res);
   k.ideas={all:top,verdicts:v.verdicts||[],chosen:v.chosen||null};
   if(v.chosen){stage='simulate';plain=`${v.plain} Boldest idea still standing: ${v.chosen.name}.`;}
   else{k.rejected=[...(k.rejected||[]),...top.map(i=>i.name)];plain=`${v.plain} No idea survived checking, so it will brainstorm again next run.`;}}
  else if(stage==='simulate'){const alt=k.ideas?.chosen?.name||c.alts;
   const o=await A(`SIMULATE the alternative "${alt}" against the current method. Give cost and time ranges in ₹ and minutes per part, plus order quantity. Use Indian price anchors (IndiaMART, GeM) where found. Include every hidden cost in stress.hidden_costs_missing. If the alternative is sourced overseas, fold customs duty, import GST, freight and clearance into alt.shipping_total. Use wide ranges when unsure. JSON {plain,assumptions:{baseline:{cost_per_part,labour_min},alt:{cost_per_part,finishing_per_part,labour_min,scrap_rate,setup_cost,shipping_total,inspection_total},quantity},${EV}} where each value is ${A3}`,await S(`${c.name} price per piece India IndiaMART`,`${c.name} GeM price per piece`,`${alt} cost per piece India`));
   k.prevSim=k.sim;k.assumptions=o.assumptions;k.sim=simulate(o.assumptions||{});readiness=Math.round(k.sim.winProb*100);stage='stress';
   plain=`${o.plain} Simulation: cheaper in ${readiness}% of 5,000 scenarios, typical saving ${Math.round(k.sim.p50)}%.`;}
  else if(stage==='stress'){const o=await A('STRESS-TEST. Try to prove this idea is not worth pursuing: demand, tooling, hidden costs, safety. JSON {plain,fail_reasons:[],unknowns:[],hidden_costs_missing:[],safety_flag:boolean,safety_note}',[]);
   k.stress=o;k.gateFails=gate(k.sim,o);k.todos=(o.unknowns||[]).slice(0,3);
   if(!k.gateFails.length){stage='pilot';k.loops=0;plain=`${o.plain} All checks passed, moving to the supplier pilot step.`;}
   else{k.loops=(k.loops||0)+1;
    if(k.loops>=3){if(k.ideas?.chosen)k.rejected=[...(k.rejected||[]),k.ideas.chosen.name];if(k.ideas)k.ideas.chosen=null;k.loops=0;stage='ideas';plain=`${o.plain} After three tries the numbers still don’t work, so this idea is dropped and it will brainstorm a new one.`;}
    else{stage='simulate';plain=`${o.plain} Not ready yet: ${k.gateFails[0]}. Going back to refine the numbers.`;}}}
  else if(stage==='pilot'){const res=await S(`${c.alts} manufacturer India`,`${c.name} supplier India`,...(OVERSEAS?[`${c.name} manufacturer exporter to India`]:[]));
   const o=await A(`PILOT. Shortlist real suppliers found in the results only (origin india or overseas). Draft a short quote request asking for unit price, setup, finishing, minimum order, taxes, shipping to ${DELIVERY}, lead time and reject rate at several quantities. JSON {plain,suppliers:[{name,website,city,origin,process,evidence_url,small_batch}],quote_request_message,questions_for_suppliers:[]}`,res);
   const urls=res.map(r=>r.url);o.suppliers=(o.suppliers||[]).filter(s=>urls.includes(s.evidence_url));k.pilot=o;k.todos=['Review the supplier shortlist','Send the quote request to three suppliers','Record the quotes and dates you receive'];stage='pilot_ready';plain=o.plain;}
 }catch(e){status='failed';error=String(e.message||e);plain='This run hit an error and stopped safely. Nothing was changed.';}
 if(status==='ok')await sb.from('candidates').update({stage,readiness,state:k,updated_at:new Date()}).eq('id',c.id);
 else await sb.from('candidates').update({updated_at:new Date()}).eq('id',c.id);
 await sb.from('runs').update({finished_at:new Date(),status,plain,tokens,error,outcome:{from:row.stage,to:stage,readiness}}).eq('id',run.id);
}
module.exports={sb,runOnce,TH};
