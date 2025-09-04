// Minimal grid snapping, drag and resize logic + sample charts
(function(){
  const cols = 9, rows = 5;
  const grid = document.getElementById('gridArea');
  const overlay = document.getElementById('gridOverlay');

  // build overlay cells
  for(let r=0;r<rows;r++){
    for(let c=0;c<cols;c++){
      const div = document.createElement('div');
      div.className='cell';
      div.dataset.col=c; div.dataset.row=r;
      overlay.appendChild(div);
    }
  }

  function placeModule(el){
    const x = parseInt(el.dataset.x,10)||0;
    const y = parseInt(el.dataset.y,10)||0;
    const w = parseInt(el.dataset.w,10)||1;
    const h = parseInt(el.dataset.h,10)||1;
    const area = overlay.getBoundingClientRect();
    const cellW = area.width/cols; const cellH = area.height/rows;
    el.style.left = `${x*cellW}px`;
    el.style.top = `${y*cellH}px`;
    el.style.width = `${w*cellW - 12}px`;
    el.style.height = `${h*cellH - 12}px`;
  }

  // init modules
  document.querySelectorAll('.module').forEach(m=>placeModule(m));

  // dragging
  let dragState=null;
  document.addEventListener('pointerdown', e=>{
    const mod = e.target.closest('.module');
    if(!mod) return;
    if(e.target.classList.contains('resize-handle')){
      dragState={type:'resize', el:mod, startX:e.clientX, startY:e.clientY, startW:parseInt(mod.dataset.w,10), startH:parseInt(mod.dataset.h,10)};
    } else {
      dragState={type:'move', el:mod, startX:e.clientX, startY:e.clientY, origX:parseInt(mod.dataset.x,10), origY:parseInt(mod.dataset.y,10)};
    }
    overlay.classList.add('visible');
    e.preventDefault();
  });

  document.addEventListener('pointermove', e=>{
    if(!dragState) return;
    const el = dragState.el;
    const rect = overlay.getBoundingClientRect();
    const cellW = rect.width/cols; const cellH = rect.height/rows;
    if(dragState.type==='move'){
      const dx = Math.round((e.clientX - dragState.startX)/cellW);
      const dy = Math.round((e.clientY - dragState.startY)/cellH);
      let nx = Math.max(0, Math.min(cols-1, dragState.origX + dx));
      let ny = Math.max(0, Math.min(rows-1, dragState.origY + dy));
      el.dataset.x = nx; el.dataset.y = ny;
      placeModule(el);
    } else if(dragState.type==='resize'){
      const dw = Math.round((e.clientX - dragState.startX)/(rect.width/cols));
      const dh = Math.round((e.clientY - dragState.startY)/(rect.height/rows));
      let nw = Math.max(1, Math.min(cols, dragState.startW + dw));
      let nh = Math.max(1, Math.min(rows, dragState.startH + dh));
      el.dataset.w = nw; el.dataset.h = nh;
      placeModule(el);
    }
    // highlight cells currently covered
    document.querySelectorAll('.grid-overlay .cell').forEach(cell=>cell.classList.remove('visible'));
    const x=parseInt(el.dataset.x,10), y=parseInt(el.dataset.y,10), w=parseInt(el.dataset.w,10), h=parseInt(el.dataset.h,10);
    for(let rr=y; rr<y+h; rr++){
      for(let cc=x; cc<x+w; cc++){
        const idx = rr*cols + cc; const cell = overlay.children[idx]; if(cell) cell.classList.add('visible');
      }
    }
  });

  document.addEventListener('pointerup', e=>{ if(dragState){ dragState=null; overlay.classList.remove('visible'); } });

  // create example charts using last 30 days data from /api/transactions
  async function loadLast30(){
    try{
      const res = await fetch('/api/transactions');
      if(!res.ok) return;
      const data = await res.json();
      // aggregate by date, store, product and payment
      const today = new Date(Math.max(...data.map(d=>new Date(d.date))));
      const end = new Date(today); end.setHours(23,59,59,999);
      const start = new Date(end); start.setDate(end.getDate()-29); start.setHours(0,0,0,0);

      const dates = [];
      for(let i=0;i<30;i++){ const dt = new Date(start); dt.setDate(start.getDate()+i); dates.push(dt.toISOString().split('T')[0]); }

      const byDate = {};
      const storeTotals = {};
      const productTotals = {};
      const payTotals = {};
      data.forEach(t=>{
        const d = (new Date(t.date)).toISOString().split('T')[0];
        if(new Date(t.date) < start || new Date(t.date) > end) return;
        byDate[d] = (byDate[d]||0) + (parseFloat(t.amount)||0);
        storeTotals[t.shopName] = (storeTotals[t.shopName]||0) + (parseFloat(t.amount)||0);
        productTotals[t.product] = (productTotals[t.product]||0) + (parseFloat(t.amount)||0);
        payTotals[t.payType] = (payTotals[t.payType]||0) + (parseFloat(t.amount)||0);
      });

      const trendData = dates.map(d=>byDate[d]||0);

      const chartOptions = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: true,
            position: 'bottom'
          }
        }
      };

      // 銷售趨勢圖
      new Chart(document.getElementById('chart-sales-trend'), {
        type: 'line',
        data: {
          labels: dates,
          datasets: [{
            data: trendData,
            borderColor: '#2196F3',
            backgroundColor: 'rgba(33,150,243,0.08)',
            tension: 0.4
          }]
        },
        options: {
          ...chartOptions,
          plugins: {
            ...chartOptions.plugins,
            legend: { display: false }
          },
          scales: {
            x: { display: false },
            y: { display: false }
          }
        }
      });

      // 分店銷售圖
      new Chart(document.getElementById('chart-store-sales'), {
        type: 'bar',
        data: {
          labels: Object.keys(storeTotals),
          datasets: [{
            data: Object.values(storeTotals),
            backgroundColor: '#36A2EB'
          }]
        },
        options: {
          ...chartOptions,
          plugins: {
            ...chartOptions.plugins,
            legend: { display: false }
          },
          scales: {
            x: { display: false },
            y: { display: false }
          }
        }
      });

      // 產品佔比圖
      new Chart(document.getElementById('chart-product-share'), {
        type: 'doughnut',
        data: {
          labels: Object.keys(productTotals),
          datasets: [{
            data: Object.values(productTotals),
            backgroundColor: ['#FF6384','#36A2EB','#FFCE56','#4BC0C0']
          }]
        },
        options: {
          ...chartOptions,
          plugins: {
            ...chartOptions.plugins,
            legend: { display: false }
          }
        }
      });

      // 支付方式佔比圖
      new Chart(document.getElementById('chart-pay-share'), {
        type: 'pie',
        data: {
          labels: Object.keys(payTotals),
          datasets: [{
            data: Object.values(payTotals),
            backgroundColor: ['#8AC926','#FF9F40','#9966FF']
          }]
        },
        options: {
          ...chartOptions,
          plugins: {
            ...chartOptions.plugins,
            legend: { display: false }
          }
        }
      });

    }catch(e){ console.error('failed to load transactions',e) }
  }
  loadLast30();

})();
