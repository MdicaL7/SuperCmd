import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'supercmd-capture-test-'));
const helper = path.join(directory, 'fake-ocr');
fs.writeFileSync(helper, 'test');
const mock = `
import {EventEmitter} from 'node:events';
import fs from 'node:fs';
export const __test={windows:[],handlers:new Map(),listeners:new Map(),calls:[],capture:'ok',permission:'granted',pendingOCR:null,ocrDeferred:false,copied:[],messages:[],save:null};
export const app={getPath:()=>${JSON.stringify(directory)}};
export class BrowserWindow extends EventEmitter {
 static getAllWindows(){return __test.windows;}
 constructor(options){super();this.options=options;this.webContents=new EventEmitter();this.webContents.id=__test.windows.length+1;this.dead=false;this.visible=false;this.size=[options.width,options.height];__test.windows.push(this);}
 isDestroyed(){return this.dead;} isVisible(){return this.visible;} hide(){this.visible=false;} show(){this.visible=true;} showInactive(){this.visible=true;}
 setAlwaysOnTop(value){this.top=value;} setVisibleOnAllWorkspaces(){} setAspectRatio(value){this.ratio=value;} getSize(){return this.size;} setSize(...size){this.size=size;}
 close(){if(!this.dead){this.dead=true;this.visible=false;this.emit('closed');}} destroy(){this.close();}
}
export const ipcMain={handle:(k,f)=>__test.handlers.set(k,f),removeHandler:k=>__test.handlers.delete(k),on:(k,f)=>__test.listeners.set(k,f),removeAllListeners:k=>__test.listeners.delete(k)};
export const screen={getCursorScreenPoint:()=>({x:-500,y:10}),getDisplayNearestPoint:()=>({bounds:{x:-1920,y:0,width:1920,height:1080},workArea:{x:-1920,y:0,width:1920,height:1050}})};
const image={isEmpty:()=>false,getSize:()=>({width:1200,height:800}),resize:()=>image,toDataURL:()=> 'data:image/png;base64,dGVzdA==',toPNG:()=>Buffer.from('PNG')};
export const nativeImage={createFromPath:()=>image};
export const clipboard={readImage:()=>image,writeImage:img=>__test.copied.push(img)};
export const dialog={showMessageBox:async message=>__test.messages.push(message),showSaveDialog:async()=>__test.save||({canceled:true})};
export const systemPreferences={getMediaAccessStatus:()=>__test.permission};
export function execFile(binary,args,options,callback){
 __test.calls.push({binary,args});
 if(binary.endsWith('screencapture')){
   if(__test.capture==='ok')fs.writeFileSync(args.at(-1),'PNG');
   callback(__test.capture==='error'?Object.assign(new Error('capture failed'),{code:2}):null,'',__test.capture==='error'?'capture failed':'');
 }else if(__test.ocrDeferred){__test.pendingOCR=()=>callback(null,JSON.stringify({status:'ok',text:'late words'}),'');}
 else callback(null,JSON.stringify({status:'ok',text:'OCR words'}),'');
}
`;
const result = await build({
  stdin: { contents: "export {createScreenshotFeature} from './src/main/screenshot-service'; export {ScreenshotStore} from './src/main/screenshot-store'; export {__test} from 'electron';", resolveDir: root, loader: 'ts' },
  bundle: true, write: false, platform: 'node', format: 'esm', define: { __dirname: JSON.stringify(path.join(root, 'dist/main')) },
  plugins: [{ name: 'desktop-mocks', setup(build) {
    build.onResolve({filter:/^(electron|child_process|\.\/native-binary)$/},args=>({path:args.path==='./native-binary'?'native':'desktop',namespace:'mock'}));
    build.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:args.path==='native'?`export const getNativeBinaryPath=()=>${JSON.stringify(helper)};`:mock,loader:'js'}));
  }}],
});
const {createScreenshotFeature, ScreenshotStore, __test}=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
const wait=()=>new Promise(resolve=>setImmediate(resolve));
function harness(options={}) {
  Object.assign(__test,{windows:[],calls:[],capture:'ok',permission:'granted',pendingOCR:null,ocrDeferred:false,copied:[],messages:[],save:null});
  const translations=[];
  const feature=createScreenshotFeature({loadWindowUrl:win=>win.emit('ready-to-show'),prepareCapture(){},translate:input=>translations.push(input),...options});
  const invoke=(operation,window=__test.windows.at(-1))=>__test.handlers.get(`screenshot:${operation}`)({sender:window.webContents});
  return {feature,invoke,translations};
}
const captureFiles=()=>fs.readdirSync(directory).filter(n=>n.startsWith('supercmd-captures-')).flatMap(n=>fs.readdirSync(path.join(directory,n)).map(f=>path.join(directory,n,f)));

