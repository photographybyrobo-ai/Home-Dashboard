// Personal-use weather proxy: ZIP lookup + Open-Meteo, no credentials required.
export default async function handler(req,res){
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 const zip=String(req.query.zip||'').trim();
 if(!/^\d{5}$/.test(zip))return res.status(400).json({error:'Enter a five-digit US ZIP code'});
 try{
  const lookup=await fetch('https://api.zippopotam.us/us/'+encodeURIComponent(zip),{signal:AbortSignal.timeout(8000)});
  if(!lookup.ok)throw new Error(lookup.status===404?'ZIP code not found':'ZIP lookup unavailable');
  const place=await lookup.json(),p=place.places?.[0];
  if(!p)throw new Error('ZIP code not found');
  const params=new URLSearchParams({latitude:p.latitude,longitude:p.longitude,timezone:'auto',forecast_days:'10',temperature_unit:'fahrenheit',current:'temperature_2m,weather_code,is_day',daily:'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max'});
  const response=await fetch('https://api.open-meteo.com/v1/forecast?'+params,{signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw new Error('Weather service unavailable');
  const data=await response.json();
  if(!data.daily?.time?.length)throw new Error('Forecast unavailable');
  res.setHeader('Cache-Control','private, max-age=0, s-maxage=900, stale-while-revalidate=900');
  return res.status(200).json({zip,location:p['place name']+', '+p['state abbreviation'],current:data.current,daily:data.daily,updatedAt:new Date().toISOString()});
 }catch(error){return res.status(502).json({error:error.message||'Weather unavailable'});}
}
