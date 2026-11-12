import {isCalendarURL} from './core.js';
const codes=new Set(['PSE0501','CALENDAR_LOAD_ERROR','CALENDAR_TIMEOUT','CALENDAR_FRESHNESS_TIMEOUT','CALENDAR_UNREADABLE','PAGE_BLANK','PAGE_LOAD_ERROR','PAGE_LOADING','CALENDAR_RELOAD_TIMEOUT']);
export function canRecover(result){return ['error','unknown','loading'].includes(result?.status)&&codes.has(result?.code);}
export function calendarBase(value){if(!isCalendarURL(value))return null;return new URL('/en-US/ofc-schedule/',value).href;}
export function blankCalendar(value){return !value||value==='about:blank'||value.startsWith('chrome-error:');}
