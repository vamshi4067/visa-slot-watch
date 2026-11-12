export function isCalendarURL(value) {
  try { const u = new URL(value); return u.protocol === 'https:' && ['www.usvisascheduling.com','usvisascheduling.com'].includes(u.hostname) && /^\/en-US\/ofc-schedule\/?$/i.test(u.pathname); } catch { return false; }
}
export function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
}
export function classify(s) {
  const result = (status, reason, dates=[]) => ({status,reason,dates,location:s.location || '',at:Date.now()});
  if (s.blocked) return result('blocked','Access blocked. Monitoring stopped; review the page manually.');
  if (s.challenge) return result('challenge','Complete the verification or CAPTCHA manually.');
  if (s.login) return result('login','Sign in manually, then resume.');
  if (s.portalErrorCode==='PSE0501') return {...result('error','PSE0501: Unable to load appointment available days.'),code:'PSE0501'};
  if (s.error) return {...result('error','The page reports a calendar loading error.'),code:'CALENDAR_LOAD_ERROR'};
  if (!isCalendarURL(s.url)) {
    let host; try { host = new URL(s.url).hostname; } catch {}
    return result(['www.usvisascheduling.com','usvisascheduling.com'].includes(host)?'login':'unknown','Calendar page is not open.');
  }
  if (!s.ready || s.loading) return result('loading','Calendar is still loading.');
  if (!s.calendar || !s.location) return {...result('unknown','Calendar or OFC Post could not be identified.'),code:'CALENDAR_UNREADABLE'};
  const dates=[...new Set((s.dates||[]).filter(validDate))].sort();
  const empty=/\bno\s+(?:slots|appointments)\s+available\b/i.test(s.text||'');
  if (empty && dates.length) return result('unknown','Conflicting availability markers; inspect manually.');
  if (dates.length) return result('available','Enabled dates observed in the rendered calendar.',dates);
  if (empty) return result('empty','No Slots Available for this location.');
  return {...result('unknown','No explicit empty message or recognized enabled dates.'),code:'CALENDAR_UNREADABLE'};
}
export function sweepLocations(locations,all) {
  const unique=[...new Set(locations.map(x=>x.trim()).filter(Boolean))];
  const hyd=unique.find(x=>/hyderabad/i.test(x));
  if(!all)return hyd?[hyd]:[];
  return hyd?[hyd,...unique.filter(x=>x!==hyd)]:unique;
}
export function newDates(previous,current) {return [...new Set(current)].filter(d=>!previous.includes(d)).sort();}
