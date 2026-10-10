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
  fs.copyFileSync(path.join(root,'public','finishing.css'),path.join(target,'finishing.css'));
  fs.copyFileSync(path.join(root,'public','finishing.js'),path.join(target,'finishing.js'));
  const indexPath=path.join(target,'index.html');
  let html=fs.readFileSync(indexPath,'utf8');
  if(!html.includes('/finishing.css')){
    html=html.replace('</head>','  <link rel="stylesheet" href="/finishing.css?v=1">\n</head>');
  }
  if(!html.includes('/finishing.js')){
    html=html.replace('</head>','  <script defer src="/finishing.js?v=1"></script>\n</head>');
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
