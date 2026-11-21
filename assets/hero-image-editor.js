(() => {
'use strict';
const $ = id => document.getElementById(id);
const endpoint = () => typeof GOOGLE_SCRIPT_URL === 'string' ? GOOGLE_SCRIPT_URL : '';
const defaultProfile = () => ({ zoom:1, x:0, y:0, brightness:100 });
const state = {
  profile:'desktop', profiles:{desktop:defaultProfile(),mobile:defaultProfile()},
  selectedFile:null, objectUrl:'', originalSrc:'', savedImageUrl:'', dragging:false,
  pointerX:0, pointerY:0, saving:false, loaded:false
};
const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
function authorized(){try{return typeof hasDualAdminAuthorization==='function' && hasDualAdminAuthorization()===true;}catch(_){return false;}}
function status(message,error=false){const el=$('heroImageEditorStatus');if(el){el.textContent=message||'';el.dataset.error=error?'true':'false';}}
function profile(){return state.profiles[state.profile];}
function applyProfile(){
 const p=profile(),img=$('schoolEntranceImage');
 if(!img)return;
 img.style.transform='translate('+p.x+'%, '+p.y+'%) scale('+p.zoom+')';
 img.style.filter='brightness('+p.brightness+'%)';
 $('heroImageProfileLabel').textContent=state.profile==='desktop'?'إعداد الكمبيوتر':'إعداد الموبايل';
 $('heroImageZoom').value=String(p.zoom);$('heroImageX').value=String(p.x);
 $('heroImageY').value=String(p.y);$('heroImageBrightness').value=String(p.brightness);
}
function refreshAuthorization(){
 const ok=authorized(),trigger=$('heroImageEditTrigger'),editor=$('heroImageEditor');
 if(trigger)trigger.hidden=!ok;
 if(!ok&&editor){editor.hidden=true;$('schoolEntranceStage')?.classList.remove('hero-image-editing');cancelSelection();}
}
window.refreshHeroImageEditorAuthorization=refreshAuthorization;
function cancelSelection(){
 if(state.objectUrl)URL.revokeObjectURL(state.objectUrl);
 state.objectUrl='';state.selectedFile=null;
 const img=$('schoolEntranceImage');if(img&&state.originalSrc)img.src=state.originalSrc;
}
function chooseFile(file){
 if(!file)return;
 if(!['image/jpeg','image/png','image/webp'].includes(file.type)){status('اختر صورة JPG أو PNG أو WebP.',true);return;}
 if(file.size>15*1024*1024){status('حجم الصورة يجب ألا يتجاوز 15 ميجابايت.',true);return;}
 cancelSelection();state.objectUrl=URL.createObjectURL(file);state.selectedFile=file;
 const img=$('schoolEntranceImage');img.onload=()=>{
  applyProfile();
  status(img.naturalWidth<1000||img.naturalHeight<1200?'تنبيه: دقة الصورة أقل من الموصى بها (1000×1200). قد تظهر مبكسلة عند التكبير.':'اسحب الصورة داخل الإطار واضبط إعداد الكمبيوتر والموبايل كلًّا على حدة.');
 };
 img.src=state.objectUrl;
}
function setProfile(name){state.profile=name;applyProfile();status(name==='desktop'?'تضبط الآن عرض الكمبيوتر فقط.':'تضبط الآن عرض الموبايل فقط.');}
function resetProfile(){state.profiles[state.profile]=defaultProfile();applyProfile();status('تمت إعادة ضبط إعداد هذا الجهاز فقط.');}
function pointerDown(e){
 if($('heroImageEditor').hidden||!state.selectedFile)return;
 state.dragging=true;state.pointerX=e.clientX;state.pointerY=e.clientY;
 $('schoolEntranceStage').setPointerCapture?.(e.pointerId);e.preventDefault();
}
function pointerMove(e){
 if(!state.dragging)return;
 const r=$('schoolEntranceStage').getBoundingClientRect(),p=profile();
 p.x=clamp(p.x+(e.clientX-state.pointerX)/Math.max(1,r.width)*100,-100,100);
 p.y=clamp(p.y+(e.clientY-state.pointerY)/Math.max(1,r.height)*100,-100,100);
 state.pointerX=e.clientX;state.pointerY=e.clientY;applyProfile();e.preventDefault();
}
function pointerUp(){state.dragging=false;}
function loadImage(file){return new Promise((resolve,reject)=>{const im=new Image(),url=URL.createObjectURL(file);im.onload=()=>{URL.revokeObjectURL(url);resolve(im);};im.onerror=()=>{URL.revokeObjectURL(url);reject(new Error('تعذرت قراءة الصورة.'));};im.src=url;});}
function blobOf(canvas,q){return new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('تعذر تجهيز الصورة.')),'image/jpeg',q));}
async function prepareImage(){
 const src=await loadImage(state.selectedFile),w=1200,h=1440,c=document.createElement('canvas');c.width=w;c.height=h;
 const ctx=c.getContext('2d',{alpha:false});if(!ctx)throw new Error('تعذر تجهيز الصورة النهائية.');
 ctx.fillStyle='#071b43';ctx.fillRect(0,0,w,h);
 // صورة رئيسية واحدة بنسبة 5:6؛ إعدادات الموضع والتكبير منفصلة للعرض فقط.
 const scale=Math.max(w/src.naturalWidth,h/src.naturalHeight);
 const dw=src.naturalWidth*scale,dh=src.naturalHeight*scale;
 ctx.drawImage(src,(w-dw)/2,(h-dh)/2,dw,dh);
 let b=await blobOf(c,.9);if(b.size>3.8*1024*1024)b=await blobOf(c,.78);
 if(b.size>4*1024*1024)throw new Error('الصورة الناتجة أكبر من 4 ميجابايت. اختر صورة أصغر.');
 return b;
}
function toBase64(blob){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]||'');r.onerror=()=>reject(new Error('تعذر قراءة الصورة الناتجة.'));r.readAsDataURL(blob);});}
function post(fields){
 return new Promise((resolve,reject)=>{
  if(!endpoint())return reject(new Error('رابط خادم الموقع غير متاح.'));
  const nonce='hero-'+Date.now()+'-'+Math.random().toString(36).slice(2),frame=document.createElement('iframe'),form=document.createElement('form');
  const target='heroFrame_'+nonce.replace(/[^a-zA-Z0-9_]/g,'');frame.name=target;frame.hidden=true;
  form.method='POST';form.action=endpoint();form.target=target;form.hidden=true;
  const payload=Object.assign({action:'saveHeroImage',environment:'PRODUCTION',nonce,token:typeof googleUploadToken!=='undefined'?googleUploadToken:'',adminSessionToken:window.adminSessionToken||'',origin:location.origin},fields);
  Object.entries(payload).forEach(([k,v])=>{const i=document.createElement('input');i.type='hidden';i.name=k;i.value=String(v??'');form.appendChild(i);});
  let done=false;const clean=()=>{removeEventListener('message',onMessage);clearTimeout(timer);form.remove();frame.remove();};
  const finish=(fn,v)=>{if(done)return;done=true;clean();fn(v);};
  const onMessage=e=>{if(typeof isTrustedAppsScriptMessage!=='function'||!isTrustedAppsScriptMessage(e))return;const m=e.data;if(!m||m.type!=='heroImageSaveResult'||m.nonce!==nonce)return;m.result?.success?finish(resolve,m.result):finish(reject,new Error(m.result?.message||'لم يتم حفظ صورة المدخل.'));};
  const timer=setTimeout(()=>finish(reject,new Error('لم يصل تأكيد الحفظ من الخادم.')),90000);
  addEventListener('message',onMessage);document.body.append(frame,form);form.submit();
 });
}
function loadSavedConfig(){
 if(!endpoint())return;
 window.heroImageConfigCallback=data=>{
  if(!data||!data.success)return;
  const cfg=data.displayConfig||data.config||{};
  if(cfg.profiles){for(const k of ['desktop','mobile'])if(cfg.profiles[k])state.profiles[k]=Object.assign(defaultProfile(),cfg.profiles[k]);}
  if(data.image){state.originalSrc=data.image;$('schoolEntranceImage').src=data.image;}
  state.loaded=true;applyResponsiveProfile();
 };
 const s=document.createElement('script');s.src=endpoint()+'?action=heroImageConfig&environment=PRODUCTION&callback=heroImageConfigCallback&_='+Date.now();
 s.onerror=()=>console.warn('تعذر تحميل إعدادات صورة المدخل المحفوظة.');document.head.appendChild(s);
}
function applyResponsiveProfile(){
 // أثناء فتح المحرر نعرض الجهاز المختار للمعاينة، ولا نستبدله بمقاس نافذة المتصفح.
 const editor=$('heroImageEditor');
 if(editor&&!editor.hidden)return;
 const name=matchMedia('(max-width:640px)').matches?'mobile':'desktop';
 const p=state.profiles[name],img=$('schoolEntranceImage');
 if(img){img.style.transform='translate('+p.x+'%, '+p.y+'%) scale('+p.zoom+')';img.style.filter='brightness('+p.brightness+'%)';}
}
async function save(){
 if(state.saving)return;
 if(!authorized()){status('يلزم تحقق الإدارة بكلمة المرور وحساب Google المعتمد.',true);refreshAuthorization();return;}
 if(!state.selectedFile){status('اختر صورة جديدة أولًا.',true);return;}
 state.saving=true;$('heroImageSave').disabled=true;status('جارٍ تجهيز الصورة وحفظ إعدادات الجهازين...');
 try{
  const blob=await prepareImage(),data=await toBase64(blob);
  const result=await post({fileName:'school-entrance-'+Date.now()+'.jpg',mimeType:'image/jpeg',data,displayConfig:JSON.stringify({version:1,aspectRatio:'5:6',profiles:state.profiles})});
  if(result.image){state.savedImageUrl=result.image;state.originalSrc=result.image;$('schoolEntranceImage').src=result.image;}
  cancelSelection();$('heroImageEditor').hidden=true;$('schoolEntranceStage').classList.remove('hero-image-editing');
  status(result.message||'تم حفظ صورة المدخل وإعدادات الكمبيوتر والموبايل.',false);
 }catch(e){status(e.message||'تعذر حفظ صورة المدخل.',true);}
 finally{state.saving=false;$('heroImageSave').disabled=false;}
}
function open(){if(!authorized()){status('يلزم تسجيل الدخول بكلمة مرور المسؤول والتحقق بحساب Google المعتمد.',true);return;}$('heroImageEditor').hidden=false;$('schoolEntranceStage').classList.add('hero-image-editing');setProfile('desktop');status('اختر صورة جديدة ثم اضبط الكمبيوتر والموبايل كلًّا على حدة.');}
function init(){
 const stage=$('schoolEntranceStage');if(!stage)return;
 state.originalSrc=$('schoolEntranceImage').src;
 $('heroImageEditTrigger').addEventListener('click',open);
 $('heroImageChooseButton').addEventListener('click',()=>$('heroImageFileInput').click());
 $('heroImageFileInput').addEventListener('change',e=>{chooseFile(e.target.files?.[0]);e.target.value='';});
 $('heroPreviewDesktop').addEventListener('click',()=>setProfile('desktop'));
 $('heroPreviewMobile').addEventListener('click',()=>setProfile('mobile'));
 $('heroImageReset').addEventListener('click',resetProfile);
 $('heroImageClose').addEventListener('click',()=>{cancelSelection();$('heroImageEditor').hidden=true;stage.classList.remove('hero-image-editing');});
 $('heroImageCancelSelection').addEventListener('click',()=>{cancelSelection();applyProfile();status('تم إلغاء الصورة المختارة دون تغيير الصورة الحالية.');});
 for(const [id,key] of [['heroImageZoom','zoom'],['heroImageX','x'],['heroImageY','y'],['heroImageBrightness','brightness']])$(id).addEventListener('input',e=>{profile()[key]=Number(e.target.value);applyProfile();});
 $('heroImageSave').addEventListener('click',save);
 stage.addEventListener('pointerdown',pointerDown);stage.addEventListener('pointermove',pointerMove);
 ['pointerup','pointercancel','lostpointercapture'].forEach(n=>stage.addEventListener(n,pointerUp));
 refreshAuthorization();loadSavedConfig();
 // بدّل الإعدادات تلقائيًا عند تغيير عرض الشاشة، مع احترام وضع المعاينة داخل المحرر.
 const media=matchMedia('(max-width:640px)');
 if(typeof media.addEventListener==='function')media.addEventListener('change',applyResponsiveProfile);
 else if(typeof media.addListener==='function')media.addListener(applyResponsiveProfile);
 window.addEventListener('resize',applyResponsiveProfile,{passive:true});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();