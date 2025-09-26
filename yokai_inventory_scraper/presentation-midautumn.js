// presentation-midautumn.js
// Lightweight script to remap Chart.js dataset colors to Mid-Autumn warm palette.
// This file is intentionally small and non-invasive: it intercepts Chart construction
// and applies a warm color palette for line, bar, pie, and doughnut charts when
// the page has the .midautumn-theme class on body.
(function(){
  if(typeof Chart === 'undefined') return;
  const themeClass = 'midautumn-theme';
  function isActive(){ return document.body && document.body.classList && document.body.classList.contains(themeClass); }

  // warm palette (repeatable)
  const palette = [
    '#D96A20', // deep pumpkin
    '#F7C04A', // warm gold
    '#FF8A65', // soft coral
    '#B86B3A', // muted sienna
    '#E07A3F', // terracotta
    '#C85A2B', // burnt clay
    '#7C2D12', // deep maroon
    '#FFD7A6', // pale amber
    '#A67B4A', // brown-gold
    '#B2C08A'  // muted olive for accents
  ];

  function pickColor(i){ return palette[i % palette.length]; }

  // which chart canvases should be recolored by this shim (only store sales)
  const targetChartIds = new Set(['mainSalesChart']);

  // helper to assign palette to dataset arrays for pie/doughnut
  function applyToDatasetColors(ds, idx){
    if(!ds) return;
    // if dataset already has backgroundColor (array or string) use it; otherwise apply palette
    if(Array.isArray(ds.backgroundColor)){
      // map to palette if many are default/transparent/empty
      ds.backgroundColor = ds.backgroundColor.map((c, i2)=> (c && c !== 'transparent') ? c : pickColor(idx + i2));
    } else if(!ds.backgroundColor){
      // if data is array, create mapped palette
      if(Array.isArray(ds.data)) ds.backgroundColor = ds.data.map((_,i2)=> pickColor(idx + i2));
      else ds.backgroundColor = pickColor(idx);
    }
    if(!ds.borderColor) ds.borderColor = ds.backgroundColor;
    // apply subtle alpha for fills if not set
    if(!ds.fill && (ds.type === 'line' || ds.type === undefined)) ds.backgroundColor = (Array.isArray(ds.backgroundColor) ? ds.backgroundColor.map(c=> c) : ds.backgroundColor);
  }

  // patch Chart constructor to massage datasets when midautumn theme active
  const OriginalChart = Chart;
  function PatchedChart(ctx, cfg){
    try{
      // detect canvas element id (ctx may be a 2d context or a canvas element)
      let canvasEl = null;
      try{ canvasEl = (ctx && ctx.canvas) ? ctx.canvas : (ctx && ctx.nodeName ? ctx : null); }catch(e){}
      const canvasId = canvasEl && canvasEl.id ? canvasEl.id : null;
      // if this chart is not one of our targets, don't modify datasets
      if(canvasId && !targetChartIds.has(canvasId)){
        return new OriginalChart(ctx, cfg);
      }
      if(isActive() && cfg && cfg.data && Array.isArray(cfg.data.datasets)){
        cfg.data.datasets.forEach((ds, idx)=>{
          try{
            const t = (cfg.type || ds.type || '').toLowerCase();
            if(t === 'doughnut' || t === 'pie'){
              // ensure backgroundColor array
              if(!ds.backgroundColor){
                ds.backgroundColor = (ds.data || []).map((_,i)=> pickColor(i));
              } else if(typeof ds.backgroundColor === 'string'){
                // leave as-is
              } else if(Array.isArray(ds.backgroundColor)){
                // fill empty entries
                ds.backgroundColor = ds.backgroundColor.map((c,i)=> c && c !== 'transparent' ? c : pickColor(i));
              }
              // ensure border colors are gentle
              if(!ds.borderColor) ds.borderColor = (Array.isArray(ds.backgroundColor) ? ds.backgroundColor.map(c=> '#fff') : '#fff');
            } else if(t === 'bar' || t === 'line'){
              // for line/bar force a single accent color per dataset with subtle fill
              const accent = pickColor(idx);
              // always override border/background so existing explicit colors are replaced for the theme
              try{ ds.borderColor = accent; }catch(e){}
              try{ ds.backgroundColor = (cfg.type === 'bar') ? accent : hexToRgba(accent, 0.08); }catch(e){}
              // if an array was present, normalize to accent-filled array for consistent look
              if(Array.isArray(ds.backgroundColor)){
                ds.backgroundColor = ds.backgroundColor.map((c,i)=> hexToRgba(accent, cfg.type === 'bar' ? 1 : 0.08));
              }
              // for line charts, set tension and point styles only if not present
              if(t === 'line'){
                if(ds.tension === undefined) ds.tension = 0.35;
                if(ds.pointRadius === undefined) ds.pointRadius = 2;
                if(ds.pointHoverRadius === undefined) ds.pointHoverRadius = 4;
              }
            }
          }catch(e){/* ignore per-dataset errors */}
        });
      }
    }catch(e){ console.warn('midautumn theme: failed to apply chart color mapping', e); }
    return new OriginalChart(ctx, cfg);
  }
  // rudimentary hex->rgba helper
  function hexToRgba(hex, a){
    try{
      const h = hex.replace('#','');
      const bigint = parseInt(h.length === 3 ? h.split('').map(c=> c + c).join('') : h, 16);
      const r = (bigint >> 16) & 255; const g = (bigint >> 8) & 255; const b = bigint & 255;
      return 'rgba(' + [r,g,b].join(',') + ',' + a + ')';
    }catch(e){ return hex; }
  }

  // copy static properties
  Object.keys(OriginalChart).forEach(k=>{ PatchedChart[k] = OriginalChart[k]; });
  // replace global Chart with patched constructor
  window.Chart = PatchedChart;

  // Also ensure existing charts on the page get remapped when theme toggles
  function remapExistingCharts(){
    if(!isActive()) return;
    try{
      // Try Chart.getChart (Chart.js v3+) to locate existing charts and update their datasets
      if(window.Chart && typeof window.Chart.getChart === 'function'){
        document.querySelectorAll('canvas').forEach(c => {
          if(c.id && !targetChartIds.has(c.id)) return; // skip non-target charts
          try{
            const ch = Chart.getChart(c);
            if(!ch || !ch.data || !Array.isArray(ch.data.datasets)) return;
            ch.data.datasets.forEach((ds, idx)=>{
              try{
                const t = (ch.config && ch.config.type) || (ds.type || '');
                const lower = String(t).toLowerCase();
                if(lower === 'doughnut' || lower === 'pie'){
                  if(!ds.backgroundColor || !Array.isArray(ds.backgroundColor)) ds.backgroundColor = (ds.data||[]).map((_,i)=> pickColor(i));
                  else ds.backgroundColor = ds.backgroundColor.map((c2,i)=> c2 && c2 !== 'transparent' ? c2 : pickColor(i));
                  if(!ds.borderColor) ds.borderColor = '#fff';
                } else if(lower === 'bar' || lower === 'line'){
                  const accent = pickColor(idx);
                  ds.borderColor = accent;
                  ds.backgroundColor = (lower === 'bar') ? accent : hexToRgba(accent, 0.08);
                }
              }catch(e){}
            });
            try{ ch.update(); }catch(e){}
          }catch(e){}
        });
      }
    }catch(e){}
  }

  // watch for theme toggling to remap future charts
  const obs = new MutationObserver((ms)=>{ if(ms.some(m=> m.attributeName === 'class')) remapExistingCharts(); });
  if(document.body) obs.observe(document.body, { attributes:true, attributeFilter:['class'] });
})();
