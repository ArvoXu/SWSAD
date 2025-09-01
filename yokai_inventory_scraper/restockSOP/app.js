(function(){
  // Steps derived from restockSOP.txt
  const steps = [
    {
      title: '1. 上架產品',
      lead: '確認商品標籤與 QR code，清潔掃描器。',
      items: ['標籤對齊', 'QR code 方向正確', '擦拭掃描器']
    },
    {
      title: '2. 掃描庫存',
      lead: '按照機台指示進行掃描，確認螢幕顯示正常。',
      items: ['清除按鈕 按 4', '掃描上架 按 1 2 3 2 1']
    },
    {
      title: '3. 關門確認',
      lead: '確認門已經關好，.dor 不再跳動。',
      items: ['確認門已關上']
    },
    {
      title: '4. 清潔',
      lead: '清理面板、出水槽並收好管線。',
      items: ['面板與出水槽清理', '放好面板（不能有翹起）', '把連接廢水槽的兩個管子拉起來', '將廢水槽內水倒掉並清潔', '放回時確認管子有接好']
    },
    {
      title: '5. 查看掃描結果',
      lead: '確認螢幕顏色與機台外觀，最後清潔。',
      items: ['白色 = 有貨、橘色 = 空', '小螢幕按鈕：左下(3) 點擊 4 次，右上(2) 點擊 2 次', '最後確認機台外觀，擦拭髒汙'],
      note: '教學影片',
      video: 'https://www.youtube.com/watch?v=8VPnyp9VL70'
    }
  ];

  const pages = document.getElementById('pages');
  const backBtn = document.getElementById('backBtn');
  const nextBtn = document.getElementById('nextBtn');
  const progress = document.getElementById('progress');
  const celebration = document.getElementById('celebration');

  let currentIndex = -1; // start at welcome page (-1)

  function createWelcomePage(){
    const el = document.createElement('div');
    el.className = 'page';
    el.dataset.index = -1;
    el.innerHTML = `
      <div class="header">
        <div class="h1">準備開始補貨囉！</div>
        <div class="lead">今天一起加油吧～</div>
      </div>
      <div class="card" style="margin-top:28px;text-align:center">
        <div style="font-weight:700;font-size:18px">任務說明</div>
        <div class="small muted" style="margin-top:8px;color:var(--muted)">請逐步完成每個階段，點選核取方塊來標示已完成項目。</div>
        <div style="margin-top:14px">
          <button id="startBtn" class="btn primary">開始補貨</button>
        </div>
      </div>
    `;
    return el;
  }

  function createStepPage(step, idx){
    const el = document.createElement('div');
    el.className = 'page hidden';
    el.dataset.index = idx;

    const itemsHtml = step.items.map((it, i)=>{
      return `<label class="check-item"><input type="checkbox" data-idx="${i}"><div><div style="font-weight:700">${String.fromCharCode(97+i)}. ${it}</div></div></label>`;
    }).join('');

    el.innerHTML = `
      <div class="header">
        <div class="h1">${step.title}</div>
        <div class="lead">${step.lead}</div>
      </div>
      <div class="card">
        <div class="checklist">${itemsHtml}</div>
        ${step.note ? `<a class="video-link" href="${step.video}" target="_blank">▶ ${step.note}（開啟教學影片）</a>` : ''}
      </div>
    `;

    return el;
  }

  function createFinalPage(){
    const el = document.createElement('div');
    el.className = 'page hidden';
    el.dataset.index = steps.length;
    el.innerHTML = `
      <div class="header">
        <div class="h1">任務完成 🎉</div>
        <div class="lead">辛苦了！補貨任務已經完成。</div>
      </div>
      <div class="card" style="text-align:center">
        <div class="final-emoji">🏆</div>
        <div style="font-weight:700;margin-top:8px">好棒！今天你又完成了一次任務。</div>
        <div class="footer-note">記得鎖好門並回報給主管。</div>
      </div>
    `;
    return el;
  }

  // Render all pages
  pages.appendChild(createWelcomePage());
  steps.forEach((s,i)=>pages.appendChild(createStepPage(s,i)));
  pages.appendChild(createFinalPage());

  const pageEls = () => Array.from(pages.querySelectorAll('.page'));

  function showPage(index){
    currentIndex = index;
    pageEls().forEach(p=>{
      const pi = parseInt(p.dataset.index,10);
      if(pi === index) p.classList.remove('hidden'); else p.classList.add('hidden');
    });

    // Update controls
    if(index === -1){
      backBtn.style.visibility = 'hidden';
      nextBtn.textContent = '開始';
    } else if(index === steps.length){
      backBtn.style.visibility = 'visible';
      nextBtn.textContent = '完成';
    } else {
      backBtn.style.visibility = index===0? 'visible':'visible';
      nextBtn.textContent = '下一步';
    }

    progress.textContent = (Math.max(0,index)+1) + ' / ' + (steps.length+1);
    // Wire up start button if on welcome
    if(index === -1){
      const startBtn = document.getElementById('startBtn');
      startBtn.addEventListener('click',()=>{ showPage(0); });
    }

    // Attach change listeners for checkboxes
    const visiblePage = pages.querySelector(`.page[data-index='${index}']`);
    if(visiblePage){
      const checkboxes = visiblePage.querySelectorAll('input[type=checkbox]');
      checkboxes.forEach(cb=>cb.addEventListener('change', ()=>{
        // enable next only when all checked
        const all = Array.from(checkboxes).every(i=>i.checked);
        nextBtn.disabled = !all;
        if(all){ nextBtn.classList.add('primary'); } else { nextBtn.classList.remove('primary'); }
      }));
      // set initial nextBtn state
      if(visiblePage.querySelectorAll('input[type=checkbox]').length===0){ nextBtn.disabled=false; } else {
        nextBtn.disabled = !Array.from(visiblePage.querySelectorAll('input[type=checkbox]')).every(i=>i.checked);
      }
    }
  }

  function showCelebration(message){
    celebration.querySelector('.celebration-text').textContent = message || '做得好！';
    celebration.classList.remove('hidden');
    // create star burst
    for(let i=0;i<8;i++){
      const s = document.createElement('div');
      s.className = 'star';
      s.style.left = (50 + (Math.random()*160-80)) + 'px';
      s.style.top = (Math.random()*80+20) + 'px';
      s.textContent = ['⭐','✨','🎖️','🏅'][Math.floor(Math.random()*4)];
      celebration.appendChild(s);
      setTimeout(()=>s.remove(),900);
    }
    setTimeout(()=> celebration.classList.add('hidden'),900);
  }

  backBtn.addEventListener('click', ()=>{
    if(currentIndex === -1) return;
    showPage(Math.max(-1,currentIndex-1));
  });

  nextBtn.addEventListener('click', ()=>{
    if(currentIndex === -1){ showPage(0); return; }
    if(currentIndex < steps.length-1){
      // show celebration then advance
      showCelebration(['做得好！','很棒！','幹得漂亮！'][Math.floor(Math.random()*3)]);
      setTimeout(()=> showPage(currentIndex+1), 600);
    } else if(currentIndex === steps.length-1){
      showCelebration('任務完成！辛苦了');
      setTimeout(()=> showPage(steps.length), 800);
    } else if(currentIndex === steps.length){
      // finished
      // reset to welcome or keep final screen
      showPage(-1);
    }
  });

  // Initialize
  showPage(-1);
})();
