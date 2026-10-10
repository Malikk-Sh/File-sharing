/* PhoneDrop · non-invasive UX polish; core P2P transfer stays unchanged. */
(() => {
  const overlayFocus=new WeakMap(),copyTimers=new WeakMap(),names=['send','settings','file'];
  const oldNavigate=navigate,oldOpen=openOverlay,oldClose=closeOverlay,oldPeer=setPeer,oldCopy=copy,oldHistory=renderHistory;
  history.replaceState({phoneDropScreen:activeScreen},'',location.href);
  let goingBack=false;
  navigate=function(screen){
    if(!goingBack&&screen!==activeScreen)history.pushState({phoneDropScreen:screen},'',location.href);
    return oldNavigate(screen);
  };
  window.addEventListener('popstate',event=>{
    for(const name of names)oldClose(name);
    goingBack=true;
    try{navigate(['room','files','connect'].includes(event.state?.phoneDropScreen)?event.state.phoneDropScreen:'room');}
    finally{goingBack=false;}
  });
  setPeer=function(text,ready=false){
    oldPeer(text,ready);
    const hint=document.getElementById('deviceHint');
    if(hint)hint.textContent=ready?'Готово к обмену файлами':'Можно подключиться по коду или ссылке';
  };
  openOverlay=function(which){
    const el=document.getElementById(which+'Overlay');
    if(!el?.hidden)return;
    for(const name of names)if(name!==which)oldClose(name);
    overlayFocus.set(el,document.activeElement);
    oldOpen(which);
    requestAnimationFrame(()=>{
      if(!el.hidden)(el.querySelector('[id^="close"]')||el.querySelector('button'))?.focus({preventScroll:true});
    });
  };
  closeOverlay=function(which){
    const el=document.getElementById(which+'Overlay');
    if(!el||el.hidden)return;
    oldClose(which);
    const source=overlayFocus.get(el);
    if(source?.isConnected)source.focus({preventScroll:true});
  };
  copy=async function(text){
    const source=document.activeElement;
    try {
      await navigator.clipboard.writeText(text);
      showMessage('Скопировано в буфер обмена');
      if(source?.classList?.contains('icon-btn')){
        source.dataset.copied='true';
        clearTimeout(copyTimers.get(source));
        copyTimers.set(source,setTimeout(()=>delete source.dataset.copied,1400));
      }
    } catch {
      showMessage('Не удалось скопировать. Попробуй системное меню.',true);
    }
  };
  renderHistory=function(entry){
    oldHistory(entry);
    const card=historyItems.get(entry.id)?.node;
    if(!card||card.dataset.holdReady)return;
    card.dataset.holdReady='1';
    card.dataset.transferId=entry.id;
    let timer=null,x=0,y=0;
    const stop=()=>{clearTimeout(timer);timer=null;};
    card.addEventListener('pointerdown',e=>{
      if(e.pointerType==='mouse'||e.target.closest('button,a')||!e.isPrimary)return;
      x=e.clientX;y=e.clientY;
      timer=setTimeout(()=>{
        const latest=historyItems.get(card.dataset.transferId);
        if(latest){navigator.vibrate?.(10);fileMenu(latest);}
      },500);
    });
    card.addEventListener('pointermove',e=>{if(Math.abs(x-e.clientX)>12||Math.abs(y-e.clientY)>12)stop();});
    for(const type of ['pointerup','pointercancel','pointerleave'])card.addEventListener(type,stop);
  };
  window.addEventListener('keydown',event=>{
    const overlay=names.map(name=>document.getElementById(name+'Overlay')).find(el=>!el.hidden);
    if(!overlay)return;
    if(event.key==='Escape'){event.preventDefault();closeOverlay(overlay.id.replace('Overlay',''));return;}
    if(event.key!=='Tab')return;
    const targets=[...overlay.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),summary,[href]')]
      .filter(el=>el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden');
    if(!targets.length)return;
    if(event.shiftKey&&document.activeElement===targets[0]){event.preventDefault();targets.at(-1).focus();}
    else if(!event.shiftKey&&document.activeElement===targets.at(-1)){event.preventDefault();targets[0].focus();}
  });
})();
