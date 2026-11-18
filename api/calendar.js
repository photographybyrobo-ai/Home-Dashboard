const {isAuthorized,send}=require('./_auth');
module.exports=async function(req,res){
 if(req.method!=='GET')return send(res,405,{error:'Method not allowed'});
 if(!isAuthorized(req))return send(res,401,{error:'Sign in required'});
 const {GOOGLE_CLIENT_ID:id,GOOGLE_CLIENT_SECRET:secret,GOOGLE_REFRESH_TOKEN:refresh,GOOGLE_CALENDAR_ID:calendar}=process.env;
 if(!id||!secret||!refresh||!calendar)return send(res,503,{error:'Calendar connection needs final setup'});
 try{
  const t=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:id,client_secret:secret,refresh_token:refresh,grant_type:'refresh_token'}),signal:AbortSignal.timeout(9000)});
  const auth=await t.json();if(!t.ok||!auth.access_token)throw Error('Google token refresh failed: '+(auth.error||t.status));
  const url=new URL('https://www.googleapis.com/calendar/v3/calendars/'+encodeURIComponent(calendar)+'/events');
  const now=Date.now();url.searchParams.set('timeMin',new Date(now).toISOString());url.searchParams.set('timeMax',new Date(now+30*24*60*60*1000).toISOString());url.searchParams.set('maxResults','250');url.searchParams.set('singleEvents','true');url.searchParams.set('orderBy','startTime');url.searchParams.set('timeZone','America/Denver');
  const items=[];let nextPage;
  do{
   if(nextPage)url.searchParams.set('pageToken',nextPage);
   const r=await fetch(url,{headers:{Authorization:'Bearer '+auth.access_token},signal:AbortSignal.timeout(9000)});
   if(!r.ok)throw Error('Google events request failed: '+r.status);
   const data=await r.json();items.push(...(data.items||[]));nextPage=data.nextPageToken;
  }while(nextPage&&items.length<1000);
  return send(res,200,{events:items.filter(x=>x.status!=='cancelled').map(x=>({title:x.summary||'(Untitled event)',start:x.start?.dateTime||x.start?.date||null,allDay:!!x.start?.date}))});
 }catch(e){console.error('Calendar request failed:',e.message);return send(res,502,{error:'Unable to load calendar events. The Google authorization may need renewal.'});}
};