test('capture store retains until the last owner and never removes exports',()=>{
  const store=new ScreenshotStore(path.join(directory,'store'));
  const input=store.createPath();fs.writeFileSync(input,'PNG');
  const exported=path.join(directory,'export.png');fs.copyFileSync(input,exported);
  const item=store.add(input,{previewDataUrl:'data',width:12,height:8});
  assert.equal(store.retain(item.id),true);store.release(item.id);assert.equal(fs.existsSync(input),true);
  store.release(item.id);assert.equal(fs.existsSync(input),false);store.release(item.id);
  store.dispose();assert.equal(fs.existsSync(exported),true);
});

test('selection Escape returns cancelled, error remains error, next capture can proceed',async()=>{
  const h=harness();__test.capture='cancel';
  assert.equal((await h.feature.captureAndRecognize()).status,'cancelled');
  assert.equal(__test.windows.length,0);assert.deepEqual(captureFiles(),[]);
  __test.capture='error';assert.equal((await h.feature.captureAndRecognize()).status,'error');
  __test.capture='ok';const result=await h.feature.captureAndRecognize();assert.equal(result.status,'ok');
  assert.equal(result.text,'OCR words');h.feature.release(result.artifact.id);h.feature.dispose();
});

test('capture preparation failure resets busy and preserves explicit error',async()=>{
  let fail=true;const h=harness({prepareCapture(){if(fail)throw new Error('prepare failed');}});
  assert.deepEqual(await h.feature.captureAndRecognize(),{status:'error',message:'prepare failed'});
  fail=false;const result=await h.feature.captureAndRecognize();assert.equal(result.status,'ok');
  h.feature.release(result.artifact.id);h.feature.dispose();
});

test('fullscreen uses pointer display bounds and window mode requests native highlight selector',async()=>{
  const h=harness();await h.feature.executeCommand('system-screenshot-fullscreen');
  assert.ok(__test.calls[0].args.includes('-R-1920,0,1920,1080'));
  assert.equal(__test.windows[0].visible,true);
  await h.feature.executeCommand('system-screenshot-window');
  assert.deepEqual(__test.calls[1].args.slice(3,6),['-i','-w','-o']);h.feature.dispose();
});

test('pins have independent lifetime, stay on blur, preserve ratio and release final file',async()=>{
  const h=harness();await h.feature.executeCommand('system-screenshot-region');const preview=__test.windows[0];
  await h.invoke('pin',preview);await h.invoke('pin',preview);
  const [pin1,pin2]=__test.windows.slice(1);assert.equal(pin1.top,true);assert.equal(pin1.ratio,1.5);
  pin1.emit('blur');assert.equal(pin1.visible,true);
  preview.close();pin1.close();assert.equal(captureFiles().length,1);
  __test.listeners.get('screenshot:zoom')({sender:pin2.webContents},1.25);
  assert.ok(Math.abs(pin2.size[0]/(pin2.size[1]-58)-1.5)<0.01);
  pin2.close();assert.deepEqual(captureFiles(),[]);h.feature.dispose();
});

test('translation OCR uses original once and transfers one owned capture reference',async()=>{
  const h=harness();await h.feature.executeCommand('system-screenshot-region');
  const result=await h.invoke('translate');assert.equal(result.status,'ok');assert.equal(h.translations.length,1);
  assert.equal(__test.calls.filter(c=>c.binary.endsWith('screencapture')).length,1);
  __test.windows[0].close();assert.equal(captureFiles().length,1);
  h.feature.release(h.translations[0].captureId);assert.deepEqual(captureFiles(),[]);h.feature.dispose();
});

test('closing source during OCR prevents late translation and releases capture',async()=>{
  const h=harness();await h.feature.executeCommand('system-screenshot-region');__test.ocrDeferred=true;
  const result=h.invoke('translate');await wait();__test.windows[0].close();__test.pendingOCR();
  assert.equal((await result).status,'cancelled');assert.equal(h.translations.length,0);assert.deepEqual(captureFiles(),[]);h.feature.dispose();
});

test('save export survives close; unrelated renderer cannot use capture actions',async()=>{
  const h=harness();await h.feature.executeCommand('system-screenshot-region');
  const exported=path.join(directory,'saved.png');__test.save={canceled:false,filePath:exported};
  assert.equal((await h.invoke('save')).status,'ok');
  assert.equal((await __test.handlers.get('screenshot:copy')({sender:{id:999}})).status,'error');
  h.feature.dispose();assert.equal(fs.existsSync(exported),true);assert.equal(__test.handlers.size,0);
});

test('late preview readiness stays hidden during the next capture',async()=>{
  const h=harness({loadWindowUrl(){}});
  await h.feature.executeCommand('system-screenshot-region');
  const preview=__test.windows[0];assert.equal(preview.visible,false);
  const next=h.feature.captureAndRecognize();
  preview.emit('ready-to-show');assert.equal(preview.visible,false);
  const result=await next;
  assert.equal(preview.visible,true);assert.equal(result.status,'ok');
  h.feature.release(result.artifact.id);h.feature.dispose();
});

test.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
