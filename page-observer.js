import {isCalendarURL} from './core.js';
function pageCategory(tab){
  try{if(new URL(tab.pendingUrl||tab.url).hostname==='atlasauth.b2clogin.com')return 'sign_in';}catch{}
  if(tab.status==='loading'||tab.pendingUrl)return 'loading';
  const value=tab.url||'';
  if(!value||value==='about:blank')return 'blank';
  if(value.startsWith('chrome-error:'))return 'browser_error';
  if(isCalendarURL(value))return 'calendar';
  try{
    const u=new URL(value);
    if(u.protocol==='https:'&&u.hostname==='atlasauth.b2clogin.com')return 'sign_in';
    if(u.protocol==='https:'&&['www.usvisascheduling.com','usvisascheduling.com'].includes(u.hostname)){
      if(/\/cdn-cgi\//.test(u.pathname))return 'verification';
      if(/\/(?:sign[-_]?in|login|account\/login)(?:\/|$)/i.test(u.pathname))return 'sign_in';
      return 'other_visa_page';
    }
  }catch{}
  return 'other_page';
}
const failureCodes={loading:'PAGE_LOADING',blank:'PAGE_BLANK',browser_error:'PAGE_LOAD_ERROR'};
const pageFailure={
  loading:['loading','Page navigation is still loading. Monitoring paused without retrying.'],
  blank:['error','The calendar tab is blank. This does not establish a logout. Open the tab and inspect it manually.'],
  browser_error:['error','The browser reports a page-load error. Monitoring paused without retrying.'],
  sign_in:['login','The calendar redirected to sign-in. Sign in manually, then resume.'],
  verification:['challenge','The page requires verification. Complete it manually before resuming.'],
  other_visa_page:['unknown','The tab left the OFC calendar. Review the page manually before resuming.'],
  other_page:['unknown','The attached tab is no longer on the supported visa calendar. Review it manually.'],
};
export function createCalendarObserver(io){
  return async(tabId,location,{generation,freshDocumentId})=>{
    const now=io.now||Date.now;
    const record=async(stage,page,status)=>{try{await io.record?.({stage,page,status,at:now()});}catch{/* Diagnostics must not break monitoring. */}};
    const checkPage=async stage=>{
      const page=pageCategory(await io.tab(tabId));await record(stage,page,page==='calendar'?'ready':pageFailure[page][0]);
      if(page==='calendar')return null;
      const [status,reason]=pageFailure[page];return {status,reason,...(failureCodes[page]?{code:failureCodes[page]}:{}),dates:[],location:'',at:now()};
    };
    await io.guard(tabId,generation);
    const initial=await checkPage('before_check');if(initial)return initial;
    let before=await io.inventory(tabId);
    if(before.status==='loading')before=await io.inspect(tabId,{generation});
    await record('inventory','calendar',before.status);
    if(!['empty','available'].includes(before.status))return before;
    await io.guard(tabId,generation);
    const needsReload=before.location===location&&(!freshDocumentId||before.documentId!==freshDocumentId);
    if(needsReload){
      await record('before_reload','calendar','loading');
      try{await io.reload(tabId);}catch{
        await io.guard(tabId,generation);
        const page=await checkPage('reload_failed');if(page)return page;
        return {status:'error',code:'CALENDAR_RELOAD_TIMEOUT',reason:'The calendar reload did not finish. Monitoring paused; no retry was attempted.',dates:[],location,at:now()};
      }
    }
    await io.guard(tabId,generation);
    const navigation=await checkPage(needsReload?'after_reload':'before_location_change');if(navigation)return navigation;
    let result;
    try{result=await io.inspect(tabId,{location,generation});}catch{
      await io.guard(tabId,generation);
      const moved=await checkPage('inspection_failed');if(moved)return moved;
      await record('inspection_failed','calendar','error');
      return {status:'error',reason:'The calendar document could not be inspected. Open the tab to check for a page-load error or verification request.',dates:[],location,at:now()};
    }
    await io.guard(tabId,generation);
    await record('observe_result','calendar',result.status);
    if(['unknown','loading','error'].includes(result.status)){
      result={...result,reason:`${needsReload?'After calendar reload':'After location check'}: ${result.reason||'No readable calendar result.'}`};
    }
    return result;
  };
}
