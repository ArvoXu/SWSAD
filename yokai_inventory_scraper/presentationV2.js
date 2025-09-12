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
  // computed pixel size for a single grid cell (square) and gutter between cells
  let cellSize = 100;
  let gutter = 12; // will be read from CSS if available
  // threshold (px) under which we consider cells "small" and apply compact row rules
  // 調整此值以改變何時啟用小螢幕（compact）排列。
  // 預設 110px。若想手動微調，請修改此常數為你想要的閾值（例如 90 或 120）。
  const SMALL_CELL_PX_THRESHOLD = 110;
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

    // clear any CSS min/max constraints so our explicit sizing can take effect
    dashboardInner.style.minHeight = '0px';
    dashboardInner.style.maxHeight = 'none';
    dashboardInner.style.overflow = 'hidden';

    // read gutter from CSS if present
    try{ const rootStyle = getComputedStyle(document.documentElement); const cssGutter = parseInt(rootStyle.getPropertyValue('--gutter')); if(!isNaN(cssGutter)) gutter = cssGutter; }catch(e){}

    // compute available area for the grid
    const gridTop = gridAreaInner.getBoundingClientRect().top;
    const availW = Math.max(40, gridAreaInner.parentElement.clientWidth || window.innerWidth);
    const availH = Math.max(40, window.innerHeight - padBottom - gridTop - 8);

    const minCell = 24; // safety minimum cell pixel size
    // account for gutter spaces between cells
    const maxCellW = Math.floor((availW - Math.max(0, (cols-1) * gutter)) / cols);
    const maxCellH = Math.floor((availH - Math.max(0, (rows-1) * gutter)) / rows);
    cellSize = Math.max(minCell, Math.floor(Math.min(maxCellW, maxCellH)));

    // compute full pixel grid size (including gutters) and center it
    const gridPxW = cellSize * cols + Math.max(0, (cols-1) * gutter);
    const gridPxH = cellSize * rows + Math.max(0, (rows-1) * gutter);
    gridAreaInner.style.paddingBottom = '0px';
    gridAreaInner.style.width = gridPxW + 'px';
    gridAreaInner.style.height = gridPxH + 'px';
    // center the grid-area within its parent
    gridAreaInner.style.marginLeft = 'auto';
    gridAreaInner.style.marginRight = 'auto';

    // Make dashboardInner wrap tightly around the grid result and center the whole dashboard
    try{
      const dbStyle = getComputedStyle(dashboardInner);
      const padL = parseInt(dbStyle.paddingLeft) || 0;
      const padR = parseInt(dbStyle.paddingRight) || 0;
      const totalDesiredWidth = gridPxW + padL + padR;
      // allow responsive fallback if viewport is narrower
      const maxAvail = (pageWrap && pageWrap.clientWidth) ? pageWrap.clientWidth : window.innerWidth;
      if(totalDesiredWidth > maxAvail){
        dashboardInner.style.width = '100%';
        dashboardInner.style.maxWidth = '100%';
      } else {
        dashboardInner.style.width = totalDesiredWidth + 'px';
        dashboardInner.style.maxWidth = '';
      }
      dashboardInner.style.marginLeft = 'auto';
      dashboardInner.style.marginRight = 'auto';
      // ensure grid area is centered inside the dashboardInner
      gridAreaInner.style.margin = '0 auto';
    }catch(e){ }

    // expose CSS vars for use in CSS rules and modules
    document.documentElement.style.setProperty('--cell-size-px', String(cellSize) + 'px');
    document.documentElement.style.setProperty('--grid-px-w', String(gridPxW) + 'px');
    document.documentElement.style.setProperty('--grid-px-h', String(gridPxH) + 'px');

    // If the document still overflows vertically, try to shrink cells a bit until it fits
    const maxAttempts = 8; let attempts = 0;
    while(attempts < maxAttempts && (document.documentElement.scrollHeight > window.innerHeight || document.body.scrollHeight > window.innerHeight)){
      if(cellSize <= minCell) break;
      cellSize = Math.max(minCell, cellSize - 4);
      const gw = cellSize * cols + Math.max(0, (cols-1) * gutter);
      const gh = cellSize * rows + Math.max(0, (rows-1) * gutter);
      gridAreaInner.style.width = gw + 'px'; gridAreaInner.style.height = gh + 'px';
      document.documentElement.style.setProperty('--cell-size-px', String(cellSize) + 'px');
      document.documentElement.style.setProperty('--grid-px-w', String(gw) + 'px');
      document.documentElement.style.setProperty('--grid-px-h', String(gh) + 'px');
      attempts++;
    }

    // finally place modules according to new cellSize
    document.querySelectorAll('.module').forEach(m=>placeModule(m));
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
  // promise guard to avoid concurrent / repeated loads
  let salesLoadPromise = null;
  // cache of stores known to have no sales in last 30 days to avoid retry storm
  const noSalesStores = new Set();
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
              try{
                initChartsForModule(el);
                if(lastLoadData) {
                  el.querySelectorAll('canvas').forEach(c=>{ try{ renderChartForModuleCanvas(c.id, el.id, lastLoadData); }catch(e){} });
                  // populate KPI values for recreated KPI modules
                  try{ setKpiValuesForModule(el, tplId, lastLoadData); }catch(e){}
                }
              // initialize machine carousel if template contains it
              try{ if(el.querySelector && el.querySelector('.machine-carousel')) initMachineCarouselForModule(el); }catch(e){}
              }catch(e){ console.warn('[presentationV2] initChartsForModule error', e); }
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
        if(el){
          el.dataset.x = nx; el.dataset.y = ny; el.dataset.w = nw; el.dataset.h = nh;
          // if we already have data cached, ensure KPI modules are populated
          if(lastLoadData && el.dataset.templateId){ try{ setKpiValuesForModule(el, el.dataset.templateId, lastLoadData); }catch(e){} }
        }
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
  // compute with square cells and gutter spacing
  const cellOuterW = cellSize + gutter; const cellOuterH = cellSize + gutter;
  const leftPx = x * cellOuterW;
  const topPx = y * cellOuterH;
  const widthPx = Math.max(40, (w * cellSize) + Math.max(0, (w-1) * gutter) - 12);
  const heightPx = Math.max(40, (h * cellSize) + Math.max(0, (h-1) * gutter) - 12);
  el.style.left = leftPx + 'px';
  el.style.top = topPx + 'px';
  el.style.width = widthPx + 'px';
  el.style.height = heightPx + 'px';
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
        // keep modules that are explicit templates (have data-template attribute)
        try{ if(m.hasAttribute && m.hasAttribute('data-template')){ return; } }catch(e){}
        try{ stopExistingCarousel(m.id); }catch(e){}
        try{ m.remove(); }catch(e){}
      });
      // rebuild in-memory templates from remaining DOM modules (so toolbox templates persist)
      moduleTemplates.clear();
      document.querySelectorAll('.module').forEach(m=>{ try{ if(m.id) moduleTemplates.set(m.id, m.cloneNode(true)); }catch(e){} });
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
  try{ 
    loadLayout();
    document.querySelectorAll('.module').forEach(m=>placeModule(m));
    // After layout and placeModule run, ensure any machine carousel modules are properly initialized.
    // Use requestAnimationFrame so DOM layout and CSS sizing have settled (fixes issue where carousels
    // required a drag/resize to render after reload).
    // load real inventory first, then init carousels after layout stabilizes
    loadInventorySummary().finally(()=>{
      requestAnimationFrame(()=>{
        document.querySelectorAll('.module').forEach(m=>{
          try{ if(m.querySelector && m.querySelector('.machine-carousel')) initMachineCarouselForModule(m); }catch(e){}
        });
      });
    });
  }catch(e){ }

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
  // ensure carousel init for clone if it contains the carousel markup
  try{ if(clone.querySelector && clone.querySelector('.machine-carousel')){ initMachineCarouselForModule(clone); } }catch(e){}
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
  if(!dragState) return; const el = dragState.el;
  // use gridAreaInner as reference for overlay coordinates
  const gridRect = gridAreaInner.getBoundingClientRect();
  const cellOuterW = cellSize + gutter; const cellOuterH = cellSize + gutter;

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
        // relative to grid area
        const absLeft = curLeftPx - gridRect.left;
        const absTop = curTopPx - gridRect.top;
        el.style.left = absLeft + 'px';
        el.style.top = absTop + 'px';
      }

      // compute snapped grid cell for preview (always relative to grid area)
      const absLeftForSnap = (e.clientX - dragState.pointerOffsetX) - gridRect.left;
      const absTopForSnap = (e.clientY - dragState.pointerOffsetY) - gridRect.top;
      let snapX = Math.round(absLeftForSnap / cellOuterW);
      let snapY = Math.round(absTopForSnap / cellOuterH);
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

  // compute snap preview for resize using cellOuter sizes
  const relLeft = rectEl.left - gridRect.left; const relTop = rectEl.top - gridRect.top;
  let snapW = Math.round(newPxW / cellOuterW);
  let snapH = Math.round(newPxH / cellOuterH);
  if(snapW < 1) snapW = 1; if(snapH < 1) snapH = 1;
  const snapX = Math.max(0, Math.min(cols-1, Math.round(relLeft / cellOuterW)));
  const snapY = Math.max(0, Math.min(rows-1, Math.round(relTop / cellOuterH)));
  if(snapX + snapW > cols) snapW = cols - snapX; if(snapY + snapH > rows) snapH = rows - snapY;

      document.querySelectorAll('.grid-overlay .cell').forEach(c=>c.classList.remove('visible'));
      for(let rr=snapY; rr<snapY+snapH; rr++) for(let cc=snapX; cc<snapX+snapW; cc++){ const idx = rr*cols + cc; const cell = overlay.children[idx]; if(cell) cell.classList.add('visible'); }
    // show trash bin while resizing too
    trashBin.classList.add('visible');
    }
  });

  document.addEventListener('pointerup', e=>{
    if(!dragState) return;
  const el = dragState.el; const gridRect = gridAreaInner.getBoundingClientRect();
  const cellOuterW = cellSize + gutter; const cellOuterH = cellSize + gutter;

    if(dragState.type === 'move'){
      // determine final snapped grid coordinates from current pixel left/top (relative to overlay)
      // current pixel left when detached: el.style.left (viewport px); when attached: computed left is overlay-relative
  const curLeftViewport = parseFloat(el.style.left) || 0;
  const curTopViewport = parseFloat(el.style.top) || 0;
  // convert to grid-area-relative
  const curLeft = (dragState.detached ? (curLeftViewport - gridRect.left) : curLeftViewport);
  const curTop = (dragState.detached ? (curTopViewport - gridRect.top) : curTopViewport);
  let finalX = Math.round(curLeft / cellOuterW); let finalY = Math.round(curTop / cellOuterH);
      const curW = parseInt(el.dataset.w||1,10); const curH = parseInt(el.dataset.h||1,10);
      if(finalX < 0) finalX = 0; if(finalY < 0) finalY = 0;
      if(finalX + curW > cols) finalX = cols - curW; if(finalY + curH > rows) finalY = rows - curH;

      // animate to snapped position and reattach to grid-area-inner
  const finalLeftPx = finalX * cellOuterW;
  const finalTopPx = finalY * cellOuterH;

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
  // cleanup carousel timers
  try{ stopExistingCarousel(el.id); }catch(e){}
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
  // re-init carousel for this module (update per-view after move/attach)
  try{ initMachineCarouselForModule(el); }catch(e){}
    } else if(dragState.type === 'resize'){
      // compute final width/height in grid cells and animate
      const styleW = parseFloat(getComputedStyle(el).width) || dragState.startPxW;
      const styleH = parseFloat(getComputedStyle(el).height) || dragState.startPxH;
      const relLeft = dragState.startRect.left - gridRect.left;
      const relTop = dragState.startRect.top - gridRect.top;
      let finalW = Math.round(styleW / cellOuterW); let finalH = Math.round(styleH / cellOuterH);
      if(finalW < 1) finalW = 1; if(finalH < 1) finalH = 1;
      let finalX = Math.round(relLeft / cellOuterW); let finalY = Math.round(relTop / cellOuterH);
      if(finalX < 0) finalX = 0; if(finalY < 0) finalY = 0;
      if(finalX + finalW > cols) finalW = cols - finalX; if(finalY + finalH > rows) finalH = rows - finalY;

      el.classList.add('snapping');
      void el.offsetWidth;
      el.dataset.w = finalW; el.dataset.h = finalH; el.dataset.x = finalX; el.dataset.y = finalY; placeModule(el);
      const onEndResize = (ev)=>{ if(['width','height','left','top'].includes(ev.propertyName)){ el.classList.remove('snapping'); el.removeEventListener('transitionend', onEndResize); } };
      el.addEventListener('transitionend', onEndResize);
  // save layout after resize
  try{ saveLayout(); }catch(e){}
  // re-init carousel for this module (update per-view after resize)
  try{ initMachineCarouselForModule(el); }catch(e){}
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
  // initialize machine carousel if present
  try{ if(moduleEl.querySelector('.machine-carousel')){ initMachineCarouselForModule(moduleEl); } }catch(e){}
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

  // ---- machine carousel implementation ----
  // in-memory simulated machine list (20 machines) - compact shape without machine_id
  const _simMachines = Array.from({length:20}, (_,i)=>({
    name: '機台-' + String(i+1).padStart(2,'0'),
    stock: Math.floor(Math.random()*100),
    capacity: 100
  }));

  // cached inventory summary loaded from server (preferred over simulation)
  // array of {store,total_qty,capacity,barRatio} (no machine_id)
  let lastInventoryData = null;

  async function loadInventorySummary(){
    try{
      // Use legacy v1 endpoint (/get-data) and perform aggregation on the frontend.
      // This keeps the API unchanged and lets the UI compute per-store totals.
      const res = await fetch('/get-data');
      if(!res.ok) return null;
      const j = await res.json();
      if(!j || !j.success || !Array.isArray(j.data)) return null;

      const rows = j.data;
      // Build a storeNotesAndAddresses map (keyed by `${store}-${machineId}`) so V2 can display address/note like V1
      try{
        const notes = {};
        let latestProcessTime = 0;
        rows.forEach(item => {
          const storeKey = `${item.store}-${item.machineId}`;
          if (!notes[storeKey]) {
            notes[storeKey] = {
              address: item.address || '',
              note: item.note || '',
              sales: item.manualSales || 0
            };
          }
          const processTimeValue = item.processTime ? new Date(item.processTime).getTime() : 0;
          if (processTimeValue > latestProcessTime) latestProcessTime = processTimeValue;
        });
        window.storeNotesAndAddresses = notes;
        if(latestProcessTime > 0) window.updateTime = new Date(latestProcessTime).toLocaleString('zh-TW');
        console.log('[presentationV2] populated window.storeNotesAndAddresses from /get-data');
      }catch(e){ console.warn('[presentationV2] failed to build storeNotesAndAddresses', e); }
  // group by a canonical machine key to avoid double-counting.
      // Prefer explicit machine id (machineId or machine_id) when available; otherwise use the raw store string.
      const groups = new Map();
      const seenRowIds = new Set();
      const DEFAULT_CAPACITY = 50; // frontend default if server doesn't expose capacity
      // normalization helper: trim, collapse spaces, replace fullwidth spaces and lowercase for stable keys
      const norm = s => String(s || '').replace(/\u3000/g, ' ').trim().replace(/\s+/g, ' ').toLowerCase();
  rows.forEach(r => {
        const rawStore = r.store || r.storeName || r.storeKey || 'unknown';
        const machineIdRaw = (r.machineId || r.machine_id || '') || '';
        const machineId = String(machineIdRaw).trim();
        const qty = Number(r.quantity || r.qty || 0) || 0;

        // build canonical key using normalized store + normalized machine id (if present)
        const storeNorm = norm(rawStore);
        const machineNorm = machineId ? norm(machineId) : '';
        const machineKey = machineNorm ? `${storeNorm}::${machineNorm}` : storeNorm;

  if(!groups.has(machineKey)) groups.set(machineKey, { rawStore: rawStore, machineId: machineId, total_qty: 0, capacity: (Number(r.capacity) || DEFAULT_CAPACITY), products: new Map(), lastUpdated: '', lastUpdatedTs: 0 });
  const g = groups.get(machineKey);
  g.total_qty += qty;
  if(r.capacity && Number(r.capacity) > 0) g.capacity = Math.max(g.capacity || DEFAULT_CAPACITY, Number(r.capacity));
  // capture last_updated / lastUpdated from inventory rows (choose latest)
  try{
    const cand = r.lastUpdated || r.last_updated || r.last_updated_at || r.last_updated_time || r.processTime || '';
    if(cand){
      const candStr = String(cand).split(' (')[0];
      const dt = new Date(candStr);
      if(!isNaN(dt.getTime())){
        const ts = dt.getTime();
        if(ts > (g.lastUpdatedTs || 0)){
          g.lastUpdatedTs = ts;
          g.lastUpdated = String(cand);
        }
      }
    }
  }catch(e){}
  // accumulate per-product quantities (support several field names)
  const prodName = (r.productName || r.product_name || r.product || '').toString() || '';
  if(prodName){ const prev = g.products.get(prodName) || 0; g.products.set(prodName, prev + qty); }
      });

      // produce array in the shape the carousel expects: {store, total_qty, capacity, percent100, barRatio}
      // produce array: keep raw totals (do NOT clamp to capacity). Display name will be cleaned later.
      const out = Array.from(groups.values()).map(g => {
        const cap = (g.capacity && g.capacity > 0) ? g.capacity : DEFAULT_CAPACITY;
        const total = Math.max(0, Math.round(g.total_qty));
        const ratio = cap > 0 ? (total / cap) : 0; // may exceed 1
        // convert products map to array
        const products = Array.from(g.products.entries()).map(([name, qty])=>({ name, qty }));
        // format short lastUpdated as MM/DD HH:MM using the stored lastUpdated timestamp
        const formatShort = (raw)=>{
          if(!raw) return '';
          const s = String(raw).split(' (')[0];
          const d = new Date(s);
          if(isNaN(d.getTime())) return '';
          const mm = d.getMonth() + 1;
          const dd = d.getDate();
          const hh = String(d.getHours()).padStart(2,'0');
          const min = String(d.getMinutes()).padStart(2,'0');
          return `${mm}/${dd} ${hh}:${min}`;
        };
        const lastUpdatedShort = formatShort(g.lastUpdated);
        return { store: g.rawStore, machineId: g.machineId, total_qty: total, capacity: cap, percent100: Math.round(ratio * 100), barRatio: ratio, products, lastUpdated: lastUpdatedShort };
      });

      lastInventoryData = out;
      return lastInventoryData;
    }catch(e){ console.warn('[presentationV2] loadInventorySummary failed', e); }
    return null;
  }

  // map of running carousel timers by module id for cleanup
  const carouselRegistry = new Map();

  function computeCardsPerView(w,h){
    // number of cards to display equals w * h
    const n = Math.max(1, (parseInt(w,10)||1) * (parseInt(h,10)||1));
    return n;
  }

  function renderMachineCards(container, machines, cols, rows){
    // build grid with cols x rows layout; center content
    container.innerHTML = '';
  container.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
  container.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
  // ensure grid items fill cells uniformly
  container.style.alignItems = 'stretch';
  container.style.justifyItems = 'stretch';
    machines.forEach(m=>{
      const card = document.createElement('div'); card.className = 'machine-card';
  const t = document.createElement('div'); t.className='title'; t.textContent = m.name; t.title = m.name || '';
      const meta = document.createElement('div'); meta.className='meta'; meta.textContent = (m.stock || 0) + '/' + (m.capacity || 50);
      const barWrap = document.createElement('div'); barWrap.className = 'bar';
      const cap = (m.capacity && m.capacity > 0) ? m.capacity : 50;
      const pct = Math.max(0, Math.min(100, Math.round(((m.stock||0) / cap) * 100)));
      const bar = document.createElement('i'); bar.style.width = Math.max(2, pct) + '%'; barWrap.appendChild(bar);
      card.appendChild(t); card.appendChild(meta); card.appendChild(barWrap);
      container.appendChild(card);
    });
  }

  function initMachineCarouselForModule(mod){
    const grid = mod.querySelector('.carousel-grid'); if(!grid) return;
    // add module header button (if module has a header region)
    try{
      const header = mod.querySelector('.module-header') || mod.querySelector('.module-title') || mod;
      if(header && !header.querySelector('.carousel-open-btn')){
        const btn = document.createElement('button');
        btn.className = 'carousel-open-btn'; btn.type = 'button'; btn.title = '檢視機台清單'; btn.innerText = '⋯';
        // Prevent the global module drag start from capturing this interaction.
        // Stop propagation on pointer/mouse/touch down so the document-level pointerdown
        // handler doesn't begin a drag operation when user intends to click the button.
        ['pointerdown','mousedown','touchstart'].forEach(ev => {
          btn.addEventListener(ev, function(e){
            try{ e.stopPropagation(); }catch(err){}
            try{ if(e.pointerId && btn.setPointerCapture) btn.setPointerCapture(e.pointerId); }catch(err){}
          });
        });
        btn.addEventListener('click', (e)=>{ e.stopPropagation(); openMachineListModal(); });
        header.appendChild(btn);
      }
    }catch(e){ /* ignore header injection failures */ }
    // determine number of cards from module w/h
    const w = parseInt(mod.dataset.w||1,10); const h = parseInt(mod.dataset.h||1,10);
    // base cols/rows from module dataset
    let cols = Math.max(1, w); let rows = Math.max(1, h);
    // compute effective per-cell pixel size using module height if available
    try{
      const rect = mod.getBoundingClientRect();
      const modHeight = rect.height || mod.offsetHeight || 0;
      // account for padding/gutter approximations used in placeModule where heightPx = h*cellSize + (h-1)*gutter - 12
      const approxGutter = (typeof gutter === 'number') ? gutter : 12;
      const effectiveCellPx = Math.max(0, Math.floor((modHeight + 12 - Math.max(0, (h-1) * approxGutter)) / Math.max(1, h)));
  // if effective cell size is small, apply custom compact row mapping.
  // New mapping when effectiveCellPx < SMALL_CELL_PX_THRESHOLD:
  //   h == 2 -> rows = 1
  //   h == 3 -> rows = 2
  //   h == 4 or h == 5 -> rows = 3
  //   h == 6 -> rows = 5
  // This preserves vertical density for small cell heights while keeping content readable.
  // To manually tweak: change SMALL_CELL_PX_THRESHOLD above or edit this switch mapping.
  if(effectiveCellPx > 0 && effectiveCellPx < SMALL_CELL_PX_THRESHOLD){
    switch(h){
      case 2: rows = 1; break;
      case 3: rows = 2; break;
      case 4:
      case 5: rows = 3; break;
      case 6: rows = 5; break;
      default: rows = Math.max(1, Math.floor(h/2));
    }
  }
    }catch(e){}
    const perView = computeCardsPerView(cols, rows);
    // create window into sim machines, starting at 0
    let idx = 0;
    function tick(){
      // choose source: prefer real data if available, otherwise fallback to simulated
      const source = (Array.isArray(lastInventoryData) && lastInventoryData.length) ? lastInventoryData : _simMachines;
      const srcLen = source.length;
      const out = [];
      if(srcLen === 0){
        renderMachineCards(grid, out, cols, rows);
        return;
      }

      // If source has fewer items than perView, show each unique item once (no repeats)
      if(srcLen <= perView){
        for(let i=0;i<srcLen;i++){
          const item = source[i];
          if(!item) continue;
          const nameRaw = (item.store !== undefined) ? item.store : (item.name || '');
          const name = String(nameRaw).replace(/-[A-Za-z0-9_]{1,8}$/, '');
          const stock = (item.total_qty !== undefined) ? (item.total_qty || 0) : (item.stock || 0);
          const capacity = (item.capacity !== undefined) ? item.capacity : (item.capacity || 50);
          out.push({ name, stock, capacity });
        }
        // if fewer than perView, pad with empty placeholders so grid keeps layout
        while(out.length < perView) out.push({ name: '', stock: 0, capacity: 50 });
        renderMachineCards(grid, out, cols, rows);
        // advance index so next tick will not change content if source unchanged
        idx = (idx + srcLen) % Math.max(1, srcLen);
        return;
      }

      // Normal paging: show a page-worth of items without duplication across a page
      for(let i=0;i<perView;i++){
        const item = source[(idx + i) % srcLen];
        if(!item) continue;
        const nameRaw = (item.store !== undefined) ? item.store : (item.name || '');
        const name = String(nameRaw).replace(/-[A-Za-z0-9_]{1,8}$/, '');
        const stock = (item.total_qty !== undefined) ? (item.total_qty || 0) : (item.stock || 0);
        const capacity = (item.capacity !== undefined) ? item.capacity : (item.capacity || 50);
        out.push({ name, stock, capacity });
      }
      renderMachineCards(grid, out, cols, rows);
      // advance by full page (perView) so pages are non-overlapping
      idx = (idx + perView) % srcLen;
    }

    // modal helpers (scoped per-module)
    function colorForString(s){
      let h = 0; if(!s) s = String(Math.random()); for(let i=0;i<s.length;i++){ h = (h*31 + s.charCodeAt(i)) % 360; } return `hsl(${h},60%,65%)`;
    }

    function openMachineListModal(){
      const data = (Array.isArray(lastInventoryData) && lastInventoryData.length) ? lastInventoryData : [];
      let modal = document.querySelector('.machine-list-modal');
      if(!modal){
        modal = document.createElement('div'); modal.className = 'machine-list-modal';
        modal.innerHTML = '\n          <div class="mlm-overlay"></div>\n          <div class="mlm-dialog">\n            <div class="mlm-header">機台清單 <button class="mlm-close" title="關閉">✕</button></div>\n            <div class="mlm-body"><div class="mlm-list"></div></div>\n          </div>';
        document.body.appendChild(modal);
        modal.querySelector('.mlm-close').addEventListener('click', ()=>closeMachineListModal());
        modal.querySelector('.mlm-overlay').addEventListener('click', ()=>closeMachineListModal());
      }
      renderMachineList(modal, data);
      modal.classList.add('open');
    }

    function closeMachineListModal(){ const modal = document.querySelector('.machine-list-modal'); if(modal) modal.classList.remove('open'); }

    function renderMachineList(modal, rows){
  const list = modal.querySelector('.mlm-list'); if(!list) return; list.innerHTML = '';
  // add a sticky header row: left = 機台名稱, right = 過去30天銷售
  const header = document.createElement('div'); header.className = 'mlm-row mlm-header-row';
  const htop = document.createElement('div'); htop.className = 'mlm-top';
  const hleft = document.createElement('div'); hleft.className = 'mlm-left';
  const htitle = document.createElement('div'); htitle.className = 'mlm-title'; htitle.innerText = '機台名稱';
  hleft.appendChild(htitle);
  htop.appendChild(hleft);
  const hright = document.createElement('div'); hright.className = 'mlm-top-right'; hright.innerText = '過去30天銷售';
  htop.appendChild(hright);
  header.appendChild(htop);
  list.appendChild(header);
      const sorted = rows.slice().sort((a,b)=> (a.store||'').localeCompare(b.store||'') || (a.machineId||'').localeCompare(b.machineId||''));
      sorted.forEach(r => {
        const item = document.createElement('div'); item.className = 'mlm-row';
        // top row: title + small id
        const top = document.createElement('div'); top.className = 'mlm-top';
        const left = document.createElement('div'); left.className = 'mlm-left';
        const title = document.createElement('div'); title.className = 'mlm-title'; title.innerText = r.store || '無名稱';
        const sub = document.createElement('div'); sub.className = 'mlm-sub'; sub.innerText = r.machineId || '';
        left.appendChild(title); left.appendChild(sub);
        top.appendChild(left);
        // right: show last 30 days sales amount / count similar to V1
        try{
          const salesAgg = window.last30DaysSalesData || {};
          const salesMap = window.salesData || {};
          const msAgg = salesAgg[r.store] || null;
          const machineSalesTotal = msAgg ? (msAgg.totalSales || 0) : 0;
          let machineSalesCount = 0;
          if(salesMap[r.store]){
            machineSalesCount = Object.values(salesMap[r.store]).reduce((s,v)=>s + (v && v.count? v.count : 0), 0);
          }
          const right = document.createElement('div'); right.className = 'mlm-top-right';
          if(machineSalesTotal > 0 || machineSalesCount > 0){ right.innerText = `${machineSalesTotal.toLocaleString()} 元 / ${machineSalesCount} 份`; }
          else { right.innerText = '無'; }
          top.appendChild(right);
        }catch(e){ /* ignore if globals not present */ }

        // bottom row: stats (xx / capacity) + stacked bar
  const bottom = document.createElement('div'); bottom.className = 'mlm-stats';
  const cap = (r.capacity && Number(r.capacity) > 0) ? Number(r.capacity) : DEFAULT_CAPACITY;
  const total = r.products && r.products.length ? r.products.reduce((s,p)=>s+(Number(p.qty||p.quantity||0)),0) : (Number(r.total_qty||0) || 0);

  const barWrap = document.createElement('div'); barWrap.className = 'mlm-right';
  const bar = document.createElement('div'); bar.className = 'mlm-bar';
        // render product segments
        let filled = 0;
        if(r.products && r.products.length){
          r.products.forEach(p => {
            const qty = Number(p.qty||0);
            const pct = cap > 0 ? Math.max(0, (qty/cap)*100) : 0; // proportion of capacity
            filled += qty;
            const seg = document.createElement('div'); seg.className = 'mlm-seg'; seg.style.width = pct + '%'; seg.style.background = colorForString(p.name || String(Math.random())); seg.title = `${p.name}：${qty}`;
            bar.appendChild(seg);
          });
        } else {
          // if no product breakdown, show single filled segment for total
          const pct = cap > 0 ? Math.min(100, (total/cap)*100) : 0;
          const seg = document.createElement('div'); seg.className = 'mlm-seg'; seg.style.width = pct + '%'; seg.style.background = '#36A2EB'; seg.title = `庫存：${total}`;
          bar.appendChild(seg);
          filled = total;
        }
        // append gray remainder for empty space up to capacity
        const rem = Math.max(0, cap - filled);
        if(cap > 0){ const remPct = Math.max(0, Math.min(100, (rem / cap) * 100)); if(remPct > 0){ const segg = document.createElement('div'); segg.className = 'mlm-seg mlm-empty'; segg.style.width = remPct + '%'; segg.style.background = '#e6e9ee'; segg.title = `可用空位：${rem}`; bar.appendChild(segg); } }

  barWrap.appendChild(bar);
  bottom.appendChild(barWrap);

        // make each row clickable to toggle inline detail view
        item.style.cursor = 'pointer';
        item.addEventListener('click', (e)=>{ e.stopPropagation(); toggleInlineDetail(item, r); });
        item.appendChild(top); item.appendChild(bottom);
        list.appendChild(item);
      });
    }
  // toggle inline detail expansion under the stacked bar
  async function toggleInlineDetail(item, r){
      // if already expanded, remove it
      const existing = item.querySelector('.mlm-inline-detail');
      if(existing){ existing.remove(); return; }
  // build inline detail (adapted from presentation.js renderStoreCards detailHtml)
      const salesData = window.salesData || window.fullSalesData || {};
      const store = r.store || '';
      const machineSalesData = salesData[store] || null;
      const products = (r.products && r.products.length) ? r.products.map(p=>({ name: p.name, quantity: Number(p.qty||p.quantity||0) })) : [];
      const inStockProducts = new Map(products.map(p=>[p.name, p.quantity]));
      const allProductNames = new Set([ ...products.map(p=>p.name).filter(Boolean), ...(machineSalesData ? Object.keys(machineSalesData) : []) ]);
      let processedProducts = [];
      allProductNames.forEach(productName => {
        const salesInfo = machineSalesData ? machineSalesData[productName] : null;
        processedProducts.push({ name: productName, quantity: inStockProducts.get(productName) || 0, sales: salesInfo ? salesInfo.count : 0, lastSoldDate: salesInfo ? salesInfo.lastSoldDate : '' });
      });
      if(machineSalesData) processedProducts.sort((a,b)=> b.sales - a.sales);

  const wrapper = document.createElement('div'); wrapper.className = 'mlm-inline-detail';
      // top: re-show refill/lastUpdated if available; include address/note like V1; do not trigger loading here
  const infoRow = document.createElement('div'); infoRow.className = 'mlm-inline-info';
  let infoText = r.lastUpdated ? `補貨: ${r.lastUpdated}` : '';
  if(!machineSalesData){
    // Do not trigger network loads on click. If no sales data is present, show the friendly message.
    infoText += (infoText? ' · ' : '') + '過去30天沒有訂單紀錄';
    // remember this store has no recent sales to avoid future unnecessary checks
    try{ noSalesStores.add(store); }catch(e){}
  }
  infoRow.innerText = infoText;
  wrapper.appendChild(infoRow);

  // show address and note if present (mimic V1: window.storeNotesAndAddresses)
  try{
    const storeNotes = window.storeNotesAndAddresses || {};
    // V1 stores notes under the key `${store}-${machineId}`. Try that first,
    // then fall back to store-only key for compatibility.
    const storeKey = (r.machineId) ? `${store}-${r.machineId}` : store;
    const noteDataRaw = storeNotes[storeKey] || storeNotes[store] || { address: '', note: '' };
    const maskedNoteData = window.__maskFields ? { address: window.__maskFields.getOrCreate ? window.__maskFields.getOrCreate('address', noteDataRaw.address) : noteDataRaw.address, note: window.__maskFields.getOrCreate ? window.__maskFields.getOrCreate('note', noteDataRaw.note) : noteDataRaw.note } : noteDataRaw;
    if(maskedNoteData.address){ const addr = document.createElement('div'); addr.className = 'mlm-detail-address'; addr.innerText = `地址: ${maskedNoteData.address}`; wrapper.appendChild(addr); }
    if(maskedNoteData.note){ const noteEl = document.createElement('div'); noteEl.className = 'mlm-detail-note'; noteEl.innerText = `備註: ${maskedNoteData.note}`; wrapper.appendChild(noteEl); }
  }catch(e){ /* ignore */ }

      // render medals (前三名) and sold items
      const medals = ['🥇','🥈','🥉'];
      const productsWithSales = processedProducts.filter(p=>p.sales>0);
      const productsWithoutSales = processedProducts.filter(p=>p.sales===0);

      for(let i=0;i<3;i++){
        const product = productsWithSales[i];
        const row = document.createElement('div'); row.className = 'detail-item';
        const left = document.createElement('div'); left.className = 'detail-name';
        const right = document.createElement('div'); right.className = 'detail-qty';
        if(product){
          left.innerText = `${medals[i]} ${product.name}`;
          right.innerText = (product.quantity===0) ? '⚠️' : String(product.quantity);
          let tparts = [`過去一個月銷量為 ${product.sales}`]; if(product.quantity===0) tparts.push(`已在 ${product.lastSoldDate} 完售，請盡早補貨`);
          row.title = tparts.join('，');
        } else {
          left.innerText = `${medals[i]} -`;
          right.innerText = '-';
          row.title = `該機台過去一個月只銷售 ${productsWithSales.length} 樣產品`;
        }
        row.appendChild(left); row.appendChild(right); wrapper.appendChild(row);
      }

      // other sold products
      if(productsWithSales.length>3){
        productsWithSales.slice(3).forEach(product=>{
          const row = document.createElement('div'); row.className = 'detail-item';
            const left = document.createElement('div'); left.className = 'detail-name'; left.innerText = product.name;
            const right = document.createElement('div'); right.className = 'detail-qty'; right.innerText = (product.quantity===0)?'⚠️':String(product.quantity);
            row.title = `過去一個月銷量為 ${product.sales}`;
            row.appendChild(left); row.appendChild(right); wrapper.appendChild(row);
        });
      }

      // products without sales
      productsWithoutSales.forEach(product=>{
        const row = document.createElement('div'); row.className = 'detail-item';
        const left = document.createElement('div'); left.className = 'detail-name'; left.innerText = product.name;
        const right = document.createElement('div'); right.className = 'detail-qty'; right.innerText = String(product.quantity);
        row.title = '該產品於過去一個月未有銷售紀錄';
        row.appendChild(left); row.appendChild(right); wrapper.appendChild(row);
      });

      // total
      const totalRow = document.createElement('div'); totalRow.className = 'detail-total';
      const tl = document.createElement('div'); tl.innerText = '總計';
      const tr = document.createElement('div'); tr.innerText = processedProducts.reduce((s,p)=>s + (Number(p.quantity)||0),0);
      totalRow.appendChild(tl); totalRow.appendChild(tr); wrapper.appendChild(totalRow);

      // insert after bottom (stacked bar)
      const bottom = item.querySelector('.mlm-stats'); if(bottom) bottom.insertAdjacentElement('afterend', wrapper);
    }
  // immediately render and start interval
  // stop any previous carousel for this module first
  stopExistingCarousel(mod.id);
  idx = 0; tick();
  // production rotation interval = 5 seconds (was 2000ms for testing)
  const t = setInterval(tick, 5000);
  // store stop handle and metadata for cleanup
  carouselRegistry.set(mod.id, { timer: t, idxStart: idx, perView });
    // make sure module content stays centered inside module-body
    const viewport = mod.querySelector('.carousel-viewport'); if(viewport) viewport.classList.add('centered');
  }

  function stopExistingCarousel(modId){
    const entry = carouselRegistry.get(modId); if(entry){ try{ clearInterval(entry.timer); }catch(e){} carouselRegistry.delete(modId); }
  }

  // when module is removed or cleared, cleanup carousel timers
  const _orig_clearDefaults = window.presentationV2 && window.presentationV2.clearDefaults ? window.presentationV2.clearDefaults : null;


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
  function loadLast30(){
    // avoid concurrent fetches; reuse in-flight promise
    if(salesLoadPromise) return salesLoadPromise;
    salesLoadPromise = (async ()=>{
      try{
        log('fetching /api/transactions');
        const res = await fetch('/api/transactions'); if(!res.ok){ log('/api/transactions response not ok', res.status); return; }
        const data = await res.json(); log('/api/transactions returned', Array.isArray(data)?data.length:'non-array');
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const end = new Date(today);
        end.setHours(23, 59, 59, 999);
        const start = new Date(end);
        start.setDate(end.getDate() - 29); // 30天區間
        start.setHours(0, 0, 0, 0);
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
          try{ const prev = chartRegistry.get(el.id); if(prev && prev.destroy) prev.destroy(); }catch(e){}
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
        // Additionally, aggregate per-store/per-product sales for the last 30 days
        try{
          if(Array.isArray(data)){
            // attach parsed jsDate to each item for consistency
            data.forEach(d=>{ if(d.date && typeof d.date === 'string'){ const dt=new Date(d.date); d.jsDate = isNaN(dt.getTime())?null:dt; } else d.jsDate = null; });
            const recent = data.filter(d=> d.jsDate && d.jsDate >= start && d.jsDate <= end && parseFloat(d.amount) > 0);
            const aggregatedSales = {};
            recent.forEach(sale => {
              if(!sale.shopName || !sale.product) return;
              const shopName = String(sale.shopName).trim();
              const productName = String(sale.product).trim();
              if(!aggregatedSales[shopName]) aggregatedSales[shopName] = {};
              if(!aggregatedSales[shopName][productName]) aggregatedSales[shopName][productName] = { count:0, lastSoldDate: '1970-01-01' };
              aggregatedSales[shopName][productName].count += 1;
              aggregatedSales[shopName].totalSales = (aggregatedSales[shopName].totalSales||0) + (parseFloat(sale.amount)||0);
              const saleDateStr = sale.jsDate.toISOString().split('T')[0];
              if(saleDateStr > aggregatedSales[shopName][productName].lastSoldDate) aggregatedSales[shopName][productName].lastSoldDate = saleDateStr;
            });
            // expose for compatibility with presentation.js expectations
            window.fullSalesData = data;
            window.last30DaysSalesData = aggregatedSales;
            // also make a convenience mapping used in V2 detail code
            // structure: salesData[store][product] = { count, lastSoldDate }
            const salesDataMap = {};
            Object.keys(aggregatedSales).forEach(store => {
              salesDataMap[store] = {};
              Object.keys(aggregatedSales[store]).forEach(k=>{ if(k !== 'totalSales') salesDataMap[store][k] = { count: aggregatedSales[store][k].count, lastSoldDate: aggregatedSales[store][k].lastSoldDate }; });
            });
            window.salesData = salesDataMap;
            log('presentationV2: salesData aggregated and exposed on window');
          }
        }catch(e){ console.warn('presentationV2: failed to aggregate sales data', e); }
      }catch(e){ console.error('failed to load transactions',e); throw e; }
    })();
    // ensure salesLoadPromise cleared afterwards
    salesLoadPromise = salesLoadPromise.finally(()=>{ salesLoadPromise = null; return null; });
    return salesLoadPromise;
  }
  // initial eager load (kept) but guarded
  loadLast30();

})();
