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

  // capture blueprint templates for all initial modules so deleting live instances doesn't remove the template
  const moduleTemplates = new Map();
  document.querySelectorAll('.module').forEach(m=>{
    try{ moduleTemplates.set(m.id, m.cloneNode(true)); }catch(e){}
  });

  // dragging / resizing (smooth, page-wide pointer movement with snap-on-release)
  let dragState = null;
  // map of chart instances for cleanup/rebuild
  const chartRegistry = new Map();
  // cache of last loaded data from /api/transactions so newly spawned modules can render immediately
  let lastLoadData = null;
  // simple logger helper
  const log = (...args)=>{ try{ console.log('[presentationV2]', ...args); }catch(e){} };
  // toolbox & trash
  const toolboxButton = document.querySelector('.toolbox-button');
  const toolboxPanel = document.querySelector('.toolbox-panel');
  const toolboxItems = Array.from(document.querySelectorAll('.toolbox-item'));
  const trashBin = document.createElement('div'); trashBin.className = 'trash-bin'; trashBin.innerHTML = '<div class="icon">🗑️</div>'; document.body.appendChild(trashBin);

  document.addEventListener('pointerdown', e=>{
    // allow starting drag from existing modules or from toolbox items
    const tbItem = e.target.closest('.toolbox-item');
    if(tbItem){
      // spawn a new module clone from template id and immediately start dragging from pointer
  const templateId = tbItem.dataset.moduleId;
  // prefer DOM template, fallback to stored blueprint template
  const domTemplate = document.getElementById(templateId);
  const blueprint = moduleTemplates.get(templateId);
  const templateNode = domTemplate || blueprint;
  log('toolbox spawn request for', templateId, 'dom?', !!domTemplate, 'blueprint?', !!blueprint);
  if(!templateNode) return;
  const clone = templateNode.cloneNode(true);
      const uid = templateId + '-' + Math.random().toString(36).slice(2,8);
      clone.id = uid;
  // record which template this clone was created from
  clone.dataset.templateId = templateId;
  // make any descendant ids unique to avoid collisions (canvases handled earlier but do for all)
  const descIds = clone.querySelectorAll('[id]');
  descIds.forEach(d=>{ d.id = d.id + '-' + uid; });
  clone.dataset.x = 0; clone.dataset.y = 0; clone.dataset.w = templateNode.dataset.w || 1; clone.dataset.h = templateNode.dataset.h || 1;
      // ensure any canvas inside clone gets a unique id
      const canvases = clone.querySelectorAll('canvas');
      canvases.forEach((c, idx)=>{ const nid = c.id ? c.id + '-' + uid : 'canvas-' + uid + '-' + idx; c.id = nid; });
      // attach to body as fixed so we can position under pointer reliably
      clone.style.position = 'fixed';
      clone.style.left = (e.clientX - 40) + 'px';
      clone.style.top = (e.clientY - 24) + 'px';
      // reasonable default size until snap
  clone.style.width = (templateNode.offsetWidth || 260) + 'px';
  clone.style.height = (templateNode.offsetHeight || 120) + 'px';
      clone.classList.add('dragging');
      document.body.appendChild(clone);
      // initialize placeholder charts and if we have recent data, render into them
      try{ initChartsForModule(clone); }catch(e){ log('initChartsForModule error', e); }
      if(lastLoadData){
        log('rendering cached data into clone', clone.id);
        // render each canvas according to module semantics
        const cList = clone.querySelectorAll('canvas');
        cList.forEach(c => { try{ renderChartForModuleCanvas(c.id, clone.id, lastLoadData); }catch(e){ log('renderChartForModuleCanvas error', e); } });
        // populate KPI values for clones of KPI templates
        try{ setKpiValuesForModule(clone, templateId, lastLoadData); }catch(e){ log('setKpiValuesForModule error', e); }
      } else {
        log('no cached data available when spawning clone', clone.id);
      }
      // create drag state so pointermove will control this clone
      dragState = {
        type: 'move', el: clone,
        startPointerX: e.clientX, startPointerY: e.clientY,
        pointerOffsetX: 20, pointerOffsetY: 20,
        startLeftPx: e.clientX - 20, startTopPx: e.clientY - 20,
        origX: 0, origY: 0, detached: true, prevParent: null, prevNext: null
      };
      // show overlay and trash
      overlay.classList.add('visible'); trashBin.classList.add('visible');
      try{ if(e.target.setPointerCapture) e.target.setPointerCapture(e.pointerId); }catch(e){}
      e.stopPropagation();
      return; // we've set dragState for the new clone; skip normal handling
    } else {
      var mod = e.target.closest('.module'); if(!mod) return;
    }
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
  // detach element to document.body so it floats above everything
  dragState.detached = true;
  dragState.prevParent = mod.parentNode;
  dragState.prevNext = mod.nextSibling;
  // set fixed positioning using viewport coords
  mod.style.position = 'fixed';
  mod.style.left = rect.left + 'px';
  mod.style.top = rect.top + 'px';
  mod.style.width = rect.width + 'px';
  mod.style.height = rect.height + 'px';
  mod.classList.add('dragging');
  document.body.appendChild(mod);
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
      // if detached (fixed), follow viewport pointer; otherwise follow relative to overlay
      const curLeftPx = e.clientX - dragState.pointerOffsetX;
      const curTopPx = e.clientY - dragState.pointerOffsetY;
      if(dragState.detached){
        // fixed positioning in viewport
        el.style.left = curLeftPx + 'px';
        el.style.top = curTopPx + 'px';
      } else {
        // relative to overlay
        const absLeft = curLeftPx - rect.left;
        const absTop = curTopPx - rect.top;
        el.style.left = absLeft + 'px';
        el.style.top = absTop + 'px';
      }

      // compute snapped grid cell for preview (always relative to overlay)
      const absLeftForSnap = (e.clientX - dragState.pointerOffsetX) - rect.left;
      const absTopForSnap = (e.clientY - dragState.pointerOffsetY) - rect.top;
      let snapX = Math.round(absLeftForSnap / cellW);
      let snapY = Math.round(absTopForSnap / cellH);
      const curW = parseInt(el.dataset.w||1,10); const curH = parseInt(el.dataset.h||1,10);
      if(snapX < 0) snapX = 0; if(snapY < 0) snapY = 0;
      if(snapX + curW > cols) snapX = cols - curW;
      if(snapY + curH > rows) snapY = rows - curH;

      // highlight preview cells
      document.querySelectorAll('.grid-overlay .cell').forEach(c=>c.classList.remove('visible'));
      for(let rr=snapY; rr<snapY+curH; rr++) for(let cc=snapX; cc<snapX+curW; cc++){ const idx = rr*cols + cc; const cell = overlay.children[idx]; if(cell) cell.classList.add('visible'); }
  // show trash bin while dragging
  trashBin.classList.add('visible');
  // detect if pointer over trash
  const trashRect = trashBin.getBoundingClientRect();
  if(e.clientY >= trashRect.top && e.clientY <= trashRect.bottom && e.clientX >= trashRect.left && e.clientX <= trashRect.right){ trashBin.classList.add('drag-over'); } else { trashBin.classList.remove('drag-over'); }

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
    // show trash bin while resizing too
    trashBin.classList.add('visible');
    }
  });

  document.addEventListener('pointerup', e=>{
    if(!dragState) return;
    const el = dragState.el; const rect = overlay.getBoundingClientRect();
    const cellW = rect.width / cols; const cellH = rect.height / rows;

    if(dragState.type === 'move'){
      // determine final snapped grid coordinates from current pixel left/top (relative to overlay)
      // current pixel left when detached: el.style.left (viewport px); when attached: computed left is overlay-relative
      const curLeftViewport = parseFloat(el.style.left) || 0;
      const curTopViewport = parseFloat(el.style.top) || 0;
      // convert to overlay-relative
      const curLeft = (dragState.detached ? (curLeftViewport - rect.left) : curLeftViewport);
      const curTop = (dragState.detached ? (curTopViewport - rect.top) : curTopViewport);
      let finalX = Math.round(curLeft / cellW); let finalY = Math.round(curTop / cellH);
      const curW = parseInt(el.dataset.w||1,10); const curH = parseInt(el.dataset.h||1,10);
      if(finalX < 0) finalX = 0; if(finalY < 0) finalY = 0;
      if(finalX + curW > cols) finalX = cols - curW; if(finalY + curH > rows) finalY = rows - curH;

      // animate to snapped position and reattach to grid-area-inner
      const finalLeftPx = finalX * cellW;
      const finalTopPx = finalY * cellH;

      // restore element into gridAreaInner as absolute positioned element with current overlay-relative coords
      const currentOverlayLeft = curLeft;
      const currentOverlayTop = curTop;

      // if detached, move back into grid area before animating
      if(dragState.detached){
        // set absolute position within gridAreaInner to match current visual position
        el.style.position = 'absolute';
        el.style.left = currentOverlayLeft + 'px';
        el.style.top = currentOverlayTop + 'px';
        // append back to grid-area-inner so placeModule and transitions work
        gridAreaInner.appendChild(el);
      }

      // add snapping class to animate
      el.classList.add('snapping');
      // force reflow then set final (placeModule will set width/height too)
      void el.offsetWidth;
      el.dataset.x = finalX; el.dataset.y = finalY; placeModule(el);

      // remove dragging class; release pointer capture
      el.classList.remove('dragging');
        // check if dropped into trash
        const trashRect = trashBin.getBoundingClientRect();
        const dropX = e.clientX; const dropY = e.clientY;
        if(dropY >= trashRect.top && dropY <= trashRect.bottom && dropX >= trashRect.left && dropX <= trashRect.right){
    // remove element and cleanup charts
    // destroy chart instances inside this module
    const canvases = el.querySelectorAll('canvas');
    canvases.forEach(c=>{ const inst = chartRegistry.get(c.id); if(inst && inst.destroy) try{ inst.destroy(); }catch(e){} chartRegistry.delete(c.id); });
    el.remove();
          trashBin.classList.remove('visible','drag-over');
          dragState = null; saveLayout(); return;
        }
      try{ if(e.target.releasePointerCapture) e.target.releasePointerCapture(e.pointerId); }catch(e){}
      // remove snapping class after transition ends
      const onEnd = (ev)=>{ if(['left','top','width','height'].includes(ev.propertyName)){ el.classList.remove('snapping'); el.removeEventListener('transitionend', onEnd); } };
      el.addEventListener('transitionend', onEnd);
    } else if(dragState.type === 'resize'){
      // compute final width/height in grid cells and animate
      const styleW = parseFloat(getComputedStyle(el).width) || dragState.startPxW;
      const styleH = parseFloat(getComputedStyle(el).height) || dragState.startPxH;
      const relLeft = dragState.startRect.left - rect.left;
      const relTop = dragState.startRect.top - rect.top;
      let finalW = Math.round(styleW / (rect.width/cols)); let finalH = Math.round(styleH / (rect.height/rows));
      if(finalW < 1) finalW = 1; if(finalH < 1) finalH = 1;
      let finalX = Math.round(relLeft / (rect.width/cols)); let finalY = Math.round(relTop / (rect.height/rows));
      if(finalX < 0) finalX = 0; if(finalY < 0) finalY = 0;
      if(finalX + finalW > cols) finalW = cols - finalX; if(finalY + finalH > rows) finalH = rows - finalY;

      el.classList.add('snapping');
      void el.offsetWidth;
      el.dataset.w = finalW; el.dataset.h = finalH; el.dataset.x = finalX; el.dataset.y = finalY; placeModule(el);
      const onEndResize = (ev)=>{ if(['width','height','left','top'].includes(ev.propertyName)){ el.classList.remove('snapping'); el.removeEventListener('transitionend', onEndResize); } };
      el.addEventListener('transitionend', onEndResize);
    }

      overlay.classList.remove('visible'); document.querySelectorAll('.grid-overlay .cell').forEach(c=>c.classList.remove('visible'));
      // hide trash
      trashBin.classList.remove('visible','drag-over');
    dragState = null; saveLayout();
  });

  // helper: initialize charts inside a module (if any) using existing data loader or placeholders
  function initChartsForModule(moduleEl){
    const canvases = moduleEl.querySelectorAll('canvas');
    canvases.forEach(c=>{
      try{
        // if a chart already exists for this canvas id, destroy it
        const existing = chartRegistry.get(c.id); if(existing && existing.destroy) existing.destroy();
      }catch(e){}
      // try to instantiate a simple empty chart if canvas exists and data not ready
      const ctx = c.getContext && c.getContext('2d'); if(!ctx) return;
      // create a minimal placeholder chart so Chart.js has instance to manage sizing
      try{
        const chart = new Chart(c, { type:'bar', data:{ labels:[], datasets:[{ data:[] }] }, options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{ display:false } }, scales:{ x:{display:false}, y:{display:false} } } });
        chartRegistry.set(c.id, chart);
        if(lastLoadData){ try{ renderChartForModuleCanvas(c.id, moduleEl.id, lastLoadData); }catch(e){} }
      }catch(e){}
    });
  }

  // helper: render a chart canvas according to module id and lastLoadData
  function renderChartForModuleCanvas(canvasId, moduleId, data){
    if(!data) return;
    try{
      // determine type by moduleId pattern
      if((moduleId && moduleId.includes('sales-trend')) || (canvasId && canvasId.includes('sales-trend'))){
        const cfg = { type:'line', data:{ labels:data.dates, datasets:[{ data:data.trendData, borderColor:'#2196F3', backgroundColor:'rgba(33,150,243,0.08)', tension:0.4 }] }, options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{ display:false } }, scales:{ x:{display:false}, y:{display:false} } } };
        const el = document.getElementById(canvasId); if(!el) return; const prev = chartRegistry.get(canvasId); if(prev && prev.destroy) prev.destroy(); chartRegistry.set(canvasId, new Chart(el, cfg));
      } else if((moduleId && moduleId.includes('store-sales')) || (canvasId && canvasId.includes('store-sales'))){
        const cfg = { type:'bar', data:{ labels:Object.keys(data.storeTotals), datasets:[{ data:Object.values(data.storeTotals), backgroundColor:'#36A2EB' }] }, options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{ display:false } }, scales:{ x:{display:false}, y:{display:false} } } };
        const el = document.getElementById(canvasId); if(!el) return; const prev = chartRegistry.get(canvasId); if(prev && prev.destroy) prev.destroy(); chartRegistry.set(canvasId, new Chart(el, cfg));
      } else if((moduleId && moduleId.includes('product-share')) || (canvasId && canvasId.includes('product-share'))){
        const cfg = { type:'doughnut', data:{ labels:Object.keys(data.productTotals), datasets:[{ data:Object.values(data.productTotals), backgroundColor:['#FF6384','#36A2EB','#FFCE56','#4BC0C0'] }] }, options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{ display:false } } } };
        const el = document.getElementById(canvasId); if(!el) return; const prev = chartRegistry.get(canvasId); if(prev && prev.destroy) prev.destroy(); chartRegistry.set(canvasId, new Chart(el, cfg));
      } else if((moduleId && moduleId.includes('pay-share')) || (canvasId && canvasId.includes('pay-share'))){
        const cfg = { type:'pie', data:{ labels:Object.keys(data.payTotals), datasets:[{ data:Object.values(data.payTotals), backgroundColor:['#8AC926','#FF9F40','#9966FF'] }] }, options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{ display:false } } } };
        const el = document.getElementById(canvasId); if(!el) return; const prev = chartRegistry.get(canvasId); if(prev && prev.destroy) prev.destroy(); chartRegistry.set(canvasId, new Chart(el, cfg));
      }
    }catch(e){ console.error('renderChartForModuleCanvas error', e); }
  }

  // helper: populate KPI values for a newly cloned KPI module using lastLoadData
  function setKpiValuesForModule(moduleEl, templateId, data){
    if(!data) return;
    // mapping of template ids to KPI element ids inside the template (assumes original templates used these ids)
    const map = {
      'm-kpi-total-sales': 'kpi-total-sales',
      'm-kpi-transactions': 'kpi-transactions',
      'm-kpi-avg-value': 'kpi-avg-value'
    };
    const kpiKey = map[templateId];
    if(!kpiKey) return;
  // find the descendant element in the clone that contains the original KPI id (ids were uniquified)
  const el = Array.from(moduleEl.querySelectorAll('[id]')).find(n=>n.id && n.id.includes(kpiKey));
    if(!el) return;
  if(kpiKey === 'kpi-total-sales') { el.textContent = (data.totalSales||0).toLocaleString(); log('set KPI total-sales on', moduleEl.id, el.id, data.totalSales); }
  else if(kpiKey === 'kpi-transactions') { el.textContent = (data.transactionsCount||0).toLocaleString(); log('set KPI transactions on', moduleEl.id, el.id, data.transactionsCount); }
  else if(kpiKey === 'kpi-avg-value') { el.textContent = (data.avgTicket||0).toLocaleString(); log('set KPI avg on', moduleEl.id, el.id, data.avgTicket); }
  }

    // toolbox UI behavior: toggle panel and enable dragging from toolbox items
    if(toolboxButton && toolboxPanel){
      toolboxButton.addEventListener('click', ()=>{
        const open = toolboxButton.getAttribute('aria-expanded') === 'true';
        toolboxButton.setAttribute('aria-expanded', (!open).toString());
        toolboxPanel.hidden = open;
      });
    }

  // NOTE: toolbox item pointer handling is managed by the document-level pointerdown
  // to avoid duplicate pointer capture we do not attach per-item pointer handlers here.

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
  log('fetching /api/transactions');
  const res = await fetch('/api/transactions'); if(!res.ok){ log('/api/transactions response not ok', res.status); return; }
  const data = await res.json(); log('/api/transactions returned', Array.isArray(data)?data.length:'non-array');
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
  // cache for later usage by spawned modules
  lastLoadData = { dates, trendData, storeTotals, productTotals, payTotals, totalSales, transactionsCount, avgTicket };
  log('lastLoadData cached', { totalSales, transactionsCount, avgTicket, stores: Object.keys(storeTotals).length });
      const elTotal = document.getElementById('kpi-total-sales'); const elTrans = document.getElementById('kpi-transactions'); const elAvg = document.getElementById('kpi-avg-value');
      if(elTotal) elTotal.textContent = totalSales.toLocaleString(); if(elTrans) elTrans.textContent = transactionsCount.toLocaleString(); if(elAvg) elAvg.textContent = avgTicket.toLocaleString();
      const chartOptions = { responsive:true, maintainAspectRatio:false, plugins:{ legend:{ display:true, position:'bottom' } } };
      // create or update Chart instances and register them
      const makeOrUpdate = (cid, cfg)=>{
        const el = document.getElementById(cid); if(!el) return;
        try{
          const prev = chartRegistry.get(el.id);
          if(prev && prev.destroy) prev.destroy();
        }catch(e){}
        try{ const chart = new Chart(el, cfg); chartRegistry.set(el.id, chart); }catch(e){}
      };

      makeOrUpdate('chart-sales-trend', { type:'line', data:{ labels:dates, datasets:[{ data:trendData, borderColor:'#2196F3', backgroundColor:'rgba(33,150,243,0.08)', tension:0.4 }] }, options:{ ...chartOptions, plugins:{ ...chartOptions.plugins, legend:{ display:false } }, scales:{ x:{display:false}, y:{display:false} } } });
      makeOrUpdate('chart-store-sales', { type:'bar', data:{ labels:Object.keys(storeTotals), datasets:[{ data:Object.values(storeTotals), backgroundColor:'#36A2EB' }] }, options:{ ...chartOptions, plugins:{ ...chartOptions.plugins, legend:{ display:false } }, scales:{ x:{display:false}, y:{display:false} } } });
      makeOrUpdate('chart-product-share', { type:'doughnut', data:{ labels:Object.keys(productTotals), datasets:[{ data:Object.values(productTotals), backgroundColor:['#FF6384','#36A2EB','#FFCE56','#4BC0C0'] }] }, options:{ ...chartOptions, plugins:{ ...chartOptions.plugins, legend:{ display:false } } } });
      makeOrUpdate('chart-pay-share', { type:'pie', data:{ labels:Object.keys(payTotals), datasets:[{ data:Object.values(payTotals), backgroundColor:['#8AC926','#FF9F40','#9966FF'] }] }, options:{ ...chartOptions, plugins:{ ...chartOptions.plugins, legend:{ display:false } } } });
    }catch(e){ console.error('failed to load transactions',e); }
  }
  loadLast30();

})();
