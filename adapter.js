import {classify} from './core.js';
const ROOTS='.ui-datepicker, .datepicker, [role="grid"][aria-label*="Calendar"]';
export function visible(el) {
  if (!el || el.closest('[hidden],[aria-hidden="true"]')) return false;
  const view=el.ownerDocument.defaultView;
  if (!view?.getComputedStyle) return true;
  const style=view.getComputedStyle(el);
  return style.display!=='none' && style.visibility!=='hidden' && el.getClientRects().length>0;
}
export function findPost(doc) {
  return [...doc.querySelectorAll('select')].find(el=>{
    const labels=[...doc.querySelectorAll('label')].filter(l=>l.htmlFor===el.id || l.getAttribute('for')===el.id || l.contains(el));
    return /ofc\s*post/i.test([el.getAttribute('aria-label'),...labels.map(l=>l.textContent)].join(' '));
  });
}
export function readSnapshot(doc,url,{isVisible=visible,ready=doc.readyState==='complete'}={}) {
  const leaves=[...doc.querySelectorAll('body *')].filter(el=>!['SCRIPT','STYLE','NOSCRIPT','OPTION','SELECT'].includes(el.tagName)&&!el.children.length&&isVisible(el));
  const text=leaves.map(el=>el.textContent).join(' ');
  const post=findPost(doc);
  const opts=post?[...post.options]:[];
  const selected=opts[post?.selectedIndex] || opts.find(o=>o.selected);
  const location=selected && selected.value && !selected.disabled ? selected.textContent.trim() : '';
  const dates=[];
  for (const root of doc.querySelectorAll(ROOTS)) {
    if (!isVisible(root)) continue;
    for (const cell of root.querySelectorAll('td[data-year][data-month]')) {
      const a=cell.querySelector('a,button');
      if (!a || !isVisible(a) || cell.matches('.ui-datepicker-unselectable,.ui-state-disabled,[aria-disabled="true"]') || a.matches('[disabled],[aria-disabled="true"]')) continue;
      const day=a.textContent.trim();
      if (/^\d{1,2}$/.test(day)) dates.push(`${cell.dataset.year}-${String(Number(cell.dataset.month)+1).padStart(2,'0')}-${day.padStart(2,'0')}`);
    }
    for (const el of root.querySelectorAll('button[data-date],a[data-date],[role="gridcell"][data-date][aria-disabled="false"]')) {
      if (!isVisible(el) || el.closest('[disabled],[aria-disabled="true"],.disabled,.ui-state-disabled,.ui-datepicker-unselectable')) continue;
      dates.push(el.getAttribute('data-date'));
    }
  }
  const has=selector=>[...doc.querySelectorAll(selector)].some(isVisible);
  return {url,ready,location,portalErrorCode:doc.documentElement?.getAttribute('data-visa-watch-error')==='PSE0501'||(/\bPSE0501\b/.test(text)&&/Unable to load appointment available days/i.test(text))?'PSE0501':null,locations:opts.filter(o=>o.value&&!o.disabled&&!/select|choose/i.test(o.textContent)).map(o=>o.textContent.trim()),
    calendar:/Applicant Schedule OFC Appointment/i.test(text)&&/Calendar/i.test(text)&&!!post&&isVisible(post),
    text:/\bno\s+(?:slots|appointments)\s+available\b/i.test(text)?'No Slots Available':'',dates,
    blocked:/access denied|you (?:have been|are) blocked|too many requests|request blocked|error\s*(?:403|429)|temporarily blocked/i.test(text),
    challenge:has('iframe[src*="captcha"],iframe[title*="CAPTCHA"],iframe[title*="captcha"],#challenge-running') || /verify you are human|just a moment|checking your browser|performing security verification|verify (?:that )?you are not a robot|complete the captcha/i.test(text),
    login:has('input[type="password"]')||/session (?:has )?expired|please (?:log|sign) in/i.test(text),
    error:/service unavailable|something went wrong|error loading|failed to load|unable to (?:load|retrieve)|an error (?:has )?occurred|bad gateway|gateway timeout/i.test(text),
    loading:has('[aria-busy="true"],[role="progressbar"],.loading:not([hidden]),.spinner:not([hidden])')||leaves.some(el=>/^(?:loading\b|please wait\b)/i.test(el.textContent.trim()))};
}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export function freshResultMutation(record,post) {
  if(post===record.target||post?.contains(record.target)||record.type==='attributes')return false;
  const empty=n=>n?.nodeType===1&&!n.children.length&&/^\s*no\s+(?:slots|appointments)\s+available[.!\s]*$/i.test(n.textContent||'');
  const resultNode=n=>n?.nodeType===1&&(n.matches(ROOTS)||empty(n)||[...n.querySelectorAll('*')].some(empty));
  if(record.type==='characterData'){
    const parent=record.target.parentElement;
    return empty(parent)||!!(parent?.closest('td[data-month][data-year],button[data-date],a[data-date]')&&parent.closest(ROOTS));
  }
  // Removals, container attributes and unrelated children never establish a new result.
  return [...record.addedNodes].some(n=>resultNode(n)||(record.target.closest?.(ROOTS)&&n.nodeType===1&&n.matches('td[data-month][data-year],button[data-date],a[data-date]')));
}
export async function inspectPage(request={}) {
  const read=()=>readSnapshot(document,location.href);
  let s=read();
  if (request.mode==='inventory') return {...classify(s),locations:s.locations,coverage:'Rendered calendar only; no date or time selected.'};
  const terminal=s=>['blocked','challenge','login','error'].includes(classify(s).status);
  if (terminal(s)) return classify(s);
  if (request.location && s.location!==request.location) {
    const post=findPost(document);
    const opt=post&&[...post.options].find(o=>o.textContent.trim()===request.location&&!o.disabled);
    if (!opt) return {status:'unknown',reason:'Requested OFC location is no longer present.',dates:[],location:s.location,at:Date.now()};
    let fresh=false;
    const observer=new MutationObserver(records=>{
      if(records.some(r=>freshResultMutation(r,post)))fresh=true;
    });
    if(request.generation!==undefined){
      const {watch}=await chrome.storage.local.get('watch');
      if(!watch?.enabled||watch.generation!==request.generation){observer.disconnect();return {status:'unknown',reason:'Monitoring paused; no location change performed.',dates:[],location:s.location};}
    }
    observer.observe(document.body,{subtree:true,childList:true,characterData:true});
    post.value=opt.value; post.dispatchEvent(new Event('change',{bubbles:true}));
    const deadline=Date.now()+12000;
    let stable='',since=Date.now();
    try {
      while(Date.now()<deadline) {
        await sleep(350); s=read();
        if (terminal(s)) return classify(s);
        const key=JSON.stringify([s.location,s.text,s.dates,s.loading]);
        if (key!==stable) {stable=key;since=Date.now();}
        if (fresh&&s.location===request.location&&!s.loading&&Date.now()-since>=1000) return {...classify(s),fresh:true,...(request.mode==='recovery'?{locations:s.locations}:{})};
      }
    } finally {observer.disconnect();}
    return {status:'unknown',reason:'Location changed, but fresh calendar results could not be verified.',code:'CALENDAR_FRESHNESS_TIMEOUT',dates:[],location:s.location,at:Date.now()};
  }
  let previous='',stableSince=Date.now();
  const deadline=Date.now()+12000;
  while(Date.now()<deadline) {
    s=read(); if (terminal(s)) return classify(s);
    const key=JSON.stringify([s.location,s.text,s.dates,s.loading,s.ready]);
    if(key!==previous){previous=key;stableSince=Date.now();}
    if(s.ready&&!s.loading&&Date.now()-stableSince>=1000) return {...classify(s),...(request.mode==='recovery'?{locations:s.locations}:{})};
    await sleep(350);
  }
  return {...classify({...s,loading:true}),code:'CALENDAR_TIMEOUT'};
}
