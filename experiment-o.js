(() => {
  if (window.ZAIN_EXPERIMENT_O_COLLECTOR) return;
  const SUPABASE_URL = "https://pxseiytikiulxincoolh.supabase.co";
  const API_KEY = (window.ZAIN_CONFIG && window.ZAIN_CONFIG.SUPABASE_ANON_KEY) ||
    "sb_publishable_KA2AwEzwuepbHm2yu95IkA_eUBb2sXK";
  const AUTH_KEY = "sb-pxseiytikiulxincoolh-auth-token";
  const ENDPOINT = SUPABASE_URL + "/functions/v1/zain-experiment-o-ingest";
  const SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT"];
  const TOPICS = SYMBOLS.map(s => "publicTrade." + s)
    .concat(SYMBOLS.map(s => "orderbook.50." + s));
  const WS_URL = "wss://stream.bybit.com/v5/public/linear";

  const states = {};
  SYMBOLS.forEach(symbol => {
    states[symbol] = {
      trades: [], seen: new Set(), bids: new Map(), asks: new Map(),
      bookReady: false, lastU: null, lastSeq: null, bookUpdates: 0
    };
  });

  let running = false, ws = null, reconnectTimer = null;
  let pingTimer = null, flushTimer = null;
  let reconnectCount = 0, observedResets = 0, lastError = "";
  let pendingTrades = [], totalTrades = 0, totalBookUpdates = 0;
  let lastFlushAt = null;

  function token() {
    try {
      const saved = JSON.parse(localStorage.getItem(AUTH_KEY) || "{}");
      return saved.access_token ||
        saved.currentSession?.access_token ||
        saved.session?.access_token ||
        saved.currentSession?.session?.access_token ||
        null;
    } catch (_) { return null; }
  }

  function addPanel() {
    if (document.getElementById("zainOCollectorPanel")) return;
    const style = document.createElement("style");
    style.textContent = `
      #zainOCollectorPanel{background:#101827;color:#e8eef8;border:1px solid #233149;border-radius:15px;padding:20px;margin:18px 0;font:13px Arial,sans-serif}
      #zainOCollectorPanel h3{margin:0 0 5px;font-size:18px}
      #zainOCollectorPanel .muted{color:#91a0b7;font-size:12px}
      #zainOCollectorPanel .o-head{display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap}
      #zainOCollectorPanel .o-status{border-radius:20px;padding:7px 11px;font-size:10px;font-weight:bold;background:#3a321d;color:#f5c66a}
      #zainOCollectorPanel .o-status.connected{background:#123b31;color:#20d69a}
      #zainOCollectorPanel .o-status.error{background:#401e2b;color:#ff647c}
      #zainOCollectorPanel .o-controls{display:flex;gap:9px;align-items:center;flex-wrap:wrap;margin:16px 0}
      #zainOCollectorPanel button{border:0;border-radius:9px;padding:11px 15px;font-weight:bold;cursor:pointer}
      #zainOCollectorPanel button:disabled{opacity:.45;cursor:not-allowed}
      #zainOStart{background:#20d69a;color:#06140f}#zainOStop{background:#26354b;color:#e8eef8}
      #zainOCollectorPanel .o-cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px;margin:14px 0}
      #zainOCollectorPanel .o-card{background:#141f31;border:1px solid #233149;border-radius:10px;padding:12px}
      #zainOCollectorPanel .o-card small{display:block;color:#91a0b7;font-size:11px}
      #zainOCollectorPanel .o-card strong{display:block;font-size:20px;margin-top:7px}
      #zainOCollectorPanel .o-table-wrap{overflow:auto}
      #zainOCollectorPanel table{width:100%;border-collapse:collapse;white-space:nowrap;font-size:12px}
      #zainOCollectorPanel th,#zainOCollectorPanel td{text-align:left;padding:11px;border-bottom:1px solid #233149}
      #zainOCollectorPanel th{color:#91a0b7;font-weight:500}
      #zainOCollectorPanel .pos{color:#20d69a}#zainOCollectorPanel .neg{color:#ff647c}
      @media(max-width:600px){#zainOCollectorPanel{padding:14px}#zainOCollectorPanel .o-cards{grid-template-columns:repeat(2,minmax(0,1fr))}}
    `;
    document.head.appendChild(style);

    const panel = document.createElement("section");
    panel.id = "zainOCollectorPanel";
    panel.innerHTML = `
      <div class="o-head">
        <div><h3>Experiment O · Browser Collector</h3>
        <div class="muted">Bybit USDT Linear · BTC / ETH / SOL · PAPER ONLY</div></div>
        <span id="zainOStatus" class="o-status">STOPPED</span>
      </div>
      <div class="o-controls">
        <button id="zainOStart">▶ Mulai Collector</button>
        <button id="zainOStop" disabled>■ Hentikan</button>
        <span id="zainOMessage" class="muted">Belum berjalan.</span>
      </div>
      <div class="o-cards">
        <div class="o-card"><small>Transaksi diterima</small><strong id="zainOTrades">0</strong></div>
        <div class="o-card"><small>Update order book</small><strong id="zainOBooks">0</strong></div>
        <div class="o-card"><small>Reconnect</small><strong id="zainOReconnects">0</strong></div>
        <div class="o-card"><small>Sequence reset teramati</small><strong id="zainOResets">0</strong></div>
      </div>
      <div class="o-table-wrap">
        <table><thead><tr><th>Pair</th><th>CVD 1m</th><th>CVD 5m</th><th>CVD 15m</th><th>Mid</th><th>Imbalance</th><th>Book</th></tr></thead>
        <tbody id="zainOMetrics"><tr><td colspan="7">Belum ada data.</td></tr></tbody></table>
      </div>
      <p id="zainOQuality" class="muted">Keterangan: collector aktif hanya selama tab browser berjalan. Nol sequence reset bukan bukti bahwa tidak ada pesan yang hilang.</p>
    `;

    const anchor = document.getElementById("watchlist") || document.querySelector(".main header");
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(panel, anchor.nextSibling);
    else document.body.appendChild(panel);

    const nav = document.querySelector(".sidebar nav");
    if (nav && !nav.querySelector('[href="#zainOCollectorPanel"]')) {
      const link = document.createElement("a");
      link.href = "#zainOCollectorPanel";
      link.textContent = "◉ Experiment O";
      link.style.cssText = "display:block;padding:12px;color:#20d69a;text-decoration:none";
      nav.appendChild(link);
    }

    document.getElementById("zainOStart").addEventListener("click", start);
    document.getElementById("zainOStop").addEventListener("click", stop);
    document.addEventListener("visibilitychange", () => {
      const q = document.getElementById("zainOQuality");
      if (q && running && document.hidden) {
        q.textContent = "PERINGATAN: tab berada di background. Browser dapat membatasi timer; pengumpulan ini bukan layanan server 24 jam.";
      } else if (q) {
        q.textContent = "Collector berjalan di browser. Nol sequence reset bukan bukti bahwa tidak ada pesan yang hilang.";
      }
    });
  }

  function setStatus(status, message) {
    const el = document.getElementById("zainOStatus");
    if (!el) return;
    el.className = "o-status " + status;
    el.textContent = status.toUpperCase();
    document.getElementById("zainOMessage").textContent = message || "";
  }

  function renderCounts() {
    const set = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.textContent = Number(value).toLocaleString("id-ID");
    };
    set("zainOTrades", totalTrades);
    set("zainOBooks", totalBookUpdates);
    set("zainOReconnects", reconnectCount);
    set("zainOResets", observedResets);
  }

  function applySide(map, levels) {
    (levels || []).forEach(level => {
      const price = String(level[0]), size = Number(level[1]);
      if (!Number.isFinite(Number(price)) || !Number.isFinite(size)) return;
      if (size === 0) map.delete(price);
      else map.set(price, size);
    });
  }

  function resetBook(symbol, data) {
    const st = states[symbol];
    st.bids.clear(); st.asks.clear();
    applySide(st.bids, data.b || []);
    applySide(st.asks, data.a || []);
    st.bookReady = st.bids.size > 0 && st.asks.size > 0;
    st.lastU = Number(data.u);
    st.lastSeq = Number(data.seq);
  }

  function handleBook(msg, symbol) {
    const st = states[symbol], data = msg.data || {};
    const u = Number(data.u), seq = Number(data.seq);
    if (msg.type === "snapshot" || u === 1 || !st.bookReady) {
      if (st.lastU !== null && (u === 1 || (Number.isFinite(u) && u < st.lastU))) observedResets++;
      resetBook(symbol, data);
    } else {
      if ((Number.isFinite(u) && st.lastU !== null && u < st.lastU) ||
          (Number.isFinite(seq) && st.lastSeq !== null && seq < st.lastSeq)) {
        observedResets++;
        st.bookReady = false;
        renderCounts();
        if (ws && ws.readyState === WebSocket.OPEN) ws.close();
        return;
      }
      applySide(st.bids, data.b || []);
      applySide(st.asks, data.a || []);
      if (Number.isFinite(u)) st.lastU = u;
      if (Number.isFinite(seq)) st.lastSeq = seq;
    }
    st.bookUpdates++;
    totalBookUpdates++;
    renderCounts();
  }

  function handleTrades(msg, symbol) {
    const st = states[symbol];
    (msg.data || []).forEach(t => {
      const id = String(t.i || (symbol + "-" + t.T + "-" + t.p + "-" + t.v));
      if (st.seen.has(id)) return;
      st.seen.add(id);
      if (st.seen.size > 10000) st.seen.delete(st.seen.values().next().value);
      const price = Number(t.p), quantity = Number(t.v), time = Number(t.T);
      if (!(price > 0 && quantity > 0 && Number.isFinite(time))) return;
      const side = String(t.S);
      if (side !== "Buy" && side !== "Sell") return;
      st.trades.push({time: time, quote: price * quantity, side: side});
      pendingTrades.push({
        symbol: symbol, exchange_trade_id: id, trade_time_ms: time,
        price: price, quantity: quantity, aggressor_side: side
      });
      totalTrades++;
    });
    const cutoff = Date.now() - 15 * 60 * 1000;
    st.trades = st.trades.filter(t => t.time >= cutoff);
    renderCounts();
  }

  function bookMetrics(st) {
    if (!st.bookReady) return {};
    const bids = Array.from(st.bids.entries()).map(x => [Number(x[0]), x[1]])
      .sort((a,b) => b[0]-a[0]).slice(0,20);
    const asks = Array.from(st.asks.entries()).map(x => [Number(x[0]), x[1]])
      .sort((a,b) => a[0]-b[0]).slice(0,20);
    const bid = bids.length ? bids[0][0] : 0, ask = asks.length ? asks[0][0] : 0;
    const mid = bid && ask ? (bid + ask) / 2 : 0;
    const bidDepth = bids.reduce((sum,x) => sum + x[0]*x[1], 0);
    const askDepth = asks.reduce((sum,x) => sum + x[0]*x[1], 0);
    return {
      best_bid: bid, best_ask: ask, mid_price: mid,
      spread_bps: mid ? ((ask-bid)/mid)*10000 : null,
      bid_depth_20_usdt: bidDepth, ask_depth_20_usdt: askDepth,
      depth_imbalance: bidDepth+askDepth ? (bidDepth-askDepth)/(bidDepth+askDepth) : null
    };
  }

  function windowStats(st, duration) {
    const since = Date.now() - duration;
    const trades = st.trades.filter(t => t.time >= since);
    let buy = 0, sell = 0;
    trades.forEach(t => { if (t.side === "Buy") buy += t.quote; else sell += t.quote; });
    return {cvd: buy-sell, count: trades.length, buy: buy, sell: sell};
  }

  function buildMetrics() {
    const end = new Date().toISOString();
    return SYMBOLS.map(symbol => {
      const st = states[symbol];
      const one = windowStats(st, 60000), five = windowStats(st, 300000), fifteen = windowStats(st, 900000);
      return Object.assign({
        symbol: symbol, window_end: end,
        cvd_1m_usdt: one.cvd, cvd_5m_usdt: five.cvd, cvd_15m_usdt: fifteen.cvd,
        trades_1m: one.count, trades_5m: five.count, trades_15m: fifteen.count,
        buy_quote_1m_usdt: one.buy, sell_quote_1m_usdt: one.sell,
        book_ready: st.bookReady, book_update_id: st.lastU, book_seq: st.lastSeq,
        book_updates_5s: st.bookUpdates, observed_sequence_resets: observedResets
      }, bookMetrics(st));
    });
  }

  function renderMetrics(metrics) {
    const fmt = n => n == null || !Number.isFinite(Number(n))
      ? "—" : Number(n).toLocaleString("en-US", {maximumFractionDigits:3});
    const body = document.getElementById("zainOMetrics");
    if (!body) return;
    body.innerHTML = metrics.map(m => {
      const cvd = n => '<span class="' + (n >= 0 ? "pos" : "neg") + '">' + fmt(n) + '</span>';
      return "<tr><td><b>" + m.symbol + "</b></td><td>" + cvd(m.cvd_1m_usdt) +
        "</td><td>" + cvd(m.cvd_5m_usdt) + "</td><td>" + cvd(m.cvd_15m_usdt) +
        "</td><td>" + fmt(m.mid_price) + "</td><td>" + fmt(m.depth_imbalance) +
        "</td><td>" + (m.book_ready ? "READY" : "WAIT") + "</td></tr>";
    }).join("");
  }

  async function sendBatch(force) {
    if (!running && !force) return;
    const accessToken = token();
    if (!accessToken) {
      lastError = "Sesi login tidak ditemukan. Login ulang lalu mulai collector.";
      setStatus("error", lastError);
      return;
    }
    const batch = pendingTrades.splice(0, 500);
    const metrics = buildMetrics();
    renderMetrics(metrics);
    const payload = {
      action: "ingest",
      trades: batch,
      metrics: metrics,
      health: {
        connected: force ? false : Boolean(ws && ws.readyState === WebSocket.OPEN),
        reconnect_count: reconnectCount,
        observed_sequence_resets: observedResets,
        last_error: lastError
      }
    };
    try {
      const response = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": API_KEY,
          "Authorization": "Bearer " + accessToken
        },
        body: JSON.stringify(payload)
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || ("HTTP " + response.status));
      lastFlushAt = new Date();
      setStatus(result.collector_status === "connected" ? "connected" : "degraded",
        "Terkirim " + (result.trades_received || 0) + " transaksi · " +
        (result.metrics_written || 0) + " metrik · " + lastFlushAt.toLocaleTimeString("id-ID"));
      SYMBOLS.forEach(s => { states[s].bookUpdates = 0; });
    } catch (error) {
      pendingTrades = batch.concat(pendingTrades).slice(-5000);
      lastError = error.message || String(error);
      setStatus("error", "Gagal kirim ke Supabase: " + lastError);
    }
  }

  function scheduleReconnect() {
    if (!running || reconnectTimer) return;
    setStatus("degraded", "Koneksi terputus; mencoba sambung ulang...");
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, 3000);
  }

  function connect() {
    if (!running) return;
    setStatus("degraded", "Menghubungkan ke Bybit...");
    try { ws = new WebSocket(WS_URL); }
    catch (error) { lastError = String(error); scheduleReconnect(); return; }

    ws.onopen = () => {
      if (!running) { ws.close(); return; }
      ws.send(JSON.stringify({op:"subscribe", args:TOPICS}));
      pingTimer = setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({op:"ping"}));
      }, 20000);
      setStatus("degraded", "WebSocket tersambung; menunggu snapshot order book...");
    };
    ws.onmessage = event => {
      let msg;
      try { msg = JSON.parse(event.data); } catch (_) { return; }
      if (msg.op === "subscribe" && msg.success === false) {
        lastError = msg.ret_msg || "Subscription ditolak";
        setStatus("error", lastError);
        return;
      }
      if (!msg.topic || !msg.data) return;
      const symbol = msg.topic.split(".").pop();
      if (!states[symbol]) return;
      if (msg.topic.indexOf("publicTrade.") === 0) handleTrades(msg, symbol);
      else if (msg.topic.indexOf("orderbook.50.") === 0) handleBook(msg, symbol);
    };
    ws.onerror = () => {
      lastError = "WebSocket error";
      setStatus("degraded", lastError);
    };
    ws.onclose = () => {
      if (pingTimer) clearInterval(pingTimer);
      if (running) { reconnectCount++; renderCounts(); scheduleReconnect(); }
      else setStatus("degraded", "Collector dihentikan.");
    };
  }

  async function start() {
    if (running) return;
    if (!token()) {
      setStatus("error", "Login ke ZAIN AI Trading Terminal terlebih dahulu.");
      return;
    }
    running = true;
    lastError = "";
    document.getElementById("zainOStart").disabled = true;
    document.getElementById("zainOStop").disabled = false;
    setStatus("degraded", "Collector dimulai...");
    connect();
    flushTimer = setInterval(() => sendBatch(false), 5000);
  }

  async function stop() {
    if (!running) return;
    await sendBatch(true);
    running = false;
    if (flushTimer) clearInterval(flushTimer);
    if (pingTimer) clearInterval(pingTimer);
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
    const old = ws;
    ws = null;
    if (old) old.close();
    document.getElementById("zainOStart").disabled = false;
    document.getElementById("zainOStop").disabled = true;
    setStatus("degraded", "Collector dihentikan. Simpanan terakhir: " +
      (lastFlushAt ? lastFlushAt.toLocaleTimeString("id-ID") : "belum ada"));
  }

  addPanel();
  renderCounts();
  window.ZAIN_EXPERIMENT_O_COLLECTOR = {
    start: start, stop: stop, status: () => ({
      running: running, totalTrades: totalTrades, totalBookUpdates: totalBookUpdates,
      reconnectCount: reconnectCount, observedSequenceResets: observedResets,
      pendingTrades: pendingTrades.length, lastError: lastError
    })
  };
})();
