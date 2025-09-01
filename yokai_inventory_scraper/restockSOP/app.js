(function(){
  // Steps derived from restockSOP.txt
  const steps = [
    {
      title: '1. 上架產品',
      lead: '確認標籤與 QR code方向、清潔掃描器',
      items: ['標籤對齊', 'QR code 方向正確', '擦拭掃描器']
    },
    {
      title: '2. 掃描庫存',
      lead: '螢幕四個角的左上、右上、左下、右下分別對應1234',
      items: ['清除 按4', '掃描上架 按1 2 3 2 1']
    },
    {
      title: '3. 關門',
      lead: '確認門已經關好，.dor 不再跳動',
      items: ['門已關上']
    },
    {
      title: '4. 清潔',
      lead: '清理面板、出水槽並收好管線',
      items: ['面板與出水槽清理', '放好面板（不能有翹起）', '把連接廢水槽的兩個管子拉起來', '將廢水槽內水倒掉並清潔', '放回並確認管子有接好']
    },
    {
      title: '5. 查看掃描結果',
      lead: '確認補貨狀況與機台外觀，最後清潔。<br>⚪ = 有貨  🟠 = 空<br>螢幕四個角的左上、右上、左下、右下分別對應1, 2, 3, 4',
      items: ['螢幕顯示補貨結果與實際擺放結果一致', '清潔：左下(3) 點擊 4 次，右上(2) 點擊 2 次', '確認機台外觀，擦拭髒汙'],
      note: '教學影片',
      video: 'https://youtu.be/oBLusJO8aOk'
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
        <div class="h1">補貨SOP Checklist</div>
        <div class="lead">今天一起加油吧～</div>
      </div>
      <div class="card" style="margin-top:28px;text-align:center">
        <div style="font-weight:700;font-size:18px">說明</div>
        <div class="small muted" style="margin-top:8px;color:var(--muted)">請按照順序逐步完成每個階段，點選項目來標示已完成。</div> 
        <a class="video-link" href="https://youtu.be/oBLusJO8aOk" target="_blank" style="margin-top:8px;display:inline-block">▶ 教學影片（開啟）</a>
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

    // render items without native checkbox inputs; we'll manage state via data attributes
    const itemsHtml = step.items.map((it, i)=>{
      return `<div class="check-item" data-idx="${i}" data-checked="false"><div class="label-content"><div class="item-title">${String.fromCharCode(97+i)}. ${it}</div></div></div>`;
    }).join('');

    el.innerHTML = `
      <div class="header">
        <div class="h1">${step.title}</div>
        <div class="lead">${step.lead}</div>
      </div>
      <div class="card">
  <div class="checklist">${itemsHtml}</div>
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
        <div style="font-weight:700;margin-top:8px">好棒！今天你又完成了一次補貨。</div>
        <div class="footer-note">記得鎖好門哦~</div>
      </div>
    `;
    return el;
  }

  // Append feedback UI to final page dynamically so it's part of the flow
  function appendFeedbackUI(finalPage){
    const fbCard = document.createElement('div');
    fbCard.className = 'card';
    fbCard.style.marginTop = '14px';
    fbCard.innerHTML = `
      <div style="font-weight:700;margin-bottom:8px">給我們一個評價（匿名）</div>
      <div id="starRow" class="star-row" aria-label="評分">
        <button data-star="1" class="star-btn">☆</button>
        <button data-star="2" class="star-btn">☆</button>
        <button data-star="3" class="star-btn">☆</button>
        <button data-star="4" class="star-btn">☆</button>
        <button data-star="5" class="star-btn">☆</button>
      </div>
      <div id="ratingText" class="small" style="margin-top:8px;color:var(--muted)">選擇星數來給予評分</div>
      <textarea id="fbComment" maxlength="500" placeholder="可選：寫下改進建議或鼓勵的話，或是補貨遇到的困難... (最多500字)" rows="3" style="width:100%;margin-top:8px;padding:10px;border-radius:8px;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.04);color:inherit"></textarea>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px">
        <div id="fbCounter" class="small" style="color:var(--muted)">0 / 500</div>
        <div>
          <button id="submitFb" class="btn primary">送出評價</button>
        </div>
      </div>
      <div id="fbResult" class="small" style="margin-top:8px;color:var(--muted)"></div>
    `;
    finalPage.querySelector('.card').after(fbCard);

    // client-side helper: persistent anonymous id stored in localStorage
    function getOrCreateUserId(){
      try{
        const key = 'restockSOP_userId_v1';
        let id = localStorage.getItem(key);
        if(!id){
          id = 'u_' + Math.random().toString(36).slice(2,10) + Date.now().toString(36).slice(-4);
          localStorage.setItem(key, id);
        }
        return id;
      }catch(e){ return 'u_anonymous'; }
    }

    const starRow = fbCard.querySelector('#starRow');
    const ratingText = fbCard.querySelector('#ratingText');
  const commentEl = fbCard.querySelector('#fbComment');
  const submitBtn = fbCard.querySelector('#submitFb');
  const resultEl = fbCard.querySelector('#fbResult');
  const counterEl = fbCard.querySelector('#fbCounter');

    const ratingMap = {
      1: '認真? 😞',
      2: '不太喜歡 😕',
      3: '普 🙂',
      4: '滿意 😄',
      5: '完美！🌟'
    };

    let currentRating = 0;
    function renderStars(r){
      currentRating = r;
      Array.from(starRow.querySelectorAll('.star-btn')).forEach(btn=>{
        const s = parseInt(btn.dataset.star,10);
        btn.textContent = s <= r ? '★' : '☆';
        btn.classList.toggle('active', s <= r);
      });
      ratingText.textContent = r ? `${r} 顆星 — ${ratingMap[r]}` : '選擇星數來給予評分';
    }

    starRow.addEventListener('click', (ev)=>{
      const btn = ev.target.closest('.star-btn');
      if(!btn) return;
      const s = parseInt(btn.dataset.star,10);
      renderStars(s);
    });

    submitBtn.addEventListener('click', async ()=>{
      if(currentRating < 1){ resultEl.textContent = '請先選擇星數。'; return; }
      submitBtn.disabled = true; resultEl.textContent = '送出中…';
      const payload = { userId: getOrCreateUserId(), rating: currentRating, comment: commentEl.value.trim() };
      try{
        const res = await fetch('/api/feedback', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload)});
        if(res.status === 201){ resultEl.textContent = '感謝你的回饋！'; submitBtn.textContent = '已送出'; }
        else if(res.status === 409){ resultEl.textContent = '看起來你剛剛已經送過類似回饋了，感謝！'; }
        else {
          const json = await res.json().catch(()=>({}));
          resultEl.textContent = json.error || '送出失敗，請稍後再試。';
        }
      }catch(e){ resultEl.textContent = '無法連線到伺服器'; }
      finally{ submitBtn.disabled = false; }
    });

    // live character counter for comment (maxlength enforced at 500)
    commentEl.addEventListener('input', ()=>{
      const len = commentEl.value.length;
      counterEl.textContent = `${len} / 500`;
      if(len > 500) counterEl.style.color = '#ff7b7b'; else counterEl.style.color = 'var(--muted)';
    });
  }

  // Render all pages
  pages.appendChild(createWelcomePage());
  steps.forEach((s,i)=>pages.appendChild(createStepPage(s,i)));
  pages.appendChild(createFinalPage());

  const pageEls = () => Array.from(pages.querySelectorAll('.page'));

  // Attach item handlers once (avoid re-binding on every page show)
  function attachItemHandlers(){
    const allItems = pages.querySelectorAll('.check-item');
    allItems.forEach(it=>{
      // avoid double-binding
      if(it.__bound) return; it.__bound = true;
      it.addEventListener('click', ()=>{
        // enforce ordered checking: only allow the next unchecked item to be toggled
        const page = it.closest('.page');
        if(!page) return;
        const items = page.querySelectorAll('.check-item');
        // ensure page._nextIdx exists
        if(typeof page._nextIdx === 'undefined') page._nextIdx = 0;
        const clickedIdx = parseInt(it.getAttribute('data-idx'),10);
        const nextIdx = page._nextIdx;
        // ignore clicks on items that are not the current next index
        if(clickedIdx !== nextIdx) {
          // subtle feedback: briefly pulse the item to indicate it's not yet active
          it.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(0)' }], { duration: 220, easing: 'ease-out' });
          return;
        }
        // mark this item as checked and advance next pointer
        it.setAttribute('data-checked','true');
        page._nextIdx = nextIdx + 1;
        // update visuals: items with idx < _nextIdx are checked; idx === _nextIdx is focused; others dimmed
        updateVisualForPage(page);

        // if this page is visible, update next button state
        const visiblePage = pages.querySelector('.page:not(.hidden)');
        if(visiblePage === page){
          const all = Array.from(items).every(i=> i.getAttribute('data-checked') === 'true');
          nextBtn.disabled = !all;
          if(all) nextBtn.classList.add('primary'); else nextBtn.classList.remove('primary');
        }
      });
    });
  }
  attachItemHandlers();

  // helper: update visual classes for items inside a page element
  // Behavior (sequential): page._nextIdx controls which item is next to complete
  // - items with idx < _nextIdx => checked
  // - item with idx === _nextIdx => highlighted (bright, not checked)
  // - items with idx > _nextIdx => dimmed
  function updateVisualForPage(page){
    const items = page.querySelectorAll('.check-item');
    const nextIdx = (typeof page._nextIdx === 'number') ? page._nextIdx : 0;
    Array.from(items).forEach(i=>{
      const idx = parseInt(i.getAttribute('data-idx'),10);
      if(idx < nextIdx){
        i.setAttribute('data-checked','true');
        i.classList.add('checked');
        i.classList.remove('dimmed');
      } else if(idx === nextIdx){
        i.setAttribute('data-checked','false');
        i.classList.remove('checked');
        i.classList.remove('dimmed'); // focused item should be bright
      } else {
        i.setAttribute('data-checked','false');
        i.classList.remove('checked');
        i.classList.add('dimmed');
      }
    });
  }

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

    // when showing welcome, ensure all steps are reset (clear data-checked)
    if(index === -1){
      const allItems = pages.querySelectorAll('.check-item');
      allItems.forEach(it=>{
        it.setAttribute('data-checked','false');
        it.classList.remove('checked');
        it.classList.add('dimmed');
      });
      // update visuals for every page
      pageEls().forEach(p=> updateVisualForPage(p));
      // remove non-persistent confetti if present, but keep persistent confetti until user confirms
      if(window.__confettiPersistentCleanup){ /* keep persistent */ }
      else if(window.__confettiCleanup){ window.__confettiCleanup(); window.__confettiCleanup = null; }
    }

    // Update nextBtn state based on visible page's items
    const visiblePage = pages.querySelector(`.page[data-index='${index}']`);
    if(visiblePage){
      const items = visiblePage.querySelectorAll('.check-item');
      // If this is a step page, initialize its sequential state: nextIdx=0 and focus first item
      if(index >= 0 && index < steps.length){
        // reset the page's own items (fresh when first shown)
        visiblePage._nextIdx = 0;
        items.forEach(it=> it.setAttribute('data-checked','false'));
        updateVisualForPage(visiblePage);
        // initial state: disable next until all are checked
        nextBtn.disabled = items.length > 0;
        nextBtn.classList.remove('primary');
      } else {
        // non-step pages (welcome/final)
        if(items.length===0){ nextBtn.disabled = false; nextBtn.classList.remove('primary'); }
        else {
          const all = Array.from(items).every(i=> i.getAttribute('data-checked') === 'true');
          nextBtn.disabled = !all;
          if(all) nextBtn.classList.add('primary'); else nextBtn.classList.remove('primary');
        }
      }
    }
  }

  // showCelebration returns total milliseconds until fully hidden
  function showCelebration(message, stay=500){
    const enter = 520, leave = 420;
    celebration.querySelector('.celebration-text').textContent = message || '做得好！';
    celebration.classList.remove('hidden');
    const panel = celebration.querySelector('.celebration-panel');
    // start enter animation
    panel.classList.remove('leave');
    panel.classList.add('enter');
    // decorative stars
    if(panel){
      panel.style.position = panel.style.position || 'relative';
      for(let i=0;i<5;i++){
        const s = document.createElement('div');
        s.className = 'star';
        s.style.left = (Math.random()*40+8) + 'px';
        s.style.top = (Math.random()*8-6) + 'px';
        s.textContent = ['⭐','✨','🎖️','🏅'][Math.floor(Math.random()*4)];
        panel.appendChild(s);
        setTimeout(()=>{ try{ s.remove(); }catch(e){} }, enter + stay + leave);
      }
    }
    // schedule leave
    const total = enter + stay + leave;
    setTimeout(()=>{
      panel.classList.remove('enter');
      panel.classList.add('leave');
      setTimeout(()=>{
        celebration.classList.add('hidden');
        panel.classList.remove('leave');
      }, leave);
    }, enter + stay);
    return total;
  }

  /* Lightweight confetti launcher using canvas */
  function launchConfetti(opts){
    const options = Object.assign({duration:1400, count:80}, opts||{});
    // stop previous confetti if any
    if(window.__confettiCleanup){ window.__confettiCleanup(); window.__confettiCleanup = null; }

    const cv = document.createElement('canvas');
    cv.className = 'confetti-canvas';
    document.body.appendChild(cv);
    const ctx = cv.getContext('2d');

    function resize(){ cv.width = window.innerWidth; cv.height = window.innerHeight }
    resize(); window.addEventListener('resize', resize);

    const pieces = [];
    const colors = ['#FFD56F','#FFB86B','#7EF0A4','#7AD7FF','#FF8AC7'];
    for(let i=0;i<options.count;i++){
      pieces.push({x:Math.random()*cv.width, y:-Math.random()*cv.height*0.5, vx:(Math.random()-0.5)*9, vy:Math.random()*6+2, size:Math.random()*10+6, r:Math.random()*360, color:colors[Math.floor(Math.random()*colors.length)]});
    }

    let startTime = performance.now();
    let raf;
    function frame(t){
      const now = performance.now();
      const elapsed = now - startTime;
      ctx.clearRect(0,0,cv.width,cv.height);
      let allSettled = true;
      pieces.forEach(p=>{
        if(!p.settled){
          p.x += p.vx;
          p.y += p.vy;
          p.vy += 0.36; // stronger gravity so they fall to bottom
          p.vx *= 0.995; // air friction
          p.r += p.vx*6;
          // if at or below floor, settle
          if(p.y + p.size/2 >= cv.height){
            p.y = cv.height - p.size/2;
            p.vy = 0;
            p.vx *= 0.4; // damp horizontal
            p.settled = true;
          } else {
            allSettled = false;
          }
        }
        ctx.save();
        ctx.translate(p.x,p.y);
        ctx.rotate(p.r*Math.PI/180);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size/2, -p.size/2, p.size, p.size);
        ctx.restore();
      });
      // continue animating until either duration elapsed and all settled, or a cap
      if((elapsed < options.duration) || (!allSettled && elapsed < options.duration + 1200)){
        raf = requestAnimationFrame(frame);
      } else {
        if(options.persistent){
          // leave canvas displayed with settled pieces; keep RAF minimal to avoid CPU, but draw static frame once
          try{ cancelAnimationFrame(raf); window.removeEventListener('resize', resize); }catch(e){}
          // draw one final frame of settled pieces (already rendered) and keep canvas in DOM until manual cleanup
        } else {
          cancelAnimationFrame(raf);
          window.removeEventListener('resize', resize);
          setTimeout(()=>{ try{ cv.remove(); }catch(e){} }, 400);
        }
      }
    }
    // cleanup for non-persistent confetti
    window.__confettiCleanup = ()=>{ try{ cancelAnimationFrame(raf); window.removeEventListener('resize', resize); if(cv.parentNode) cv.remove(); }catch(e){} };
    // if persistent requested, set a persistent cleanup handle and do not auto-remove cv when duration finishes
    if(options.persistent){
      window.__confettiPersistentCleanup = ()=>{ try{ cancelAnimationFrame(raf); window.removeEventListener('resize', resize); if(cv.parentNode) cv.remove(); }catch(e){} };
    }
    raf = requestAnimationFrame(frame);
  }

  backBtn.addEventListener('click', ()=>{
    if(currentIndex === -1) return;
    showPage(Math.max(-1,currentIndex-1));
  });

  nextBtn.addEventListener('click', ()=>{
    if(currentIndex === -1){ showPage(0); return; }
    if(currentIndex < steps.length-1){
      // advance normally between steps (no persistent confetti)
      const total = showCelebration(['做得好！','很棒！','漂亮！','太棒了!','你怎麼那麼棒!','你怎麼那麼膩害!'][Math.floor(Math.random()*6)], 300);
      setTimeout(()=> showPage(currentIndex+1), total);
    } else if(currentIndex === steps.length-1){
      // final step completed -> full celebration + persistent confetti
      const total = showCelebration('任務完成！辛苦了', 800);
      // launch persistent confetti that stays until user clicks the final "完成" button
      launchConfetti({duration:2000, count:160, persistent:true});
      setTimeout(()=>{
        showPage(steps.length);
        // clear checked states so restarting is fresh and force dimmed appearance
        const allItems = pages.querySelectorAll('.check-item');
        allItems.forEach(it=>{ it.setAttribute('data-checked','false'); it.classList.remove('checked'); it.classList.add('dimmed'); });
        // update visuals for every page so items appear dimmed on new start
        pageEls().forEach(p=> updateVisualForPage(p));
      }, total);
    } else if(currentIndex === steps.length){
      // finished
      // if confetti was persistent, clean it up only when user confirms final completion
      if(window.__confettiPersistentCleanup){ window.__confettiPersistentCleanup(); window.__confettiPersistentCleanup = null; }
      showPage(-1);
    }
  });

  // Initialize
  showPage(-1);
  // ensure feedback UI is appended to the final page after pages are created
  const finalPage = pages.querySelector(`.page[data-index='${steps.length}']`);
  if(finalPage) appendFeedbackUI(finalPage);
})();
