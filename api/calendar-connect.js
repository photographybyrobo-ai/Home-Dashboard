const crypto=require('node:crypto');
const {isAuthorized,send,sign}=require('./_auth');
module.exports=async function(req,res){
 if(req.method!=='GET')return send(res,405,{error:'Method not allowed'});
 if(!isAuthorized(req))return send(res,401,{error:'Sign in to the dashboard first'});
 if(!process.env.GOOGLE_CLIENT_ID||!process.env.GOOGLE_CLIENT_SECRET||!process.env.SESSION_SECRET)return send(res,503,{error:'Google connection is not configured'});
 const nonce=crypto.randomBytes(18).toString('base64url');
 const state=nonce+'.'+sign('google-oauth:'+nonce);
 res.setHeader('Set-Cookie','calendar_oauth_state='+encodeURIComponent(state)+'; Path=/api/calendar-callback; HttpOnly; Secure; SameSite=Lax; Max-Age=600');
 const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');
 for(const [k,v] of Object.entries({client_id:process.env.GOOGLE_CLIENT_ID,redirect_uri:'https://home-dashboard-flame.vercel.app/api/calendar-callback',response_type:'code',scope:'https://www.googleapis.com/auth/calendar.events.readonly https://www.googleapis.com/auth/calendar.calendarlist.readonly',access_type:'offline',prompt:'consent',state}))url.searchParams.set(k,v);
 res.setHeader('Cache-Control','no-store');res.writeHead(302,{Location:url.toString()});res.end();
};