(() => {
 const cfg=window.ZAIN_CONFIG||{};
 const $=id=>document.getElementById(id);
 const client=window.supabase?.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY);
 if(!client){$('loginError').textContent='Library Supabase gagal dimuat. Periksa koneksi internet.';return;}
 let signals=[];
 const fmt=n=>n==null||n===''?'—':Number(n).toLocaleString('en-US',{maximumFractionDigits:8});
 const time=s=>s?new Date(s).toLocaleString('id-ID',{dateStyle:'short',timeStyle:'short'}):'—';
 const badge=s=>`<span class="badge ${String(s||'').toUpperCase()}">${String(s||'UNKNOWN').toUpperCase()}</span>`;
 function showApp(){ $('loginScreen').classList.add('hidden');$('app').classList.remove('hidden');refreshAll(); }
 async function checkSession(){const {data:{session}}=await client.auth.getSession();if(session)showApp();}
 $('loginForm').addEventListener('submit',async e=>{e.preventDefault();$('loginError').textContent='Memeriksa akun…';const {error}=await client.auth.signInWithPassword({email:$('email').value.trim(),password:$('password').value});if(error){$('loginError').textContent=error.message;return;}showApp();});
 $('logoutBtn').addEventListener('click',async()=>{await client.auth.signOut();location.reload();});
 async function loadSignals(){
   const {data,error}=await client.from('zain_trade_dashboard_history').select('*').order('received_at',{ascending:false}).limit(100);
   if(error){$('signalRows').innerHTML=`<tr><td colspan="7" class="empty">Tidak dapat membaca data: ${escapeHtml(error.message)}</td></tr>`;$('historyList').innerHTML='<p class="empty">Periksa izin SELECT/RLS untuk akun ini.</p>';return;}
   signals=data||[];renderSignals();renderHistory();
 }
 function renderSignals(){
  const latest=new Map();signals.forEach(s=>{if(!latest.has(s.symbol))latest.set(s.symbol,s)});
  const rows=[...latest.values()].slice(0,30);
  $('signalRows').innerHTML=rows.length?rows.map(s=>`<tr><td><b>${escapeHtml(s.symbol)}</b></td><td>${escapeHtml(s.timeframe||'—')}</td><td>${badge(s.analysis?.action||s.action)}</td><td>${fmt(s.signal_price)}</td><td>${s.analysis?.confidence!=null?fmt(s.analysis.confidence)+'%':'—'}</td><td>${badge(s.status)}</td><td>${time(s.received_at)}</td></tr>`).join(''):'<tr><td colspan="7" class="empty">Belum ada sinyal.</td></tr>';
  $('totalSignals').textContent=signals.length;
  $('buyCount').textContent=rows.filter(x=>(x.analysis?.action||x.action)==='BUY'&&x.status==='ANALYZED').length;
  $('sellCount').textContent=rows.filter(x=>(x.analysis?.action||x.action)==='SELL'&&x.status==='ANALYZED').length;
  $('pendingCount').textContent=signals.filter(x=>['PENDING','FAILED'].includes(x.status)).length;
  $('updatedAt').textContent='Update '+new Date().toLocaleTimeString('id-ID');
 }
 function renderHistory(){
  const filter=$('historyFilter').value;const arr=signals.filter(s=>filter==='ALL'||s.status===filter).slice(0,40);
  $('historyList').innerHTML=arr.length?arr.map(s=>`<article class="history-item"><div><b>${escapeHtml(s.symbol)} • ${escapeHtml(s.timeframe||'—')} • ${badge(s.analysis?.action||s.action)}</b><p>${escapeHtml(s.analysis?.summary||s.error_message||'Belum ada ringkasan analisis.')}</p><p>${time(s.received_at)} · Harga ${fmt(s.signal_price)}</p></div><div>${badge(s.status)}</div></article>`).join(''):'<p class="empty">Tidak ada riwayat untuk filter ini.</p>';
 }
 function escapeHtml(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
 async function loadMarket(){
  const pairs=['BTCUSDT','ETHUSDT','SOLUSDT'];
  const results=await Promise.all(pairs.map(async symbol=>{try{const r=await fetch('https://api.binance.com/api/v3/ticker/24hr?symbol='+symbol);if(!r.ok)throw 0;return await r.json();}catch{return {symbol,failed:true};}}));
  $('marketGrid').innerHTML=results.map(x=>x.failed?`<article class="coin"><b>${x.symbol}</b><p class="muted">Harga tidak tersedia</p></article>`:`<article class="coin"><div class="coin-top"><b>${x.symbol.replace('USDT','/USDT')}</b><span>24H</span></div><strong>$${fmt(x.lastPrice)}</strong><span class="${Number(x.priceChangePercent)>=0?'positive':'negative'}">${Number(x.priceChangePercent)>=0?'+':''}${fmt(x.priceChangePercent)}%</span><p class="muted">Volume ${fmt(x.volume)} ${x.symbol.replace('USDT','')}</p></article>`).join('');
 }
 async function refreshAll(){await Promise.all([loadSignals(),loadMarket()]);}
 $('refreshBtn').addEventListener('click',refreshAll);$('historyFilter').addEventListener('change',renderHistory);
 setInterval(()=>{if(!$('app').classList.contains('hidden'))refreshAll();},30000);
 setInterval(()=>$('clock').textContent=new Date().toLocaleTimeString('id-ID'),1000);
 checkSession();
})();