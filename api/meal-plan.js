const {isAuthorized,send}=require('./_auth');
const base='https://wxboatjwmqamcidxhhsl.supabase.co/rest/v1';
async function query(path){const key=(process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.meal_alchemy_secret_dasboard);const r=await fetch(base+path,{headers:{apikey:key,...(key.startsWith('sb_secret_')?{}:{Authorization:'Bearer '+key}),Accept:'application/json'},signal:AbortSignal.timeout(9000)});if(!r.ok){const body=await r.text();let parsed={};try{parsed=JSON.parse(body)}catch{};console.error('Supabase response',{status:r.status,code:parsed.code||parsed.error_code||null,message:String(parsed.message||parsed.msg||parsed.error||'').slice(0,160),keyType:key.startsWith('sb_secret_')?'secret':key.startsWith('eyJ')?'legacy-jwt':'unrecognized',keyLength:key.length});throw new Error('Meal Alchemy query failed: '+r.status)}return r.json();}
module.exports=async function(req,res){
if(req.method!=='GET')return send(res,405,{error:'Method not allowed'});
if(!isAuthorized(req))return send(res,401,{error:'Sign in required'});
if(!(process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.meal_alchemy_secret_dasboard)||!process.env.MEALALCHEMY_HOUSEHOLD_ID)return send(res,503,{error:'Meal Alchemy connection is not configured'});
try{
const hid=encodeURIComponent(process.env.MEALALCHEMY_HOUSEHOLD_ID);
const rows=await query('/household_recipe_data?household_id=eq.'+hid+'&select=data,updated_at&limit=1');
if(!rows.length)return send(res,404,{error:'Household meal plan not found'});
const data=rows[0].data||{};const entries=Array.isArray(data.mealPlan)?data.mealPlan:[];
const ids=[...new Set(entries.map(x=>String(x.recipeId||'')).filter(Boolean))];
const uuid=ids.filter(x=>/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(x));
const legacy=ids.filter(x=>!uuid.includes(x));
const titles=new Map();
if(uuid.length){const q='('+uuid.map(encodeURIComponent).join(',')+')';const [official,custom]=await Promise.all([query('/official_recipes?id=in.'+q+'&select=id,title'),query('/custom_recipes?id=in.'+q+'&select=id,title')]);for(const x of [...official,...custom])titles.set(String(x.id),x.title);}
if(legacy.length){const q='('+legacy.map(encodeURIComponent).join(',')+')';const imported=await query('/household_imported_recipes?household_id=eq.'+hid+'&id=in.'+q+'&select=id,recipe');for(const x of imported)titles.set(String(x.id),x.recipe?.title||x.recipe?.name||'Untitled recipe');}
return send(res,200,{planName:data.activePlanName||'Current Meal Plan',updatedAt:rows[0].updated_at,meals:entries.map((x,i)=>({id:String(x.id||i),title:titles.get(String(x.recipeId))||'Recipe unavailable',meal:x.meal||'Meal',cooked:!!x.cooked}))});
}catch(e){console.error('Meal plan lookup failed:',e.message);return send(res,502,{error:'Unable to load meal plan right now'});}
};