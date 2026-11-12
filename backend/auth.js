const {OAuth2Client} = require('google-auth-library');
const Database = require('better-sqlite3');
const {randomBytes,createHash} = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const hash = value => createHash('sha256').update(value).digest('hex');
const token = () => randomBytes(32).toString('base64url');
const fail = (status,message) => Object.assign(Error(message),{status});
function createAuth(dataDir, config = {}) {
  const clientId = config.clientId ?? process.env.GOOGLE_CLIENT_ID;
  const clientSecret = config.clientSecret ?? process.env.GOOGLE_CLIENT_SECRET;
  const origin = config.origin ?? process.env.PUBLIC_ORIGIN;
  const enabled = !!(clientId && clientSecret);
  const origins = new Set([origin, ...(config.allowedOrigins ?? process.env.ALLOWED_ORIGINS ?? '').split(',')].filter(Boolean));
  for (const value of origins) { const u = new URL(value); if (u.origin !== value || !['http:', 'https:'].includes(u.protocol) || (enabled && u.protocol !== 'https:')) throw Error('Недопустимый адрес ALLOWED_ORIGINS'); }
  if (!!clientId !== !!clientSecret || (process.env.GOOGLE_AUTH_REQUIRED === '1' && !enabled)) throw Error('Укажите GOOGLE_CLIENT_ID и GOOGLE_CLIENT_SECRET вместе');
  if (enabled && (!origin || new URL(origin).protocol !== 'https:')) throw Error('Для Google-входа нужен PUBLIC_ORIGIN с HTTPS');
  const ownerSub = config.ownerSub ?? process.env.GOOGLE_OWNER_SUB;
  const redirect = enabled ? new URL('/auth/google/callback',origin).href : null;
  const client = config.client ?? (enabled ? new OAuth2Client({clientId,clientSecret,redirectUri:redirect,transporterOptions:{timeout:15000}}) : null);
  const now = config.now ?? Date.now;
  const daily = Number(config.daily ?? process.env.AI_DAILY_LIMIT ?? (enabled ? 5 : 20));
  const globalDaily = Number(config.globalDaily ?? process.env.AI_GLOBAL_DAILY_LIMIT ?? 100);
  const startingCredits = Number(config.startingCredits ?? process.env.AI_STARTING_CREDITS ?? 10);
  const tokensPerCredit = 1000;
  if (![daily,globalDaily,startingCredits].every(n => Number.isSafeInteger(n) && n > 0)) throw Error('Лимиты ИИ и стартовые кредиты должны быть положительными целыми числами');
  fs.mkdirSync(dataDir,{recursive:true,mode:0o700});
  const filename = path.join(dataDir,'auth.sqlite'), db = new Database(filename); fs.chmodSync(filename,0o600);
  db.pragma('journal_mode = WAL'); db.pragma('busy_timeout = 5000');
  db.exec('CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user TEXT NOT NULL, expires INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS logins (state TEXT PRIMARY KEY, verifier TEXT NOT NULL, nonce TEXT NOT NULL, expires INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS usage (day TEXT NOT NULL, owner TEXT NOT NULL, requests INTEGER NOT NULL, PRIMARY KEY(day,owner)); CREATE TABLE IF NOT EXISTS ai_credits (owner TEXT PRIMARY KEY, tokens_remaining INTEGER NOT NULL CHECK(tokens_remaining >= 0))');
  const cookie = (name,value,seconds) => name+'='+value+'; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age='+seconds;
  const cookies = req => Object.fromEntries((req.headers.cookie || '').split(';').map(s => s.trim().split('=')));
  const clean = () => { db.prepare('DELETE FROM sessions WHERE expires < ?').run(now()); db.prepare('DELETE FROM logins WHERE expires < ?').run(now()); db.prepare('DELETE FROM usage WHERE day < ?').run(new Date(now()-7*86400000).toISOString().slice(0,10)); };
  function user(req) { if (!enabled) return {id:'legacy',name:'Рабочее пространство'}; const value=cookies(req)['__Host-bf-session']; if (!value || value.length > 100) return null; const row=db.prepare('SELECT user FROM sessions WHERE token=? AND expires>?').get(hash(value),now()); return row ? JSON.parse(row.user) : null; }
  const ensureCredits = db.prepare('INSERT INTO ai_credits(owner,tokens_remaining) VALUES(?,?) ON CONFLICT(owner) DO NOTHING');
  function credits(owner) { ensureCredits.run(owner, startingCredits * tokensPerCredit); const tokensRemaining=db.prepare('SELECT tokens_remaining FROM ai_credits WHERE owner=?').get(owner).tokens_remaining; return { credits: tokensRemaining / tokensPerCredit, tokensRemaining, tokensPerCredit }; }
  function consumeTokens(owner, tokens) { if (!Number.isSafeInteger(tokens) || tokens < 0) throw Error('Некорректное списание токенов'); ensureCredits.run(owner, startingCredits * tokensPerCredit); db.prepare('UPDATE ai_credits SET tokens_remaining=MAX(0,tokens_remaining-?) WHERE owner=?').run(tokens,owner); return credits(owner); }
  function quota(owner) { const day=new Date(now()).toISOString().slice(0,10); const used=db.prepare('SELECT requests FROM usage WHERE day=? AND owner=?').get(day,owner)?.requests || 0; const total=db.prepare('SELECT COALESCE(SUM(requests),0) n FROM usage WHERE day=?').get(day).n; return {limit:daily,remaining:Math.max(0,Math.min(daily-used,globalDaily-total)),resetAt:new Date(Date.parse(day)+86400000).toISOString(),...credits(owner)}; }
  const reserve = db.transaction(owner => { clean(); const q=quota(owner); if (!q.remaining) throw fail(429,'Лимит ИИ на сегодня исчерпан. Запросы обновятся в 00:00 UTC.'); db.prepare('INSERT INTO usage(day,owner,requests) VALUES(?,?,1) ON CONFLICT(day,owner) DO UPDATE SET requests=requests+1').run(new Date(now()).toISOString().slice(0,10),owner); });
  const attempts = new Map();
  function rate(req) { const key=req.socket.remoteAddress, time=now(); for(const[k,v]of attempts)if(v.until<time)attempts.delete(k); const record=attempts.get(key)||{count:0,until:time+60000}; if(attempts.size>1000 || ++record.count>20)throw fail(429,'Слишком много попыток входа. Подождите минуту.'); attempts.set(key,record); }
  async function handle(req,res,url) {
    if (!url.pathname.startsWith('/auth/')) return false;
    res.setHeader('Cache-Control','no-store'); res.setHeader('Referrer-Policy','no-referrer');
    if(url.pathname==='/auth/status' && req.method==='GET'){const u=user(req);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({enabled,user:u ? {name:u.name,email:u.email} : null}));return true;}
    if(!enabled)throw fail(503,'Google-вход ещё не подключён');
    if(url.pathname==='/auth/logout' && req.method==='POST'){if(!origins.has(req.headers.origin))throw fail(403,'Недопустимый источник запроса');const value=cookies(req)['__Host-bf-session'];if(value)db.prepare('DELETE FROM sessions WHERE token=?').run(hash(value));res.setHeader('Set-Cookie',cookie('__Host-bf-session','',0));res.end('{}');return true;}
    if(req.method!=='GET')throw fail(405,'Метод не поддерживается');
    rate(req); clean();
    if(url.pathname==='/auth/google'){
      const state=token(),verifier=token(),nonce=token();db.prepare('INSERT INTO logins VALUES(?,?,?,?)').run(hash(state),verifier,nonce,now()+600000);
      res.setHeader('Set-Cookie',cookie('__Host-bf-login',state,600));
      res.writeHead(302,{Location:client.generateAuthUrl({scope:['openid','email','profile'],state,nonce,code_challenge:hashChallenge(verifier),code_challenge_method:'S256',prompt:'select_account'})});res.end();return true;
    }
    if(url.pathname==='/auth/google/callback'){
      const state=url.searchParams.get('state');
      if(!state || state.length>100 || state!==cookies(req)['__Host-bf-login'])throw fail(400,'Сессия входа истекла. Попробуйте войти ещё раз.');
      const row=db.transaction(()=>{const r=db.prepare('SELECT * FROM logins WHERE state=? AND expires>?').get(hash(state),now());db.prepare('DELETE FROM logins WHERE state=?').run(hash(state));return r;}).immediate();
      res.setHeader('Set-Cookie',cookie('__Host-bf-login','',0));
      if(!row || !url.searchParams.get('code'))throw fail(400,'Вход отменён или устарел. Попробуйте снова.');
      let payload;
      try { const{tokens}=await client.getToken({code:url.searchParams.get('code'),codeVerifier:row.verifier,redirect_uri:redirect});const ticket=await client.verifyIdToken({idToken:tokens.id_token,audience:clientId});payload=ticket.getPayload(); }
      catch {throw fail(502,'Не удалось подтвердить вход в Google. Попробуйте снова.');}
      if(!payload?.sub || payload.nonce!==row.nonce || payload.email_verified!==true)throw fail(403,'Google не подтвердил учётную запись');
      const u={id:payload.sub===ownerSub?'legacy':payload.sub,name:String(payload.name||payload.email).slice(0,100),email:payload.email};
      const value=token(); db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(hash(value),JSON.stringify(u),now()+7*86400000);
      res.setHeader('Set-Cookie',[cookie('__Host-bf-login','',0),cookie('__Host-bf-session',value,7*86400)]);res.writeHead(302,{Location:'/#projects'});res.end();return true;
    }
    throw fail(404,'Не найдено');
  }
  return {enabled,user,handle,quota,credits,consumeTokens,acceptsOrigin:value=>origins.has(value),reserve:owner=>reserve.immediate(owner),close:()=>db.close()};
}
function hashChallenge(value) { return createHash('sha256').update(value).digest('base64url'); }
module.exports={createAuth};
