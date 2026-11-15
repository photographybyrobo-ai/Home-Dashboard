const crypto = require('node:crypto');
const COOKIE='household_session';
function secureEqual(a,b){const x=crypto.createHash('sha256').update(String(a)).digest();const y=crypto.createHash('sha256').update(String(b)).digest();return crypto.timingSafeEqual(x,y);}
function sign(data){return crypto.createHmac('sha256',process.env.SESSION_SECRET).update(data).digest('base64url');}
function isAuthorized(req){if(!process.env.SESSION_SECRET)return false;const cookie=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE+'='));if(!cookie)return false;const value=cookie.slice(COOKIE.length+1);const [exp,sig]=value.split('.');if(!exp||!sig||!/^\d+$/.test(exp)||Number(exp)<Date.now())return false;return secureEqual(sign(exp),sig);}
function send(res,status,body){res.status(status).setHeader('Cache-Control','no-store').json(body);}
module.exports={COOKIE,secureEqual,sign,isAuthorized,send};