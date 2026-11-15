const {COOKIE,secureEqual,sign,isAuthorized,send}=require('./_auth');
module.exports=async function(req,res){
res.setHeader('Cache-Control','no-store');
if(req.method==='GET')return send(res,200,{authenticated:isAuthorized(req)});
if(req.method==='DELETE'){res.setHeader('Set-Cookie',COOKIE+'=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');return send(res,200,{ok:true});}
if(req.method!=='POST')return send(res,405,{error:'Method not allowed'});
if(!process.env.DASHBOARD_PASSWORD||!process.env.SESSION_SECRET)return send(res,503,{error:'Dashboard authentication is not configured'});
const password=typeof req.body?.password==='string'?req.body.password:'';
if(password.length>256||!secureEqual(password,process.env.DASHBOARD_PASSWORD))return send(res,401,{error:'Incorrect password'});
const exp=String(Date.now()+30*24*60*60*1000);
res.setHeader('Set-Cookie',COOKIE+'='+exp+'.'+sign(exp)+'; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000');
return send(res,200,{ok:true});
};