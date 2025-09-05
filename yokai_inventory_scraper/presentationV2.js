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

  // localStorage persistence (orientation-specific) - redesigned
  const LAYOUT_VERSION = 1;
  function _layoutKeyForOrientation(ori){ return `presentationV2.layout.v${LAYOUT_VERSION}.` + (ori || getOrientation()); }

  // debounced save helper
  let _saveTimer = null;
  function scheduleSave(delay = 250){
    if(_saveTimer) clearTimeout(_saveTimer);
    _saveTimer = setTimeout(()=>{ try{ saveLayout(); }catch(e){ console.warn('scheduled save failed', e); } finally{ _saveTimer = null; } }, delay);
  }

  // map of chart instances for cleanup/rebuild
  const chartRegistry = new Map();
  // cache of last loaded data from /api/transactions so newly spawned modules can render immediately
  let lastLoadData = null;
  // simple logger helper (available early so persistence functions can use it)
  const log = (...args)=>{ try{ console.log('[presentationV2]', ...args); }catch(e){} };

  function saveLayout(){
    try{
  // if a debounced save is waiting, clear it because we're performing immediate save
  if(_saveTimer){ clearTimeout(_saveTimer); _saveTimer = null; }

  const list = Array.from(document.querySelectorAll('.module')).map(m=>({
        id: m.id,
        x: parseInt(m.dataset.x||0,10),
        y: parseInt(m.dataset.y||0,10),
        w: parseInt(m.dataset.w||1,10),
        h: parseInt(m.dataset.h||1,10),
        templateId: m.dataset.templateId || null
      }));
      const payload = { v: LAYOUT_VERSION, cols, rows, modules:list, ts: Date.now() };
      const key = _layoutKeyForOrientation();
  localStorage.setItem(key, JSON.stringify(payload));
  log('layout saved', key, payload.modules.length);
  console.log('[presentationV2] layout saved ->', key, payload.modules.length, 'modules', list.map(x=>x.id));
    }catch(e){ console.error('[presentationV2] saveLayout failed', e); }
  }

  function loadLayout(){
    try{
      const key = _layoutKeyForOrientation();
      const raw = localStorage.getItem(key);
      if(!raw){ console.log('[presentationV2] no saved layout for', key); return; }
      const obj = JSON.parse(raw);
      if(!obj || !Array.isArray(obj.modules)) { console.warn('[presentationV2] saved layout invalid format, ignoring', key); return; }
      if(!obj.v || obj.v !== LAYOUT_VERSION){ console.log('[presentationV2] saved layout version mismatch or absent, ignoring saved layout', key, obj && obj.v); return; }

      console.log('[presentationV2] loading layout from', key, 'modules:', obj.modules.length);

      // authoritative restore: remove any existing modules not present in saved list,
      // recreate missing ones, then set positions/sizes.
      const savedIds = new Set(obj.modules.map(m=>m && m.id).filter(Boolean));
      // destroy and remove any DOM modules that are not in savedIds
      document.querySelectorAll('.module').forEach(existing => {
        if(!savedIds.has(existing.id)){
          try{
            // destroy charts inside
            existing.querySelectorAll('canvas').forEach(c=>{ const inst = chartRegistry.get(c.id); if(inst && inst.destroy) try{ inst.destroy(); }catch(e){} chartRegistry.delete(c.id); });
            existing.remove();
            console.log('[presentationV2] removed module not in saved layout:', existing.id);
          }catch(e){ console.warn('[presentationV2] error removing module', existing.id, e); }
        }
      });

      // now ensure each saved module exists and set its geometry
      obj.modules.forEach(m => {
        if(!m || !m.id) return;
        let el = document.getElementById(m.id);
        if(!el){
          // try to recreate from templateId (if available)
          const tplId = m.templateId;
          const tplDom = tplId ? document.getElementById(tplId) : null;
          const tplBlueprint = (typeof moduleTemplates !== 'undefined') ? moduleTemplates.get(tplId) : null;
          const tpl = tplDom || tplBlueprint;
          if(tpl){
            try{
              const clone = tpl.cloneNode(true);
              clone.id = m.id;
              // mark origin templateId
              if(tplId) clone.dataset.templateId = tplId;
              // uniquify descendant ids to avoid collisions
              const desc = clone.querySelectorAll('[id]');
              desc.forEach(d => { d.id = d.id + '-' + m.id; });
              // uniquify canvases if present
              const canvases = clone.querySelectorAll('canvas');
              canvases.forEach((c, idx)=>{ const nid = c.id ? c.id + '-' + m.id : 'canvas-' + m.id + '-' + idx; c.id = nid; });
              // append to grid area
              gridAreaInner.appendChild(clone);
              el = clone;
              console.log('[presentationV2] recreated module from template:', m.id, 'templateId:', tplId);
              // initialize charts if we have data
              try{ initChartsForModule(el); if(lastLoadData) { el.querySelectorAll('canvas').forEach(c=>{ try{ renderChartForModuleCanvas(c.id, el.id, lastLoadData); }catch(e){} }); } }catch(e){ console.warn('[presentationV2] initChartsForModule error', e); }
            }catch(e){ console.warn('[presentationV2] failed to recreate module', m.id, e); }
          } else {
            // cannot restore this module; create a lightweight placeholder so user can see missing module
            try{
              const ph = document.createElement('div'); ph.className = 'module placeholder'; ph.id = m.id; ph.dataset.templateId = m.templateId || '';
              ph.textContent = 'Missing template: ' + (m.templateId || 'unknown');
              ph.style.border = '1px dashed #f00'; ph.style.background = '#fff7f7'; ph.style.padding = '8px';
              gridAreaInner.appendChild(ph);
              el = ph;
              console.warn('[presentationV2] missing template for saved module', m.id, m.templateId);
            }catch(e){ console.warn('[presentationV2] cannot create placeholder for', m.id, e); }
          }
        }
        // clamp values to current grid
        const nx = Math.max(0, Math.min(cols - (m.w||1), parseInt(m.x||0,10)));
        const ny = Math.max(0, Math.min(rows - (m.h||1), parseInt(m.y||0,10)));
        const nw = Math.max(1, Math.min(cols, parseInt(m.w||1,10)));
        const nh = Math.max(1, Math.min(rows, parseInt(m.h||1,10)));
        if(el){ el.dataset.x = nx; el.dataset.y = ny; el.dataset.w = nw; el.dataset.h = nh; }
      });
      console.log('[presentationV2] layout loaded', key);
    }catch(e){ console.warn('[presentationV2] loadLayout failed', e); }
  }

  // observe grid child changes (add/remove) to ensure saves catch additions/deletions
  try{
    const gridObserver = new MutationObserver((mutations)=>{
      let changed = false;
      for(const m of mutations){ if(m.type === 'childList' && (m.addedNodes.length || m.removedNodes.length)) { changed = true; break; } }
      if(changed){ console.log('[presentationV2] grid DOM changed, scheduling save'); scheduleSave(); }
    });
    gridObserver.observe(gridAreaInner, { childList: true });
  }catch(e){ console.warn('[presentationV2] mutation observer not available', e); }

  // ensure we save on visibility change / unload to reduce lost edits
  try{
    document.addEventListener('visibilitychange', ()=>{ if(document.visibilityState === 'hidden'){ try{ saveLayout(); }catch(e){} } });
    window.addEventListener('beforeunload', ()=>{ try{ saveLayout(); }catch(e){} });
  }catch(e){ }

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
  applyGridForOrientation(); fitDashboardToViewport();
  document.querySelectorAll('.module').forEach(m=>placeModule(m));

  // capture blueprint templates for all initial modules so deleting live instances doesn't remove the template
  const moduleTemplates = new Map();
  document.querySelectorAll('.module').forEach(m=>{
    try{ moduleTemplates.set(m.id, m.cloneNode(true)); }catch(e){}
  });

  // helper: clear default modules (remove all current modules, clear templates and saved layouts)
  function clearDefaultsAndSave(){
    try{
      console.log('[presentationV2] clearing all modules and templates...');
      // destroy charts and remove DOM modules
      document.querySelectorAll('.module').forEach(m=>{
        try{ m.querySelectorAll('canvas').forEach(c=>{ const inst = chartRegistry.get(c.id); if(inst && inst.destroy) try{ inst.destroy(); }catch(e){} chartRegistry.delete(c.id); }); }catch(e){}
        try{ m.remove(); }catch(e){}
      });
      // clear in-memory templates
      moduleTemplates.clear();
      // remove saved layout keys for both orientations
      ['landscape','portrait'].forEach(o=>{ const k = _layoutKeyForOrientation(o); try{ localStorage.removeItem(k); console.log('[presentationV2] removed saved layout key', k); }catch(e){ console.warn('[presentationV2] removeItem failed', k, e); } });
      // write an empty layout to persist "no modules"
      try{ saveLayout(); }catch(e){ console.warn('[presentationV2] saveLayout failed after clear', e); }
      console.log('[presentationV2] clearDefaultsAndSave finished');
    }catch(e){ console.warn('[presentationV2] clearDefaultsAndSave error', e); }
  }

  // expose a small API for manual debugging from DevTools
  try{ window.presentationV2 = window.presentationV2 || {}; window.presentationV2.clearDefaults = clearDefaultsAndSave; window.presentationV2.saveLayout = saveLayout; window.presentationV2.loadLayout = loadLayout; console.log('[presentationV2] API exposed: presentationV2.clearDefaults(), .saveLayout(), .loadLayout()'); }catch(e){}

  // try to load saved layout for current orientation (will recreate clones if needed)
  try{ loadLayout(); document.querySelectorAll('.module').forEach(m=>placeModule(m)); }catch(e){ }

  // dragging / resizing (smooth, page-wide pointer movement with snap-on-release)
  let dragState = null;
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
  console.log('[presentationV2] deleting module via trash drop:', el.id);
  el.remove();
      trashBin.classList.remove('visible','drag-over');
      // save layout after deletion
      try{ saveLayout(); console.log('[presentationV2] saveLayout called after deletion'); }catch(e){ console.warn('[presentationV2] saveLayout error after deletion', e); }
          dragState = null; return;
        }
      try{ if(e.target.releasePointerCapture) e.target.releasePointerCapture(e.pointerId); }catch(e){}
      // remove snapping class after transition ends
      const onEnd = (ev)=>{ if(['left','top','width','height'].includes(ev.propertyName)){ el.classList.remove('snapping'); el.removeEventListener('transitionend', onEnd); } };
      el.addEventListener('transitionend', onEnd);
  // save layout after move
  try{ saveLayout(); }catch(e){}
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
  // save layout after resize
  try{ saveLayout(); }catch(e){}
    }

      overlay.classList.remove('visible'); document.querySelectorAll('.grid-overlay .cell').forEach(c=>c.classList.remove('visible'));
      // hide trash
      trashBin.classList.remove('visible','drag-over');
    dragState = null;
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
  const el = document.getElementById(canvasId); if(!el) return; try{ const prev = chartRegistry.get(canvasId) || (window.Chart && Chart.getChart && Chart.getChart(el)); if(prev && prev.destroy) try{ prev.destroy(); }catch(e){} chartRegistry.delete(canvasId); }catch(e){}
  try{ const chart = new Chart(el, cfg); chartRegistry.set(canvasId, chart); }catch(e){ console.error('chart create failed', e); }
      } else if((moduleId && moduleId.includes('store-sales')) || (canvasId && canvasId.includes('store-sales'))){
        const cfg = { type:'bar', data:{ labels:Object.keys(data.storeTotals), datasets:[{ data:Object.values(data.storeTotals), backgroundColor:'#36A2EB' }] }, options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{ display:false } }, scales:{ x:{display:false}, y:{display:false} } } };
  const el = document.getElementById(canvasId); if(!el) return; try{ const prev = chartRegistry.get(canvasId) || (window.Chart && Chart.getChart && Chart.getChart(el)); if(prev && prev.destroy) try{ prev.destroy(); }catch(e){} chartRegistry.delete(canvasId); }catch(e){}
  try{ const chart = new Chart(el, cfg); chartRegistry.set(canvasId, chart); }catch(e){ console.error('chart create failed', e); }
      } else if((moduleId && moduleId.includes('product-share')) || (canvasId && canvasId.includes('product-share'))){
        const cfg = { type:'doughnut', data:{ labels:Object.keys(data.productTotals), datasets:[{ data:Object.values(data.productTotals), backgroundColor:['#FF6384','#36A2EB','#FFCE56','#4BC0C0'] }] }, options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{ display:false } } } };
  const el = document.getElementById(canvasId); if(!el) return; try{ const prev = chartRegistry.get(canvasId) || (window.Chart && Chart.getChart && Chart.getChart(el)); if(prev && prev.destroy) try{ prev.destroy(); }catch(e){} chartRegistry.delete(canvasId); }catch(e){}
  try{ const chart = new Chart(el, cfg); chartRegistry.set(canvasId, chart); }catch(e){ console.error('chart create failed', e); }
      } else if((moduleId && moduleId.includes('pay-share')) || (canvasId && canvasId.includes('pay-share'))){
        const cfg = { type:'pie', data:{ labels:Object.keys(data.payTotals), datasets:[{ data:Object.values(data.payTotals), backgroundColor:['#8AC926','#FF9F40','#9966FF'] }] }, options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{ display:false } } } };
  const el = document.getElementById(canvasId); if(!el) return; try{ const prev = chartRegistry.get(canvasId) || (window.Chart && Chart.getChart && Chart.getChart(el)); if(prev && prev.destroy) try{ prev.destroy(); }catch(e){} chartRegistry.delete(canvasId); }catch(e){}
  try{ const chart = new Chart(el, cfg); chartRegistry.set(canvasId, chart); }catch(e){ console.error('chart create failed', e); }
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
      if(prev !== lastOri){
        // load orientation-specific layout when orientation changes
        loadLayout();
      }
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
      // render into any canvases inside modules (including cloned ones) and populate KPI clones
      try{
        document.querySelectorAll('.module').forEach(mod=>{
          const canvases = mod.querySelectorAll('canvas');
          canvases.forEach(c => { try{ renderChartForModuleCanvas(c.id, mod.id, lastLoadData); }catch(e){} });
          // populate KPI clones if applicable
          if(mod.dataset.templateId){ try{ setKpiValuesForModule(mod, mod.dataset.templateId, lastLoadData); }catch(e){} }
        });
      }catch(e){ console.warn('rendering into cloned modules failed', e); }
    }catch(e){ console.error('failed to load transactions',e); }
  }
  loadLast30();

})();
