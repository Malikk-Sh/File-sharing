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

  const target=path.join(work,'public');
  if(!fs.existsSync(path.join(target,'index.html')))throw new Error('Archive has no public/index.html');
  // Motion System 2.0: keep editable sources and deployed bundle in sync.
  const motionBytes=Buffer.from(fs.readFileSync(path.join(root,'public','motion-v2.br.b64'),'utf8').trim(),'base64');
  const motionSources=JSON.parse(zlib.brotliDecompressSync(motionBytes).toString('utf8'));
  for(const type of ['css','js']){
    let src=motionSources[type];
    // The orbit art is positioned at translateX(-50%); preserve that anchor
    // during staggered WAAPI entrances so the illustration never jumps sideways.
    if(type==='js'){
      src=src.replace(
        "      const anim = play(el,[{opacity:0,transform:'translate3d(0,22px,0)'},{opacity:1,transform:'translate3d(0,0,0)'}],{duration:550,delay:140+i*78,easing:ease});",
        "      const phones = selector === '.hero-phones';\\n      const start = phones ? 'translateX(-50%) translateY(22px)' : 'translate3d(0,22px,0)';\\n      const end = phones ? 'translateX(-50%) translateY(0)' : 'translate3d(0,0,0)';\\n      const anim = play(el,[{opacity:0,transform:start},{opacity:1,transform:end}],{duration:550,delay:140+i*78,easing:ease});".replaceAll('\\n','\n')
      );
      src=src.replace(
        "      play(node,[\\n        {opacity:isNav?.45:0,transform:`translate3d(0,${isNav?35:42}px,0) scale(.96)`,filter:isNav?'none':'blur(4px)'},\\n        {opacity:1,transform:'translate3d(0,-3px,0) scale(1.005)',filter:'blur(0px)',offset:.82},\\n        {opacity:1,transform:'translate3d(0,0,0) scale(1)',filter:'blur(0px)'}\\n      ],{duration:850,delay,easing:spring,fill:'none'});".replaceAll('\\n','\n'),
        "      const phones = selector === '.hero-phones';\\n      const t = (y,scale=1) => phones ? `translateX(-50%) translateY(${y}px) scale(${scale})` : `translate3d(0,${y}px,0) scale(${scale})`;\\n      play(node,[\\n        {opacity:isNav?.45:0,transform:t(isNav?35:42,.96),filter:isNav?'none':'blur(4px)'},\\n        {opacity:1,transform:t(-3,1.005),filter:'blur(0px)',offset:.82},\\n        {opacity:1,transform:t(0,1),filter:'blur(0px)'}\\n      ],{duration:850,delay,easing:spring,fill:'none'});".replaceAll('\\n','\n')
      );
    }
    if(!src || src.length < 1000)throw new Error('Invalid PhoneDrop motion '+type+' source');
    fs.writeFileSync(path.join(root,'public','finishing.'+type),src);
    fs.writeFileSync(path.join(target,'finishing.'+type),src);
  }
  const indexPath=path.join(target,'index.html');
  let html=fs.readFileSync(indexPath,'utf8');
  if(!html.includes('/finishing.css')){
    html=html.replace('</head>','  <link rel="stylesheet" href="/finishing.css?v=2">\n</head>');
  }
  if(!html.includes('/finishing.js')){
    html=html.replace('</head>','  <script defer src="/finishing.js?v=2"></script>\n</head>');
  }
  fs.writeFileSync(indexPath,html);
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
