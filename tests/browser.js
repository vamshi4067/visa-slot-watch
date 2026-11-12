import {readSnapshot,inspectPage} from '../adapter.js';
import {classify} from '../core.js';
const url='https://www.usvisascheduling.com/en-US/ofc-schedule/';
const results=[],out=document.getElementById('results'),post=document.getElementById('post'),region=document.getElementById('result');
const check=(name,value)=>{results.push(`${value?'PASS':'FAIL'} · ${name}`);out.textContent=results.join('\n');if(!value)throw Error(name);};
try{
  check('Visible native OFC control and explicit empty state',classify(readSnapshot(document,url,{ready:true})).status==='empty');
  region.innerHTML='<div class="ui-datepicker"><table><tr><td data-month="1" data-year="2027"><a href="#">3</a></td><td class="ui-datepicker-unselectable" data-month="1" data-year="2027"><span>4</span></td></tr></table></div>';
  const s=readSnapshot(document,url,{ready:true});check('Enabled date extracted; disabled date excluded',s.dates.join(',')==='2027-02-03');
  check('Available classification',classify(s).status==='available');
  region.innerHTML='<p>No Slots Available</p>';post.value='hyd';
  post.addEventListener('change',()=>{document.body.classList.toggle('unrelated');setTimeout(()=>{region.innerHTML='<p>No Slots Available</p>';},2500);},{once:true});
  // Use the fixture's real URL: result is intentionally unknown, but freshness must wait for replacement.
  const start=Date.now(),result=await inspectPage({location:'MUMBAI VAC'});
  check('Location change waits for result replacement, not unrelated body mutation',result.fresh===true&&Date.now()-start>=2500);
  check('Wrong origin cannot become a live availability result',result.status==='unknown');
  results.push('All browser fixture checks passed. No booking control was activated.');out.textContent=results.join('\n');
}catch(error){out.textContent=results.join('\n')+'\nFAIL · '+error.message;}
