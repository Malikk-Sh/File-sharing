import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import {execFileSync} from 'node:child_process';

const root=process.cwd();
const bundle=path.join(root,'phonedrop-src.br.b64');
const work=fs.mkdtempSync(path.join(os.tmpdir(),'phonedrop-repack-'));
try{
  const current=fs.readFileSync(bundle,'utf8').trim();
  const tar=path.join(os.tmpdir(),'phonedrop-existing-'+process.pid+'.tar');
  fs.writeFileSync(tar,zlib.brotliDecompressSync(Buffer.from(current,'base64')));
  try{execFileSync('tar',['-xf',tar,'-C',work]);}
  finally{fs.rmSync(tar,{force:true});}

  // Render's build unpacks a snapshot; explicitly place the current server in
  // that snapshot, otherwise changes to server.js never reach production.
  fs.copyFileSync(path.join(root,'server.js'),path.join(work,'server.js'));
  fs.mkdirSync(path.join(work,'test'),{recursive:true});
  fs.copyFileSync(path.join(root,'test','server.test.js'),path.join(work,'test','server.test.js'));
  const target=path.join(work,'public');
  if(!fs.existsSync(path.join(target,'index.html')))throw new Error('Archive has no public/index.html');
  // Release Motion 3: start from the restored premium UI and apply the opt-in lightweight preference.
  const indexPath=path.join(target,'index.html');
  if(!fs.existsSync(path.join(target,'app.js')))throw new Error('Missing live PhoneDrop app');
  let styles=fs.readFileSync(path.join(target,'styles.css'),'utf8');
  let fxCss=fs.readFileSync(path.join(target,'finishing.css'),'utf8');
  let js=fs.readFileSync(path.join(target,'finishing.js'),'utf8');
  let html=fs.readFileSync(indexPath,'utf8');
  styles=styles.replace(/@media\(prefers-reduced-motion:reduce\)\{\s*\*,\*::before,\*::after\{animation:none!important;transition:none!important;scroll-behavior:auto!important;translate:none!important\}\s*\}/g,'/* Animation follows PhoneDrop settings. */');
  styles=styles.replace(/@media\(prefers-reduced-motion:no-preference\)\{/g,'@media(min-width:0px){');
  fxCss=fxCss.replace(/@media\(prefers-reduced-motion:reduce\)\{\*,\*::before,\*::after\{animation:none!important;transition:none!important;scroll-behavior:auto!important\}\}/g,'');
  fxCss=fxCss.replace(/@media\(prefers-reduced-motion:no-preference\)\{/g,'@media(min-width:0px){');
  if(!js.includes('phonedrop:light-animations')){
    const gate="  const noMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;";
    if(!js.includes(gate))throw new Error('Missing old motion gate');
    js=js.replace(gate,"  const MOTION_KEY='phonedrop:light-animations';\n  let lightAnimations=false;\n  try{lightAnimations=localStorage.getItem(MOTION_KEY)==='1';}catch{}\n  document.documentElement.dataset.motionMode=lightAnimations?'light':'full';");
    const motionGate='  const motion = () => !noMotion() && supportsAnimations;';
    if(!js.includes(motionGate))throw new Error('Missing motion switch');
    js=js.replace(motionGate,'  const motion = () => supportsAnimations;');
    const playOld="    try { return element.animate(frames, { duration: 500, easing: ease, fill: 'both', ...options }); }";
    if(!js.includes(playOld))throw new Error('Missing play()');
    js=js.replace(playOld,"    const timing={duration:500,easing:ease,fill:'both',...options};\n    if(lightAnimations){\n      timing.duration=Math.max(130,Math.round((timing.duration||500)*.44));\n      timing.delay=Math.round((timing.delay||0)*.4);\n      frames=frames.map(f=>({...f,...(typeof f.filter==='string'&&f.filter.includes('blur')?{filter:'none'}:{})}));\n    }\n    try{return element.animate(frames,timing);}");
    const init='  requestAnimationFrame(()=>requestAnimationFrame(intro));\n})();';
    if(!js.includes(init))throw new Error('Missing motion initialization');
    js=js.replace(init,"  function installMotionSetting(){\n    const host=document.querySelector('#settingsOverlay .settings-sheet');\n    const next=host?.querySelector('#settingsNewRoom');\n    if(!next||host.querySelector('#motionPreference'))return;\n    const row=document.createElement('label');\n    row.id='motionPreference';row.className='motion-preference';\n    row.innerHTML='<span class=\"motion-preference-icon\" aria-hidden=\"true\">✦</span><span class=\"motion-preference-copy\"><strong>Облегчённые анимации</strong><small>Короткие и спокойные переходы. По умолчанию — полные эффекты.</small></span><input id=\"lightAnimations\" type=\"checkbox\" role=\"switch\" aria-label=\"Облегчённые анимации\"><span class=\"motion-switch-track\" aria-hidden=\"true\"><span></span></span>';\n    next.before(row);\n    const toggle=row.querySelector('input');toggle.checked=lightAnimations;\n    toggle.addEventListener('change',()=>{\n      lightAnimations=toggle.checked;\n      document.documentElement.dataset.motionMode=lightAnimations?'light':'full';\n      try{localStorage.setItem(MOTION_KEY,lightAnimations?'1':'0');}catch{}\n      showMessage(lightAnimations?'Облегчённые анимации включены':'Полные анимации включены');\n    });\n  }\n  installMotionSetting();\n  requestAnimationFrame(()=>requestAnimationFrame(intro));\n})();");
  }
  if(!fxCss.includes('.motion-preference{'))fxCss+="\n/* Motion preference, normal effects ignore system reduced motion. */\n.motion-preference{display:flex;align-items:center;gap:13px;position:relative;cursor:pointer;margin:16px 0 14px;padding:14px 12px;border-radius:17px;border:1px solid #7771e077;background:linear-gradient(120deg,#252b5180,#131b32 88%);box-shadow:inset 0 1px #ffffff24,0 6px 24px #080c2a70;text-align:left}\n.motion-preference-icon{display:grid;place-items:center;width:38px;height:38px;flex:0 0 38px;color:#e6dcff;border-radius:12px;background:linear-gradient(145deg,#6955f1,#332870);box-shadow:0 5px 18px #7354f448;font-size:19px}\n.motion-preference-copy{display:flex;flex:1;min-width:0;flex-direction:column;gap:3px}\n.motion-preference-copy strong{font-size:13px;font-weight:700;color:#f4f3ff}\n.motion-preference-copy small{font-size:11px;line-height:1.45;color:#a6b1d2}\n.motion-preference input{position:absolute;opacity:0;width:1px;height:1px}\n.motion-switch-track{width:46px;height:28px;border-radius:99px;border:1px solid #6b6c91;background:linear-gradient(150deg,#30395a,#1b233f);display:flex;align-items:center;padding:3px;flex:none;box-shadow:inset 0 2px 6px #090e2380;transition:background .24s ease,border-color .24s ease}\n.motion-switch-track>span{width:20px;height:20px;border-radius:50%;background:linear-gradient(150deg,#ebefff,#b9bed6);box-shadow:0 2px 7px #040819a0;transition:transform .3s cubic-bezier(.18,.9,.2,1)}\n.motion-preference input:checked+.motion-switch-track{background:linear-gradient(125deg,#7158f5,#3f39be);border-color:#b3a4ff}\n.motion-preference input:checked+.motion-switch-track>span{transform:translateX(17px);background:white}\n.motion-preference:focus-within{outline:2px solid #bbaaff;outline-offset:3px}\nhtml[data-motion-mode=\"light\"] .hero-phones,html[data-motion-mode=\"light\"] .hero-glow,html[data-motion-mode=\"light\"] .connection-indicator.live i,html[data-motion-mode=\"light\"] .motion-nav-glider{animation:none!important}\nhtml[data-motion-mode=\"light\"] .motion-wave{opacity:.2!important}\n";
  html=html.replace(/\/styles\.css\?v=\d+/g,'/styles.css?v=8').replace(/\/finishing\.css\?v=\d+/g,'/finishing.css?v=3').replace(/\/finishing\.js\?v=\d+/g,'/finishing.js?v=3');
  if(!js.includes('phonedrop:light-animations')||!html.includes('finishing.js?v=3'))throw new Error('Incomplete PhoneDrop motion patch');
  for(const [name,content] of [['styles.css',styles],['finishing.css',fxCss],['finishing.js',js],['index.html',html]]){
    fs.writeFileSync(path.join(target,name),content);
    fs.writeFileSync(path.join(root,'public',name),content);
  }
  const out=path.join(os.tmpdir(),'phonedrop-final-'+process.pid+'.tar');
  const entries=fs.readdirSync(work);
  try{
    execFileSync('tar',['-cf',out,'-C',work,...entries]);
    const packed=zlib.brotliCompressSync(fs.readFileSync(out),{params:{[zlib.constants.BROTLI_PARAM_QUALITY]:9}});
    const next=packed.toString('base64');
    fs.writeFileSync(bundle,next+'\n');
    console.log('Repacked PhoneDrop: '+next.length+' base64 characters, 2 overlay assets, images retained');
  }finally{fs.rmSync(out,{force:true});}
}finally{fs.rmSync(work,{recursive:true,force:true});}
