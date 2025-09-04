// Clean orientation-aware presentationV2 script
(function(){
  const overlay = document.getElementById('gridOverlay');
  const dashboardInner = document.querySelector('.dashboard-inner');
  const gridAreaInner = document.querySelector('.grid-area-inner');

  if(!overlay || !dashboardInner || !gridAreaInner){
    console.warn('presentationV2: missing DOM elements, aborting');
    return;
  }

  let cols = 9, rows = 5;
  function getOrientation(){ return window.innerWidth >= window.innerHeight ? 'landscape' : 'portrait'; }
  function storageKey(){ return 'presentationV2_layout_' + getOrientation(); }

  function applyGridForOrientation(){
    const ori = getOrientation();
    if(ori === 'portrait'){ cols = 4; rows = 6; } else { cols = 9; rows = 5; }
    document.documentElement.style.setProperty('--grid-columns', String(cols));
    document.documentElement.style.setProperty('--grid-rows', String(rows));
    overlay.innerHTML = '';
    for(let r=0;r<rows;r++) for(let c=0;c<cols;c++){ const d=document.createElement('div'); d.className='cell'; d.dataset.col=c; d.dataset.row=r; overlay.appendChild(d); }
  }

  function fitDashboardToViewport(){
    const pageWrap = document.querySelector('.page-wrap');
    const pwStyle = pageWrap ? getComputedStyle(pageWrap) : {paddingTop:'0px', paddingBottom:'0px'};
    const padTop = parseInt(pwStyle.paddingTop)||0; const padBottom = parseInt(pwStyle.paddingBottom)||0;
    const available = window.innerHeight - padTop - padBottom;
  dashboardInner.style.height = available + 'px';
  // avoid scrollbars inside dashboard: let content fit by explicit sizing
  dashboardInner.style.overflow = 'hidden';
    const header = dashboardInner.querySelector('.dashboard-header');
    const headerH = header ? header.getBoundingClientRect().height : 0;
    const dbStyle = getComputedStyle(dashboardInner);
    const dbPadTop = parseInt(dbStyle.paddingTop)||0; const dbPadBottom = parseInt(dbStyle.paddingBottom)||0;
    const gridAvailable = Math.max(120, available - headerH - dbPadTop - dbPadBottom - 8);
  gridAreaInner.style.height = gridAvailable + 'px';
  // clear padding-bottom fallback so explicit height is used (prevents double-height)
  gridAreaInner.style.paddingBottom = '0px';
  }

  function saveLayout(){
    const modules = Array.from(document.querySelectorAll('.module')).map(m=>({id:m.id,x:parseInt(m.dataset.x||0,10),y:parseInt(m.dataset.y||0,10),w:parseInt(m.dataset.w||1,10),h:parseInt(m.dataset.h||1,10)}));
    try{ localStorage.setItem(storageKey(), JSON.stringify(modules)); }catch(e){}
  }

  function loadLayout(){
    try{
      const raw = localStorage.getItem(storageKey()); if(!raw) return false;
      const items = JSON.parse(raw);
      items.forEach(i=>{ const el = document.getElementById(i.id); if(el){ el.dataset.x = i.x; el.dataset.y = i.y; el.dataset.w = i.w; el.dataset.h = i.h; } });
      return true;
    }catch(e){ return false; }
  }

  function placeModule(el){
    let x = parseInt(el.dataset.x,10)||0; let y = parseInt(el.dataset.y,10)||0; let w = parseInt(el.dataset.w,10)||1; let h = parseInt(el.dataset.h,10)||1;
    if(x<0) x=0; if(y<0) y=0; if(w<1) w=1; if(h<1) h=1;
    if(x + w > cols) w = Math.max(1, cols - x);
    if(y + h > rows) h = Math.max(1, rows - y);
    el.dataset.x = x; el.dataset.y = y; el.dataset.w = w; el.dataset.h = h;
    const area = overlay.getBoundingClientRect();
    const cellW = area.width / cols; const cellH = area.height / rows;
    el.style.left = (x * cellW) + 'px';
    el.style.top = (y * cellH) + 'px';
    el.style.width = Math.max(40, w * cellW - 12) + 'px';
    el.style.height = Math.max(40, h * cellH - 12) + 'px';
  }

  // initialize
  applyGridForOrientation(); fitDashboardToViewport(); const loaded = loadLayout();
  document.querySelectorAll('.module').forEach(m=>placeModule(m)); if(loaded) document.querySelectorAll('.module').forEach(m=>placeModule(m));

  // dragging / resizing
  let dragState = null;
  document.addEventListener('pointerdown', e=>{
    const mod = e.target.closest('.module'); if(!mod) return;
    if(e.target.classList.contains('resize-handle')){
      dragState = {type:'resize', el:mod, startX:e.clientX, startY:e.clientY, startW:parseInt(mod.dataset.w||1,10), startH:parseInt(mod.dataset.h||1,10)};
    } else {
      dragState = {type:'move', el:mod, startX:e.clientX, startY:e.clientY, origX:parseInt(mod.dataset.x||0,10), origY:parseInt(mod.dataset.y||0,10)};
    }
    overlay.classList.add('visible'); e.preventDefault();
  });

  document.addEventListener('pointermove', e=>{
    if(!dragState) return; const el = dragState.el; const rect = overlay.getBoundingClientRect();
    const cellW = rect.width / cols; const cellH = rect.height / rows;
    if(dragState.type === 'move'){
      const dx = Math.round((e.clientX - dragState.startX)/cellW);
      const dy = Math.round((e.clientY - dragState.startY)/cellH);
      let nx = Math.max(0, Math.min(cols-1, dragState.origX + dx));
      let ny = Math.max(0, Math.min(rows-1, dragState.origY + dy));
      const curW = parseInt(el.dataset.w||1,10); const curH = parseInt(el.dataset.h||1,10);
      if(nx + curW > cols) nx = cols - curW; if(ny + curH > rows) ny = rows - curH;
      el.dataset.x = nx; el.dataset.y = ny; placeModule(el);
    } else if(dragState.type === 'resize'){
      const dw = Math.round((e.clientX - dragState.startX)/(rect.width/cols));
      const dh = Math.round((e.clientY - dragState.startY)/(rect.height/rows));
      let nw = Math.max(1, Math.min(cols, dragState.startW + dw));
      let nh = Math.max(1, Math.min(rows, dragState.startH + dh));
      const curX = parseInt(el.dataset.x||0,10); const curY = parseInt(el.dataset.y||0,10);
      if(curX + nw > cols) nw = cols - curX; if(curY + nh > rows) nh = rows - curY;
      el.dataset.w = nw; el.dataset.h = nh; placeModule(el);
    }
    // highlight covered cells
    document.querySelectorAll('.grid-overlay .cell').forEach(c=>c.classList.remove('visible'));
    const x = parseInt(el.dataset.x||0,10), y = parseInt(el.dataset.y||0,10), w = parseInt(el.dataset.w||1,10), h = parseInt(el.dataset.h||1,10);
    for(let rr=y; rr<y+h; rr++) for(let cc=x; cc<x+w; cc++){ const idx = rr*cols + cc; const cell = overlay.children[idx]; if(cell) cell.classList.add('visible'); }
  });

  document.addEventListener('pointerup', ()=>{ if(dragState){ dragState=null; overlay.classList.remove('visible'); } saveLayout(); });

  // responsive: resize/orientation
  let resizeTimer = null; let lastOri = getOrientation();
  window.addEventListener('resize', ()=>{
    if(resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(()=>{
      const prev = lastOri; lastOri = getOrientation(); applyGridForOrientation(); fitDashboardToViewport();
      if(prev !== lastOri){ loadLayout(); }
      document.querySelectorAll('.module').forEach(m=>placeModule(m));
    }, 120);
  });

  // charts + KPIs
  async function loadLast30(){
    try{
      const res = await fetch('/api/transactions'); if(!res.ok) return;
      const data = await res.json();
      const today = new Date(Math.max(...data.map(d=>new Date(d.date))));
      const end = new Date(today); end.setHours(23,59,59,999);
      const start = new Date(end); start.setDate(end.getDate()-29); start.setHours(0,0,0,0);
      const dates = [];
      for(let i=0;i<30;i++){ const dt = new Date(start); dt.setDate(start.getDate()+i); dates.push(dt.toISOString().split('T')[0]); }
      const byDate = {}, storeTotals = {}, productTotals = {}, payTotals = {};
      data.forEach(t=>{
        const d = (new Date(t.date)).toISOString().split('T')[0];
        if(new Date(t.date) < start || new Date(t.date) > end) return;
        byDate[d] = (byDate[d]||0) + (parseFloat(t.amount)||0);
        storeTotals[t.shopName] = (storeTotals[t.shopName]||0) + (parseFloat(t.amount)||0);
        productTotals[t.product] = (productTotals[t.product]||0) + (parseFloat(t.amount)||0);
        payTotals[t.payType] = (payTotals[t.payType]||0) + (parseFloat(t.amount)||0);
      });
      const trendData = dates.map(d=>byDate[d]||0);
      const totalSales = Object.values(byDate).reduce((s,v)=>s+v,0);
      const transactionsCount = data.filter(t=>{ const dt = new Date(t.date); return dt >= start && dt <= end && parseFloat(t.amount) > 0; }).length;
      const avgTicket = transactionsCount>0 ? Math.round((totalSales/transactionsCount)*100)/100 : 0;
      const elTotal = document.getElementById('kpi-total-sales'); const elTrans = document.getElementById('kpi-transactions'); const elAvg = document.getElementById('kpi-avg-value');
      if(elTotal) elTotal.textContent = totalSales.toLocaleString(); if(elTrans) elTrans.textContent = transactionsCount.toLocaleString(); if(elAvg) elAvg.textContent = avgTicket.toLocaleString();
      const chartOptions = { responsive:true, maintainAspectRatio:false, plugins:{ legend:{ display:true, position:'bottom' } } };
      new Chart(document.getElementById('chart-sales-trend'), { type:'line', data:{ labels:dates, datasets:[{ data:trendData, borderColor:'#2196F3', backgroundColor:'rgba(33,150,243,0.08)', tension:0.4 }] }, options:{ ...chartOptions, plugins:{ ...chartOptions.plugins, legend:{ display:false } }, scales:{ x:{display:false}, y:{display:false} } } });
      new Chart(document.getElementById('chart-store-sales'), { type:'bar', data:{ labels:Object.keys(storeTotals), datasets:[{ data:Object.values(storeTotals), backgroundColor:'#36A2EB' }] }, options:{ ...chartOptions, plugins:{ ...chartOptions.plugins, legend:{ display:false } }, scales:{ x:{display:false}, y:{display:false} } } });
      new Chart(document.getElementById('chart-product-share'), { type:'doughnut', data:{ labels:Object.keys(productTotals), datasets:[{ data:Object.values(productTotals), backgroundColor:['#FF6384','#36A2EB','#FFCE56','#4BC0C0'] }] }, options:{ ...chartOptions, plugins:{ ...chartOptions.plugins, legend:{ display:false } } } });
      new Chart(document.getElementById('chart-pay-share'), { type:'pie', data:{ labels:Object.keys(payTotals), datasets:[{ data:Object.values(payTotals), backgroundColor:['#8AC926','#FF9F40','#9966FF'] }] }, options:{ ...chartOptions, plugins:{ ...chartOptions.plugins, legend:{ display:false } } } });
    }catch(e){ console.error('failed to load transactions',e); }
  }
  loadLast30();

})();
