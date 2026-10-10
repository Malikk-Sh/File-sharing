/* PhoneDrop Motion System 2.0 — authored transitions, not decorative CSS. */
(() => {
  'use strict';
  const MOTION_KEY='phonedrop:light-animations';
  let lightAnimations=false;
  try{lightAnimations=localStorage.getItem(MOTION_KEY)==='1';}catch{}
  document.documentElement.dataset.motionMode=lightAnimations?'light':'full';
  const supportsAnimations = typeof Element.prototype.animate === 'function';
  const motion = () => supportsAnimations;
  const ease = 'cubic-bezier(.18,.88,.24,1)';
  const quick = 'cubic-bezier(.2,.8,.2,1)';
  const spring = 'cubic-bezier(.15,1,.26,1)';
  const screens = ['room', 'files', 'connect'];
  const overlays = ['send', 'settings', 'file'];
  const closing = new WeakMap();
  let pendingViewAnimations = [];
  let toastCloseTimer = null;

  function play(element, frames, options) {
    if (!element || !motion()) return null;
    const timing={duration:500,easing:ease,fill:'both',...options};
    if(lightAnimations){
      timing.duration=Math.max(130,Math.round((timing.duration||500)*.44));
      timing.delay=Math.round((timing.delay||0)*.4);
      frames=frames.map(f=>({...f,...(typeof f.filter==='string'&&f.filter.includes('blur')?{filter:'none'}:{})}));
    }
    try{return element.animate(frames,timing);}
    catch { return null; }
  }
  function clearAnimations(animations) {
    for (const animation of animations) { try { animation.cancel(); } catch {} }
    animations.length = 0;
  }
  const originalNavigate = navigate;
  navigate = function(screen, options) {
    if (!screens.includes(screen)) return;
    const oldName = activeScreen;
    if (screen === oldName) { originalNavigate(screen, options); return; }
    const leaving = document.querySelector(`[data-screen="${oldName}"]`);
    const incoming = document.querySelector(`[data-screen="${screen}"]`);
    clearAnimations(pendingViewAnimations);
    // Any interrupted transition has to leave exactly one visible view.
    for (const panel of document.querySelectorAll('.view.motion-departing')) {
      panel.classList.remove('motion-departing');
      panel.hidden = true;
      panel.removeAttribute('aria-hidden');
    }
    originalNavigate(screen, options);
    moveNavGlider();
    if (!motion() || !leaving || !incoming) return;
    const direction = Math.sign(screens.indexOf(screen) - screens.indexOf(oldName)) || 1;
    // Keep the outgoing screen visible until its EXIT animation has actually finished.
    leaving.hidden = false;
    leaving.classList.add('motion-departing');
    leaving.setAttribute('aria-hidden', 'true');
    leaving.inert = true;
    incoming.classList.add('motion-entering');
    const out = play(leaving, [
      {transform:'translate3d(0,0,0) scale(1)',opacity:1,filter:'blur(0px)'},
      {transform:`translate3d(${-direction*24}%,0,0) scale(.95)`,opacity:0,filter:'blur(6px)'}
    ], {duration:460,easing:'cubic-bezier(.55,0,.3,1)'});
    const into = play(incoming, [
      {transform:`translate3d(${direction*32}%,12px,0) scale(.955)`,opacity:.22,filter:'blur(8px)'},
      {transform:'translate3d(0,0,0) scale(1)',opacity:1,filter:'blur(0px)'}
    ], {duration:630,easing:spring});
    if (out) {
      pendingViewAnimations.push(out);
      out.finished.catch(()=>{}).then(() => {
        if (leaving.classList.contains('motion-departing')) {
          leaving.hidden = true;
          leaving.classList.remove('motion-departing');
          leaving.inert = false;
          leaving.removeAttribute('aria-hidden');
        }
      });
    } else { leaving.hidden = true; leaving.classList.remove('motion-departing'); leaving.inert = false; }
    if (into) {
      pendingViewAnimations.push(into);
      into.finished.catch(()=>{}).then(()=>incoming.classList.remove('motion-entering'));
    } else incoming.classList.remove('motion-entering');
    // Reveal the new screen as a sequence, without delaying access to controls.
    const cascade = screen === 'room'
      ? ['.hero-heading','.hero-phones','.status-row','.code-panel','.room-actions']
      : screen === 'files'
        ? ['.screen-head','.file-segment','.file-list','.files-footnote']
        : ['.screen-head','.segment','.connect-content'];
    cascade.forEach((selector,i) => {
      const el = incoming.querySelector(selector);
      const phones = selector === '.hero-phones';
      const start = phones ? 'translateX(-50%) translateY(22px)' : 'translate3d(0,22px,0)';
      const end = phones ? 'translateX(-50%) translateY(0)' : 'translate3d(0,0,0)';
      const anim = play(el,[{opacity:0,transform:start},{opacity:1,transform:end}],{duration:550,delay:140+i*78,easing:ease});
      if (anim) pendingViewAnimations.push(anim);
    });
  };

  // Real travelling navigation light instead of instant active-class switches.
  const nav = document.querySelector('.bottom-nav');
  const navGlider = document.createElement('span');
  navGlider.className = 'motion-nav-glider';
  navGlider.setAttribute('aria-hidden','true');
  nav?.prepend(navGlider);
  let navX = null;
  function moveNavGlider() {
    const selected = nav?.querySelector('.nav-link.current');
    if (!selected) return;
    const host = nav.getBoundingClientRect(), box = selected.getBoundingClientRect();
    const to = box.left - host.left + (box.width - 42)/2;
    if (navX === null || !motion()) { navGlider.style.transform = `translate3d(${to}px,0,0)`; navX = to; return; }
    const from = navX;
    navX = to;
    navGlider.getAnimations().forEach(a=>a.cancel());
    navGlider.style.transform = `translate3d(${to}px,0,0)`;
    play(navGlider,[
      {transform:`translate3d(${from}px,0,0) scaleX(1)`},
      {transform:`translate3d(${(from+to)/2}px,0,0) scaleX(1.55)`,offset:.52},
      {transform:`translate3d(${to}px,0,0) scaleX(1)`}
    ],{duration:575,easing:spring,fill:'none'});
  }
  new ResizeObserver(moveNavGlider).observe(nav);
  requestAnimationFrame(moveNavGlider);

  // Segmented controls have a single luminous thumb that glides between options.
  const gliders = new WeakMap();
  function positionSegment(segment, animate = true) {
    const active = segment.querySelector('.segment-btn.active');
    let state = gliders.get(segment);
    if (!active) return;
    const rect = segment.getBoundingClientRect(), target = active.getBoundingClientRect();
    if (!state) {
      const glider = document.createElement('span');
      glider.className = 'motion-segment-glider';
      glider.setAttribute('aria-hidden','true');
      segment.prepend(glider);
      state = {glider,x:null,w:null};
      gliders.set(segment,state);
    }
    const x = target.left - rect.left;
    const w = target.width;
    const {glider} = state;
    const fromX=state.x, fromW=state.w;
    state.x=x;state.w=w;
    glider.getAnimations().forEach(a=>a.cancel());
    glider.style.left = '0';
    glider.style.width = `${w}px`;
    glider.style.transform = `translate3d(${x}px,0,0)`;
    if (animate && fromX != null && motion() && Math.abs(x-fromX)>1) play(glider,[
      {transform:`translate3d(${fromX}px,0,0) scaleX(${fromW/w})`},
      {transform:`translate3d(${x}px,0,0) scaleX(1)`}
    ],{duration:570,easing:spring,fill:'none'});
  }
  for (const segment of document.querySelectorAll('.segment')) {
    positionSegment(segment,false);
    new ResizeObserver(()=>positionSegment(segment,false)).observe(segment);
    segment.addEventListener('click',()=>requestAnimationFrame(()=>positionSegment(segment,true)));
  }
  const originalShowConnect = showConnectTab;
  showConnectTab = function(tab) {
    const previous = connectTab;
    originalShowConnect(tab);
    const segment = document.querySelector('.view[data-screen="connect"] .segment');
    requestAnimationFrame(()=>positionSegment(segment,true));
    if (!motion() || tab===previous) return;
    const pane=document.querySelector(`[data-connect-pane="${tab}"]`);
    if (pane) play(pane,[
      {transform:'translate3d(0,20px,0) scale(.965)',opacity:0,filter:'blur(5px)'},
      {transform:'translate3d(0,0,0) scale(1)',opacity:1,filter:'blur(0px)'}
    ],{duration:515,easing:spring});
  };

  // Panels animate ON THE WAY OUT, a missing part of the previous implementation.
  const originalOpen = openOverlay;
  const originalClose = closeOverlay;
  const runningSheets = new WeakMap();
  function sheetOf(overlay) { return overlay.querySelector('.send-sheet,.settings-sheet,.file-sheet'); }
  function cancelSheet(overlay) {
    for (const animation of runningSheets.get(overlay)||[]) { try{animation.cancel();}catch{} }
    runningSheets.set(overlay,[]);
    overlay.classList.remove('motion-closing');
  }
  openOverlay = function(which) {
    const overlay = $(`${which}Overlay`);
    if (!overlay) return;
    cancelSheet(overlay);
    // Resume gracefully after a user rapidly closes and reopens a sheet.
    if (!overlay.hidden) { overlay.classList.remove('motion-closing'); return; }
    originalOpen(which);
    if (!motion()) return;
    const sheet=sheetOf(overlay),backdrop=overlay.querySelector('.overlay-backdrop');
    const animations=[];
    const back=play(backdrop,[{opacity:0,backdropFilter:'blur(0px)'},{opacity:1,backdropFilter:'blur(7px)'}],{duration:390,easing:quick});
    const incoming=play(sheet,[
      {transform:'translate3d(0,105%,0) scale(.96)',opacity:.55},
      {transform:'translate3d(0,-13px,0) scale(1.006)',opacity:1,offset:.73},
      {transform:'translate3d(0,4px,0) scale(.998)',opacity:1,offset:.90},
      {transform:'translate3d(0,0,0) scale(1)',opacity:1}
    ],{duration:770,easing:'cubic-bezier(.22,.77,.24,1)',fill:'none'});
    animations.push(...[back,incoming].filter(Boolean));
    runningSheets.set(overlay,animations);
    if (incoming) incoming.finished.catch(()=>{}).then(()=>{
      if (!overlay.hidden && !overlay.classList.contains('motion-closing')) {
        animations.forEach(a=>{try{a.cancel();}catch{}});
      }
    });
    if(which==='send') requestAnimationFrame(()=>{
      overlay.querySelectorAll('.send-tile').forEach((tile,i)=>play(tile,[
        {transform:'translate3d(0,32px,0) scale(.91)',opacity:0},
        {transform:'translate3d(0,0,0) scale(1)',opacity:1}
      ],{duration:530,delay:180+i*76,easing:spring}));
    });
    if(which==='file') requestAnimationFrame(()=>{
      overlay.querySelectorAll('.context-action').forEach((item,i)=>play(item,[
        {transform:'translate3d(0,23px,0)',opacity:0},
        {transform:'translate3d(0,0,0)',opacity:1}
      ],{duration:470,delay:170+i*65,easing:spring}));
    });
  };
  closeOverlay = function(which) {
    const overlay=$(`${which}Overlay`);
    if (!overlay || overlay.hidden || overlay.classList.contains('motion-closing')) return;
    if (!motion()) { originalClose(which); return; }
    cancelSheet(overlay);
    overlay.classList.add('motion-closing');
    const sheet=sheetOf(overlay),backdrop=overlay.querySelector('.overlay-backdrop');
    const exit=play(sheet,[
      {transform:'translate3d(0,0,0) scale(1)',opacity:1},
      {transform:'translate3d(0,12px,0) scale(.985)',opacity:1,offset:.24},
      {transform:'translate3d(0,108%,0) scale(.96)',opacity:.65}
    ],{duration:440,easing:'cubic-bezier(.55,0,.82,.28)'});
    const fade=play(backdrop,[{opacity:1},{opacity:0}],{duration:390,easing:quick});
    runningSheets.set(overlay,[exit,fade].filter(Boolean));
    if(!exit) {originalClose(which);overlay.classList.remove('motion-closing');return;}
    exit.finished.catch(()=>{}).then(()=>{
      if (overlay.classList.contains('motion-closing')) {
        originalClose(which);
        cancelSheet(overlay);
      }
    });
  };

  // Swipe the tiny grip down to dismiss (the content remains scrollable normally).
  for(const which of overlays){
    const overlay=$(`${which}Overlay`),handle=overlay?.querySelector('.sheet-handle'),sheet=sheetOf(overlay);
    if(!handle||!sheet)continue;
    let dragging=false,startY=0,lastY=0,lastT=0;
    handle.addEventListener('pointerdown',e=>{
      if(e.pointerType==='mouse'&&e.button!==0)return;
      if(overlay.classList.contains('motion-closing'))return;
      dragging=true;startY=lastY=e.clientY;lastT=performance.now();
      handle.setPointerCapture(e.pointerId);
      cancelSheet(overlay);
    });
    handle.addEventListener('pointermove',e=>{
      if(!dragging)return;
      const distance=Math.max(0,e.clientY-startY);
      sheet.style.transform=`translate3d(0,${distance}px,0)`;
      sheet.style.opacity=String(Math.max(.64,1-distance/900));
      overlay.querySelector('.overlay-backdrop').style.opacity=String(Math.max(.22,1-distance/500));
      lastY=e.clientY;lastT=performance.now();
    });
    function release(e){
      if(!dragging)return;
      dragging=false;
      const distance=Math.max(0,e.clientY-startY);
      sheet.style.transform='';sheet.style.opacity='';
      overlay.querySelector('.overlay-backdrop').style.opacity='';
      if(distance>88){closeOverlay(which);return;}
      if(motion())play(sheet,[{transform:`translate3d(0,${distance}px,0)`},{transform:'translate3d(0,-5px,0)',offset:.65},{transform:'translate3d(0,0,0)'}],{duration:440,easing:spring,fill:'none'});
    }
    handle.addEventListener('pointerup',release);
    handle.addEventListener('pointercancel',release);
  }

  // Rich, directional filters: transfer cards sweep in rather than instantly popping.
  const originalApplyFilter=applyFilter;
  let previousFilter=fileFilter;
  applyFilter=function(){
    const changed=previousFilter!==fileFilter;
    const previous=previousFilter;
    previousFilter=fileFilter;
    originalApplyFilter();
    if(!changed||!motion())return;
    const direction=['all','outgoing','incoming'].indexOf(fileFilter)-['all','outgoing','incoming'].indexOf(previous);
    const visible=[...document.querySelectorAll('#downloads .file-card:not([hidden])')];
    visible.slice(0,10).forEach((card,i)=>play(card,[
      {transform:`translate3d(${Math.sign(direction)*35}px,13px,0) scale(.965)`,opacity:0,filter:'blur(3px)'},
      {transform:'translate3d(0,0,0) scale(1)',opacity:1,filter:'blur(0px)'}
    ],{duration:530,delay:i*48,easing:spring}));
  };
  const originalHistory=renderHistory;
  renderHistory=function(entry){
    const was=historyItems.get(entry.id);
    const oldStatus=was?.status;
    originalHistory(entry);
    const card=historyItems.get(entry.id)?.node;
    if(!card||!motion())return;
    if(!was){
      play(card,[
        {opacity:0,transform:'translate3d(0,40px,0) scale(.925)',filter:'blur(6px)'},
        {opacity:1,transform:'translate3d(0,-3px,0) scale(1.012)',filter:'blur(0px)',offset:.8},
        {opacity:1,transform:'translate3d(0,0,0) scale(1)'}
      ],{duration:720,easing:spring});
    } else if(oldStatus!==entry.status && entry.status==='done'){
      play(card,[
        {boxShadow:'0 0 0 0 #71ffca00',transform:'scale(1)'},
        {boxShadow:'0 0 0 2px #65f9b68c,0 0 30px #65f9b635',transform:'scale(1.015)',offset:.38},
        {boxShadow:'0 0 0 0 #71ffca00',transform:'scale(1)'}
      ],{duration:830,easing:ease,fill:'none'});
    }
  };

  // A more delightful toast, including a real exit before it becomes hidden.
  showMessage=function(text,error=false){
    $('message').textContent=text;
    $('message').style.color=error?'var(--red)':'var(--muted)';
    if(!$('sendOverlay').hidden && !$('sendOverlay').classList.contains('motion-closing'))return;
    const toast=$('toast');
    clearTimeout(toastCloseTimer);
    toast.getAnimations().forEach(a=>a.cancel());
    toast.textContent=text;
    toast.hidden=false;
    if(motion())play(toast,[
      {opacity:0,transform:'translate3d(-50%,29px,0) scale(.87)'},
      {opacity:1,transform:'translate3d(-50%,-3px,0) scale(1.025)',offset:.76},
      {opacity:1,transform:'translate3d(-50%,0,0) scale(1)'}
    ],{duration:580,easing:spring,fill:'none'});
    toastCloseTimer=setTimeout(()=>{
      if(!motion()){toast.hidden=true;return;}
      const leave=play(toast,[
        {opacity:1,transform:'translate3d(-50%,0,0)'},
        {opacity:0,transform:'translate3d(-50%,16px,0)'}
      ],{duration:280,easing:quick});
      leave?.finished.catch(()=>{}).then(()=>{if(toastCloseTimer)toast.hidden=true;});
    },error?4900:2850);
  };

  // Small radial light trails at the exact tap position; no blocking native clicks.
  document.addEventListener('pointerdown',e=>{
    if(!motion())return;
    const target=e.target.closest('button,.send-tile,.switch-method');
    if(!target||target.disabled||target.closest('[hidden]'))return;
    const box=target.getBoundingClientRect();
    if(!box.width||!box.height)return;
    target.classList.add('motion-tap');
    const wave=document.createElement('span');
    wave.className='motion-wave';
    wave.style.left=`${e.clientX-box.left}px`;
    wave.style.top=`${e.clientY-box.top}px`;
    target.append(wave);
    const scale=Math.max(box.width,box.height)/10;
    const anim=play(wave,[
      {opacity:.75,transform:'translate(-50%,-50%) scale(.2)'},
      {opacity:0,transform:`translate(-50%,-50%) scale(${scale})`}
    ],{duration:700,easing:quick,fill:'none'});
    if(anim)anim.finished.catch(()=>{}).then(()=>wave.remove());
    else wave.remove();
    if(target.matches('button')&&e.pointerType!=='mouse'){
      play(target,[{transform:'scale(1)'},{transform:'scale(.94)',offset:.22},{transform:'scale(1.025)',offset:.75},{transform:'scale(1)'}],{duration:390,easing:spring,fill:'none'});
    }
  },{passive:true});

  // Intro sequence on page load, staggered so motion is unmistakably visible.
  function intro(){
    if(!motion())return;
    const items=[
      ['.topbar',0],['.hero-heading',95],['.hero-phones',230],['.status-row',330],
      ['.code-panel',405],['.room-actions',470],['.bottom-nav',510]
    ];
    for(const [selector,delay] of items){
      const node=document.querySelector(selector);
      if(!node)continue;
      const isNav=selector==='.bottom-nav';
      const phones = selector === '.hero-phones';
      const t = (y,scale=1) => phones ? `translateX(-50%) translateY(${y}px) scale(${scale})` : `translate3d(0,${y}px,0) scale(${scale})`;
      play(node,[
        {opacity:isNav?.45:0,transform:t(isNav?35:42,.96),filter:isNav?'none':'blur(4px)'},
        {opacity:1,transform:t(-3,1.005),filter:'blur(0px)',offset:.82},
        {opacity:1,transform:t(0,1),filter:'blur(0px)'}
      ],{duration:850,delay,easing:spring,fill:'none'});
    }
  }
  function installMotionSetting(){
    const host=document.querySelector('#settingsOverlay .settings-sheet');
    const next=host?.querySelector('#settingsNewRoom');
    if(!next||host.querySelector('#motionPreference'))return;
    const row=document.createElement('label');
    row.id='motionPreference';row.className='motion-preference';
    row.innerHTML='<span class="motion-preference-icon" aria-hidden="true">✦</span><span class="motion-preference-copy"><strong>Облегчённые анимации</strong><small>Короткие и спокойные переходы. По умолчанию — полные эффекты.</small></span><input id="lightAnimations" type="checkbox" role="switch" aria-label="Облегчённые анимации"><span class="motion-switch-track" aria-hidden="true"><span></span></span>';
    next.before(row);
    const toggle=row.querySelector('input');toggle.checked=lightAnimations;
    toggle.addEventListener('change',()=>{
      lightAnimations=toggle.checked;
      document.documentElement.dataset.motionMode=lightAnimations?'light':'full';
      try{localStorage.setItem(MOTION_KEY,lightAnimations?'1':'0');}catch{}
      showMessage(lightAnimations?'Облегчённые анимации включены':'Полные анимации включены');
    });
  }
  installMotionSetting();
  requestAnimationFrame(()=>requestAnimationFrame(intro));
})();
