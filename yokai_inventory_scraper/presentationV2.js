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
  const padBottom = parseInt(pwStyle.paddingBottom)||0;

  // clear any CSS min/max constraints so our explicit height can take effect
  dashboardInner.style.minHeight = '0px';
  dashboardInner.style.maxHeight = 'none';
  dashboardInner.style.overflow = 'hidden';

  // compute available vertical space from the top of the grid area to the viewport bottom
  const gridTop = gridAreaInner.getBoundingClientRect().top;
  // compute an initial height that fills from grid top down to viewport bottom (respect page-wrap bottom padding)
  let targetH = Math.max(80, Math.floor(window.innerHeight - padBottom - gridTop - 8));
  gridAreaInner.style.paddingBottom = '0px'; // clear the aspect-ratio fallback so explicit height wins

  // apply height and ensure the whole document fits inside the viewport.
  // If the page still overflows (scrollbar appears), iteratively shrink the grid a bit until it fits
  const minCellH = 24; // safety: each cell must remain usable
  const maxAttempts = 6;
  let attempts = 0;
  function applyHeight(h){ gridAreaInner.style.height = h + 'px'; document.querySelectorAll('.module').forEach(m=>placeModule(m)); }

  applyHeight(targetH);
  // if the page still scrolls, reduce the grid height by the overflow amount + small buffer
  while(attempts < maxAttempts && (document.documentElement.scrollHeight > window.innerHeight || document.body.scrollHeight > window.innerHeight)){
    const overflow = Math.max(0, document.documentElement.scrollHeight - window.innerHeight, document.body.scrollHeight - window.innerHeight);
    if(overflow <= 2) break; // negligible
    targetH = Math.max(minCellH * rows, targetH - (overflow + 6));
    applyHeight(targetH);
    attempts++;
  }
  // final placement done above
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

  // dragging / resizing (smooth, page-wide pointer movement with snap-on-release)
  let dragState = null;

  document.addEventListener('pointerdown', e=>{
    const mod = e.target.closest('.module'); if(!mod) return;
    const rect = mod.getBoundingClientRect();
    const overlayRect = overlay.getBoundingClientRect();
    if(e.target.classList.contains('resize-handle')){
      // store pixel-based start values for smooth resize
      dragState = {
        type: 'resize',
        el: mod,
        startX: e.clientX,
        startY: e.clientY,
        startPxW: rect.width,
        startPxH: rect.height,
        startRect: rect
      };
    } else {
      // store pixel offsets so the module follows the pointer smoothly across the page
      dragState = {
        type: 'move',
        el: mod,
        startPointerX: e.clientX,
        startPointerY: e.clientY,
        pointerOffsetX: e.clientX - rect.left,
        pointerOffsetY: e.clientY - rect.top,
        startLeftPx: rect.left - overlayRect.left,
        startTopPx: rect.top - overlayRect.top,
        origX: parseInt(mod.dataset.x||0,10),
        origY: parseInt(mod.dataset.y||0,10)
      };
      // ensure smooth visuals
      mod.classList.add('dragging');
      try{ if(e.target.setPointerCapture) e.target.setPointerCapture(e.pointerId); }catch(e){}
    }
    overlay.classList.add('visible');
    e.preventDefault();
  });

  document.addEventListener('pointermove', e=>{
    if(!dragState) return; const el = dragState.el; const rect = overlay.getBoundingClientRect();
    const cellW = rect.width / cols; const cellH = rect.height / rows;

    // live, pixel-based movement for fluid visuals; compute snap preview separately
    if(dragState.type === 'move'){
      // compute new pixel position relative to overlay (can be negative or beyond overlay)
      const newLeftPx = e.clientX - dragState.pointerOffsetX - rect.left + rect.left - rect.left; // keep relative to rect
      // simpler: compute absolute left relative to overlay left
      const absLeft = e.clientX - dragState.pointerOffsetX - rect.left;
      const absTop = e.clientY - dragState.pointerOffsetY - rect.top;

      // set element position in pixels for smooth follow
      el.style.left = absLeft + 'px';
      el.style.top = absTop + 'px';

      // compute snapped grid cell for preview
      let snapX = Math.round(absLeft / cellW);
      let snapY = Math.round(absTop / cellH);
      const curW = parseInt(el.dataset.w||1,10); const curH = parseInt(el.dataset.h||1,10);
      if(snapX < 0) snapX = 0; if(snapY < 0) snapY = 0;
      if(snapX + curW > cols) snapX = cols - curW;
      if(snapY + curH > rows) snapY = rows - curH;

      // highlight preview cells
      document.querySelectorAll('.grid-overlay .cell').forEach(c=>c.classList.remove('visible'));
      for(let rr=snapY; rr<snapY+curH; rr++) for(let cc=snapX; cc<snapX+curW; cc++){ const idx = rr*cols + cc; const cell = overlay.children[idx]; if(cell) cell.classList.add('visible'); }

    } else if(dragState.type === 'resize'){
      const rectEl = dragState.startRect; const deltaX = e.clientX - dragState.startX; const deltaY = e.clientY - dragState.startY;
      const newPxW = Math.max(24, dragState.startPxW + deltaX);
      const newPxH = Math.max(24, dragState.startPxH + deltaY);
      el.style.width = newPxW + 'px'; el.style.height = newPxH + 'px';

      // compute snap preview for resize
      const relLeft = rectEl.left - rect.left; const relTop = rectEl.top - rect.top;
      let snapW = Math.round(newPxW / (rect.width/cols));
      let snapH = Math.round(newPxH / (rect.height/rows));
      if(snapW < 1) snapW = 1; if(snapH < 1) snapH = 1;
      const snapX = Math.max(0, Math.min(cols-1, Math.round(relLeft/(rect.width/cols))));
      const snapY = Math.max(0, Math.min(rows-1, Math.round(relTop/(rect.height/rows))));
      if(snapX + snapW > cols) snapW = cols - snapX; if(snapY + snapH > rows) snapH = rows - snapY;

      document.querySelectorAll('.grid-overlay .cell').forEach(c=>c.classList.remove('visible'));
      for(let rr=snapY; rr<snapY+snapH; rr++) for(let cc=snapX; cc<snapX+snapW; cc++){ const idx = rr*cols + cc; const cell = overlay.children[idx]; if(cell) cell.classList.add('visible'); }
    }
  });

  document.addEventListener('pointerup', e=>{
    if(!dragState) return;
    const el = dragState.el; const rect = overlay.getBoundingClientRect();
    const cellW = rect.width / cols; const cellH = rect.height / rows;

    if(dragState.type === 'move'){
      // determine final snapped grid coordinates from current pixel left/top
      const curLeft = parseFloat(getComputedStyle(el).left) || 0;
      const curTop = parseFloat(getComputedStyle(el).top) || 0;
      let finalX = Math.round(curLeft / cellW); let finalY = Math.round(curTop / cellH);
      const curW = parseInt(el.dataset.w||1,10); const curH = parseInt(el.dataset.h||1,10);
      if(finalX < 0) finalX = 0; if(finalY < 0) finalY = 0;
      if(finalX + curW > cols) finalX = cols - curW; if(finalY + curH > rows) finalY = rows - curH;
      el.dataset.x = finalX; el.dataset.y = finalY; placeModule(el);
      el.classList.remove('dragging');
      try{ if(e.target.releasePointerCapture) e.target.releasePointerCapture(e.pointerId); }catch(e){}
    } else if(dragState.type === 'resize'){
      // compute final width/height in grid cells
      const styleW = parseFloat(getComputedStyle(el).width) || dragState.startPxW;
      const styleH = parseFloat(getComputedStyle(el).height) || dragState.startPxH;
      const relLeft = dragState.startRect.left - rect.left;
      const relTop = dragState.startRect.top - rect.top;
      let finalW = Math.round(styleW / (rect.width/cols)); let finalH = Math.round(styleH / (rect.height/rows));
      if(finalW < 1) finalW = 1; if(finalH < 1) finalH = 1;
      let finalX = Math.round(relLeft / (rect.width/cols)); let finalY = Math.round(relTop / (rect.height/rows));
      if(finalX < 0) finalX = 0; if(finalY < 0) finalY = 0;
      if(finalX + finalW > cols) finalW = cols - finalX; if(finalY + finalH > rows) finalH = rows - finalY;
      el.dataset.w = finalW; el.dataset.h = finalH; el.dataset.x = finalX; el.dataset.y = finalY; placeModule(el);
    }

    overlay.classList.remove('visible'); document.querySelectorAll('.grid-overlay .cell').forEach(c=>c.classList.remove('visible'));
    dragState = null; saveLayout();
  });

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
