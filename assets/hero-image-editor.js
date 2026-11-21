(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const endpoint = () => typeof GOOGLE_SCRIPT_URL === 'string' ? GOOGLE_SCRIPT_URL : '';
  const state = { file:null, objectUrl:'', originalSrc:'', saving:false };

  function authorized() {
    try { return typeof hasDualAdminAuthorization === 'function' && hasDualAdminAuthorization() === true; }
    catch (_) { return false; }
  }
  function status(message, error) {
    const el=$('heroImageEditorStatus');
    if(el){el.textContent=message||'';el.dataset.error=error?'true':'false';}
  }
  function cancelSelection() {
    if(state.objectUrl) URL.revokeObjectURL(state.objectUrl);
    state.objectUrl=''; state.file=null;
    const img=$('schoolEntranceImage');
    if(img && state.originalSrc) img.src=state.originalSrc;
  }
  function refreshAuthorization() {
    const ok=authorized(), trigger=$('heroImageEditTrigger'), editor=$('heroImageEditor');
    if(trigger) trigger.hidden=!ok;
    if(!ok && editor){editor.hidden=true;cancelSelection();}
  }
  window.refreshHeroImageEditorAuthorization=refreshAuthorization;

  function chooseFile(file) {
    if(!file)return;
    if(!['image/jpeg','image/png','image/webp'].includes(file.type)){
      status('اختر صورة JPG أو PNG أو WebP.',true);return;
    }
    if(file.size>15*1024*1024){status('حجم الصورة يجب ألا يتجاوز 15 ميجابايت.',true);return;}
    cancelSelection();
    state.file=file;state.objectUrl=URL.createObjectURL(file);
    const img=$('schoolEntranceImage');
    img.onload=()=>{
      const low=img.naturalWidth<1000||img.naturalHeight<1200;
      status(low?'الصورة جاهزة، لكن دقتها أقل من الموصى بها (1000×1200).':'الصورة جاهزة. ستظهر كاملة داخل إطار المدخل على الكمبيوتر والموبايل.',false);
    };
    img.onerror=()=>status('تعذر فتح الصورة المختارة.',true);
    img.src=state.objectUrl;
  }
  function loadImage(file) {
    return new Promise((resolve,reject)=>{
      const im=new Image(),url=URL.createObjectURL(file);
      im.onload=()=>{URL.revokeObjectURL(url);resolve(im);};
      im.onerror=()=>{URL.revokeObjectURL(url);reject(new Error('تعذرت قراءة الصورة.'));};
      im.src=url;
    });
  }
  function toBlob(canvas) {
    return new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('تعذر تجهيز الصورة.')),'image/jpeg',.9));
  }
  async function prepareImage() {
    const src=await loadImage(state.file),w=1200,h=1440,c=document.createElement('canvas');
    c.width=w;c.height=h;
    const ctx=c.getContext('2d',{alpha:false});
    if(!ctx)throw new Error('تعذر تجهيز الصورة النهائية.');
    ctx.fillStyle='#071b43';ctx.fillRect(0,0,w,h);
    // ملاءمة كاملة داخل 5:6 دون قص أو تحريك يدوي.
    const scale=Math.min(w/src.naturalWidth,h/src.naturalHeight);
    const dw=src.naturalWidth*scale,dh=src.naturalHeight*scale;
    ctx.drawImage(src,(w-dw)/2,(h-dh)/2,dw,dh);
    let blob=await toBlob(c);
    if(blob.size>4*1024*1024)throw new Error('الصورة أكبر من 4 ميجابايت بعد التجهيز. اختر صورة أصغر.');
    return blob;
  }
  function base64(blob) {
    return new Promise((resolve,reject)=>{
      const r=new FileReader();
      r.onload=()=>resolve(String(r.result).split(',')[1]||'');
      r.onerror=()=>reject(new Error('تعذر قراءة الصورة المجهزة.'));
      r.readAsDataURL(blob);
    });
  }
  function post(fields) {
    return new Promise((resolve,reject)=>{
      if(!endpoint()){reject(new Error('رابط خادم الموقع غير متاح.'));return;}
      const nonce='hero-'+Date.now()+'-'+Math.random().toString(36).slice(2);
      const frame=document.createElement('iframe'),form=document.createElement('form');
      const target='heroFrame_'+nonce.replace(/[^a-zA-Z0-9_]/g,'');
      frame.name=target;frame.hidden=true;form.method='POST';form.action=endpoint();form.target=target;form.hidden=true;
      const config={version:1,aspectRatio:'5:6',profiles:{
        desktop:{zoom:1,x:0,y:0,brightness:100},
        mobile:{zoom:1,x:0,y:0,brightness:100}
      }};
      const payload=Object.assign({
        action:'saveHeroImage',environment:'PRODUCTION',nonce,
        token:typeof googleUploadToken!=='undefined'?googleUploadToken:'',
        adminSessionToken:window.adminSessionToken||'',origin:location.origin,
        displayConfig:JSON.stringify(config)
      },fields);
      Object.entries(payload).forEach(([k,v])=>{
        const input=document.createElement('input');input.type='hidden';input.name=k;input.value=String(v==null?'':v);form.appendChild(input);
      });
      let done=false;
      const cleanup=()=>{removeEventListener('message',onMessage);clearTimeout(timer);form.remove();frame.remove();};
      const finish=(fn,value)=>{if(done)return;done=true;cleanup();fn(value);};
      const onMessage=e=>{
        if(typeof isTrustedAppsScriptMessage!=='function'||!isTrustedAppsScriptMessage(e,frame.contentWindow))return;
        const m=e.data;
        if(!m||m.type!=='heroImageSaveResult'||m.nonce!==nonce)return;
        m.result&&m.result.success?finish(resolve,m.result):finish(reject,new Error(m.result&&m.result.message||'لم يتم حفظ الصورة.'));
      };
      const timer=setTimeout(()=>finish(reject,new Error('لم يصل تأكيد الحفظ من الخادم.')),90000);
      addEventListener('message',onMessage);document.body.append(frame,form);form.submit();
    });
  }
  function loadSavedImage() {
    if(!endpoint())return;
    const callback='heroImageCallback_'+Date.now()+'_'+Math.random().toString(36).slice(2);
    let settled=false;const script=document.createElement('script');
    const cleanup=()=>{script.remove();try{delete window[callback];}catch(_){window[callback]=undefined;}};
    const timer=setTimeout(()=>{if(settled)return;settled=true;cleanup();console.warn('تعذر تحميل صورة المدخل المحفوظة.');},15000);
    window[callback]=data=>{
      if(settled)return;settled=true;clearTimeout(timer);cleanup();
      if(data&&data.success&&data.image){state.originalSrc=data.image;$('schoolEntranceImage').src=data.image;}
    };
    script.src=endpoint()+'?action=heroImageConfig&environment=PRODUCTION&callback='+encodeURIComponent(callback)+'&_='+Date.now();
    script.onerror=()=>{if(settled)return;settled=true;clearTimeout(timer);cleanup();};
    document.head.appendChild(script);
  }
  async function save() {
    if(state.saving)return;
    if(!authorized()){status('يلزم تحقق الإدارة بكلمة المرور وحساب Google المعتمد.',true);refreshAuthorization();return;}
    if(!state.file){status('اختر صورة جديدة أولًا.',true);return;}
    state.saving=true;$('heroImageSave').disabled=true;status('جارٍ تجهيز الصورة وحفظها...');
    try{
      const blob=await prepareImage(),data=await base64(blob);
      const result=await post({fileName:'school-entrance-'+Date.now()+'.jpg',mimeType:'image/jpeg',data});
      if(result.image){state.originalSrc=result.image;$('schoolEntranceImage').src=result.image;}
      if(state.objectUrl)URL.revokeObjectURL(state.objectUrl);
      state.objectUrl='';state.file=null;$('heroImageEditor').hidden=true;
      status(result.message||'تم استبدال صورة المدخل بنجاح.',false);
    }catch(e){status(e.message||'تعذر حفظ صورة المدخل.',true);}
    finally{state.saving=false;$('heroImageSave').disabled=false;}
  }
  function open() {
    if(!authorized()){status('يلزم تسجيل الدخول بكلمة مرور المسؤول والتحقق بحساب Google المعتمد.',true);return;}
    $('heroImageEditor').hidden=false;
    status('اختر صورة جديدة ثم اضغط حفظ واعتماد. لن تتغير الصورة الحالية إلا بعد نجاح الحفظ.');
  }
  function init() {
    if(!$('schoolEntranceStage'))return;
    state.originalSrc=$('schoolEntranceImage').src;
    $('heroImageEditTrigger').addEventListener('click',open);
    $('heroImageChooseButton').addEventListener('click',()=>$('heroImageFileInput').click());
    $('heroImageFileInput').addEventListener('change',e=>{chooseFile(e.target.files&&e.target.files[0]);e.target.value='';});
    $('heroImageCancelSelection').addEventListener('click',()=>{cancelSelection();status('تم إلغاء الصورة المختارة. الصورة الحالية لم تتغير.');});
    $('heroImageClose').addEventListener('click',()=>{cancelSelection();$('heroImageEditor').hidden=true;});
    $('heroImageSave').addEventListener('click',save);
    refreshAuthorization();loadSavedImage();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();