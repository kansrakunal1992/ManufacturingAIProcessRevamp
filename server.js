const express=require('express');const {sb,runOnce,TH}=require('./agent');
const app=express();let busy=false;
app.use((req,res,next)=>{
 if(req.path==='/api/run'&&process.env.CRON_SECRET&&req.query.key===process.env.CRON_SECRET)return next();
 const p=Buffer.from((req.headers.authorization||'').split(' ')[1]||'','base64').toString().split(':').slice(1).join(':');
 if(process.env.DASHBOARD_PASSWORD&&p===process.env.DASHBOARD_PASSWORD)return next();
 res.set('WWW-Authenticate','Basic realm="Research Lab"').status(401).send('Login required');});
// cron-jobs.org times out near 30s, so answer at once and work in the background
app.all('/api/run',(req,res)=>{
 if(busy)return res.status(202).json({status:'already running'});
 busy=true;runOnce().catch(e=>console.error(e)).finally(()=>{busy=false;});
 res.status(202).json({status:'started'});});
const load=async n=>{const [c,r,e]=await Promise.all([sb.from('candidates').select('*'),sb.from('runs').select('*').order('id',{ascending:false}).limit(n),sb.from('evidence').select('*').order('id',{ascending:false}).limit(n*2)]);return {candidates:c.data||[],runs:r.data||[],evidence:e.data||[]};};
app.get('/api/state',async(req,res)=>res.json({...await load(30),busy,threshold:TH*100}));
app.get('/api/export.json',async(req,res)=>{res.set('Content-Disposition','attachment; filename=research-lab-export.json').json(await load(500));});
app.use(express.static(__dirname+'/public'));
app.listen(process.env.PORT||3000);
