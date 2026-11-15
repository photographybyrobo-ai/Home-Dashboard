const {isAuthorized,send}=require('./_auth');
module.exports=async function(req,res){
 if(req.method!=='GET')return send(res,405,{error:'Method not allowed'});
 if(!isAuthorized(req))return send(res,401,{error:'Sign in required'});
 const token=process.env.DASHBOARD_MEAL_PLAN_TOKEN;
 const key=process.env.MEALALCHEMY_PUBLISHABLE_KEY;
 if(!token||!key)return send(res,503,{error:'Meal Alchemy connection is not configured'});
 try{
  const response=await fetch('https://wxboatjwmqamcidxhhsl.supabase.co/rest/v1/rpc/home_dashboard_meal_plan',{
   method:'POST',headers:{'apikey':key,'Content-Type':'application/json','Accept':'application/json'},
   body:JSON.stringify({p_token:token}),signal:AbortSignal.timeout(9000)
  });
  if(!response.ok){const body=await response.text();console.error('Household meal plan RPC failed',response.status,body.slice(0,250));throw new Error('Household meal plan RPC failed');}
  const data=await response.json();
  if(!data)return send(res,404,{error:'Household meal plan not found'});
  res.setHeader('Cache-Control','private, no-store');
  return send(res,200,data);
 }catch(e){console.error('Meal plan lookup failed:',e.message);return send(res,502,{error:'Unable to load meal plan right now'});}
};