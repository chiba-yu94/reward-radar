import {date, expired, freshness, timestamp} from './domain.mjs';

const utc = value => new Date(value).toISOString().replace(/[-:]/g,'').replace('.000','');
const escaped = value => value.replace(/\\/g,'\\\\').replace(/\r\n|\r|\n/g,'\\n').replace(/[;,]/g,'\\$&');

function fold(line) {
  let result = '';
  let bytes = 0;
  for (const char of line) {
    const size = Buffer.byteLength(char);
    if (bytes + size > 75) {
      result += '\r\n ';
      bytes = 1;
    }
    result += char;
    bytes += size;
  }
  return result;
}

export function calendarEvent(row, {scope, lang, title, zone, detailUrl, now}) {
  const at = timestamp(row.deadline);
  const checked = timestamp(row.last_checked_at);
  if (!zone || !Number.isFinite(at) || expired(row,now) || freshness(row,now).state !== 'fresh') return null;
  const description = [date(row.deadline,lang,!row.deadline_date_only,zone) + ' (' + zone + ')'];
  let dates = ['DTSTART:' + utc(at)];
  if (row.deadline_date_only) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US',{
      timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',
    }).formatToParts(at).map(({type,value}) => [type,value]));
    const day = Date.UTC(+parts.year,+parts.month - 1,+parts.day);
    dates = ['DTSTART;VALUE=DATE:' + utc(day).slice(0,8),
      'DTEND;VALUE=DATE:' + utc(day + 86_400_000).slice(0,8)];
  } else if (zone !== 'Asia/Tokyo') {
    description.push(date(row.deadline,lang,true,'Asia/Tokyo') + ' (JST)');
  }
  description.push(detailUrl);
  return ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Freebie Trail//Application deadlines//EN',
    'BEGIN:VEVENT','UID:' + scope + '-' + row.id + '@freebietrail.com','DTSTAMP:' + utc(checked),
    ...dates,'TRANSP:TRANSPARENT','SUMMARY:' + escaped(title),'DESCRIPTION:' + escaped(description.join('\n')),
    'URL:' + detailUrl,'END:VEVENT','END:VCALENDAR',''].map(fold).join('\r\n');
}
