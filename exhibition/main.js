import games from './games.json';
import { placeRankedPins } from './pin-layout.js';
import { exhibitionGames, rankedCompanions, rankedGames } from '../src/domain/exhibition/collection';
import { exhibitionErrorMessage, findExhibitionMembers, loadExhibitionView } from './data';

const pinAssets = import.meta.glob('./assets/pins/*.webp', { eager: true, query: '?url', import: 'default' });
const gameTieRanks = new Map(Object.keys(games).map(id => [id, Math.random()]));
const main = document.getElementById('main');
const footer = document.getElementById('collection-footer');
const objectDialog = document.getElementById('object-dialog');
const week = ['일', '월', '화', '수', '목', '금', '토'];
const esc = value => String(value).replace(/[&<>"']/g, char =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const icon = id => '<svg class="icon" aria-hidden="true" viewBox="0 0 24 24"><use href="#'+id+'"/></svg>';
const asset = id => pinAssets[`./assets/pins/${id}.webp`];
const dayOf = date => week[new Date(date + 'T12:00:00Z').getUTCDay()];
const dateText = date => {
  const [year, month, day] = date.split('-');
  return `${year}년 ${Number(month)}월 ${Number(day)}일 ${dayOf(date)}요일`;
};
const validProfileId = value => /^[a-f0-9]{64}$/.test(value);
const formPath = (id, date = '', companion = '', pin = '') =>
  '#' + [id, 'collection', ...(date ? [date] : []),
    ...(companion ? ['with', companion] : []), ...(pin ? ['pin', pin] : [])].map(encodeURIComponent).join('/');

let profile;
let current;
let baseKey = '';
let showLabels = true;
let objectTrigger;
let lastOpenPin = '';
let entryRequest = 0;

function intro(){
  const title="My Collection";
  const split=title.lastIndexOf(" ");
  return '<header class="exhibit-intro"><h1 class="exhibit-title" lang="en"><span class="title-name">'+esc(title.slice(0,split))+'</span> <span class="title-kind">'+esc(title.slice(split+1))+'</span></h1></header>';
}

function scatterPin(id) {
  const item=games[id];
  const art=item.pending?'<span class="pending-art" aria-hidden="true"><span>+</span><small>제작 예정</small></span>':'<img src="'+asset(id)+'" alt="" draggable="false" loading="lazy" decoding="async">';
  return '<button type="button" class="pin scatter-pin'+(item.pending?' pending-pin':'')+'" aria-label="'+esc(item.ko)+(item.pending?' · 핀 제작 예정':' 핀과 함께한 날 보기')+'" data-pin="'+id+'">'+art+'<span class="pin-label">'+esc(item.ko)+'</span></button>';
}
function showEntry(){
  document.title="Your Collection";
  main.innerHTML='<section class="entry"><h1 class="entry-title" lang="en"><span>Your</span> <span>Collection</span></h1><form id="name-form" class="name-form"><p class="entry-edition" lang="en">AVALON / VOL. 06</p><div class="name-input-row"><input id="member-name" name="name" type="text" autocomplete="off" maxlength="30" required aria-label="이름을 입력해 주세요" placeholder="이름을 입력해 주세요"><button type="submit" class="entry-submit" aria-label="컬렉션 열기"><svg aria-hidden="true" width="23" height="19" viewBox="0 0 29 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12H24m-6-6 6 6-6 6"/></svg></button></div><p id="entry-error" role="status"></p><div id="name-matches"></div></form></section>';
}

function readRoute() {
  const [id, view, ...parts] = location.hash.slice(1).split('/');
  if (!validProfileId(id) || view !== 'collection') return null;
  const companionAt = parts.indexOf('with');
  const pinAt = parts.indexOf('pin');
  return {
    id,
    date: /^\d{4}-\d{2}-\d{2}$/.test(parts[0]) ? parts[0] : '',
    companionId: companionAt >= 0 ? parts[companionAt + 1] : '',
    pin: pinAt >= 0 ? parts[pinAt + 1] : '',
  };
}

function makeState(route) {
  const days = profile.data.days;
  const allCompanions = new Map(days.flatMap(day => day.companions.map(person => [person.profileId, person])));
  const companion = allCompanions.get(route.companionId);
  const dates = companion
    ? days.filter(day => day.companions.some(person => person.profileId === companion.profileId))
    : days;
  const selectedDay = dates.find(day => day.date === route.date);
  const date = selectedDay?.date || '';
  const scopedDays = selectedDay ? [selectedDay] : days;
  const companions = rankedCompanions(scopedDays);
  const selected = exhibitionGames(profile.data, { date, companionId: companion?.profileId });
  const gameOrder = profile.gameOrder.filter(id => selected.has(id));
  const pin = selected.has(route.pin) && Object.hasOwn(games, route.pin) ? route.pin : '';
  return { id: route.id, date, dates, companions, companion, gameOrder, pin };
}

function archive(state) {
  const { id, date, dates, companions, companion } = state;
  if (!dates.length) return '';
  const companionId = companion?.profileId || '';
  const all = `<a class="archive-date all-dates" href="${formPath(id, '', companionId)}" ${date ? '' : 'aria-current="true"'}><span>전체</span></a>`;
  const datesHtml = dates.map(day => {
    const path = formPath(id, day.date, companionId);
    const active = day.date === date ? 'aria-current="date"' : '';
    return `<a class="archive-date" href="${path}" ${active} aria-label="${esc(dateText(day.date))}"><time datetime="${esc(day.date)}">${esc(day.date.slice(5).replace('-', '.'))}</time></a>`;
  }).join('');
  const people = companions.map(person => {
    const active = person.profileId === companionId ? 'aria-current="true"' : '';
    return `<li><a href="${formPath(id, '', person.profileId)}" ${active}>${esc(person.name)}</a></li>`;
  }).join('');
  const peopleLabel = date ? '같은 조에 있었던 사람' : '함께 플레이한 사람';
  const peopleClass = date ? 'archive-people archive-people-before-dates' : 'archive-people';
  const peopleSection = people
    ? `<div class="${peopleClass}"><span class="archive-people-label">${peopleLabel}</span><ul>${people}</ul></div>`
    : '';
  const datesSection = '<h2 class="archive-heading">함께한 날</h2>'+
    '<nav class="archive-dates" aria-label="모임 날짜">'+all+datesHtml+'</nav>';
  return '<section class="session-archive" aria-label="세션 기록">'+
    (date ? peopleSection+datesSection : datesSection+peopleSection)+'</section>';
}

function collection(state) {
  const ordered = state.gameOrder.filter(id => Object.hasOwn(games, id));
  const pins = ordered.map(scatterPin).join('');
  const companionHeading = state.companion
    ? `<div class="companion-filter">${esc(state.companion.name)}님과 함께한 게임<a class="text-control" href="${formPath(state.id, state.date)}">필터 해제</a></div>`
    : '';
  const empty = '<p class="blank">'+(state.companion ? '함께 플레이한 게임이 기록되어 있지 않습니다.' :
    state.date ? '이날 플레이한 게임은 기록되어 있지 않습니다.' : '플레이한 게임이 기록되어 있지 않습니다.')+'</p>';
  return intro()+companionHeading+
    `<section class="works scatter-field ranked-layout${showLabels ? '' : ' labels-off'}" aria-label="보드게임 컬렉션">${pins || empty}</section>`+
    '<div class="board-caption"><p class="caption-hint">'+icon('hand')+
    '<span>핀을 고르면 함께한 날의 기록이 열립니다.</span></p><button class="text-control label-toggle" type="button" aria-pressed="'+
    showLabels+'">이름표<span aria-hidden="true" class="label-switch"></span></button></div>'+archive(state);
}

let laidOutField;
let laidOutWidth;

function layoutPins() {
  const field = main.querySelector('.ranked-layout');
  if (!field) return;
  const width = field.clientWidth || 360;
  if (field === laidOutField && width === laidOutWidth) return;

  const pins = [...field.querySelectorAll('[data-pin]')];
  const { slots, height, labelWidth } = placeRankedPins(pins.map(pin => pin.dataset.pin), width);
  field.style.setProperty('--canvas-height', height + 'px');
  if (slots.length) field.style.setProperty('--pin-label-width', labelWidth + 'px');
  slots.forEach(({ size, rotation, radius, x, y }, index) => {
    const { style } = pins[index];
    style.setProperty('--size', size + 'px');
    style.setProperty('--r', rotation + 'deg');
    style.setProperty('--pin-radius', radius + 'px');
    style.setProperty('--pin-x', x + 'px');
    style.setProperty('--pin-y', y + 'px');
  });
  laidOutField = field;
  laidOutWidth = width;
}

if (typeof ResizeObserver === 'function') {
  new ResizeObserver(layoutPins).observe(main);
} else {
  window.addEventListener('resize', layoutPins);
}

function renderObject(state) {
  const item = games[state.pin];
  const companionId = state.companion?.profileId || '';
  const dates = exhibitionGames(profile.data, { companionId }).get(state.pin) || [];
  const links = dates.map(date =>
    `<a href="${formPath(state.id, date, companionId)}" aria-label="${esc(dateText(date))} 세션 기록 보기"><time datetime="${esc(date)}">${esc(date.replaceAll('-', '. '))}</time><span class="day">${dayOf(date)}요일</span>${icon('book')}</a>`,
  ).join('');
  objectDialog.innerHTML = '<div class="object-sheet"><button type="button" class="modal-close" data-close aria-label="핀 상세 닫기">'+
    icon('close')+'</button><div class="pin-field"><img src="'+asset(state.pin)+'" alt="'+esc(item.ko)+
    '의 에나멜 핀"></div><div class="object-info"><p lang="en" class="object-en">'+esc(item.en)+
    '</p><h2 id="object-title">'+esc(item.ko)+'</h2><p class="object-text">'+esc(profile.descriptions[state.pin] || item.motif)+
    '</p><div class="detail-dates"><h3>함께한 날</h3>'+links+'</div></div></div>';
  if (!objectDialog.open) objectDialog.showModal();
  document.body.classList.add('dialog-open');
  lastOpenPin = state.pin;
}

function render(state) {
  footer.hidden = false;
  document.title = 'My Collection';
  const nextKey = formPath(state.id, state.date, state.companion?.profileId);
  const changed = nextKey !== baseKey;
  const onDate = document.activeElement?.matches('.archive-date');
  const onCompanion = document.activeElement?.matches('.archive-people a');
  if (objectDialog.open && !state.pin) objectDialog.close();
  if (changed) {
    main.innerHTML = collection(state);
    layoutPins();
    baseKey = nextKey;
    if (onDate) main.querySelector('.archive-date[aria-current]')?.focus({ preventScroll: true });
    else if (onCompanion) main.querySelector('.archive-people a[aria-current]')?.focus({ preventScroll: true });
    else main.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }
  if (state.pin && (!objectDialog.open || lastOpenPin !== state.pin)) {
    objectTrigger = main.querySelector(`[data-pin="${state.pin}"]`);
    renderObject(state);
  } else if (!state.pin && lastOpenPin) {
    if (!changed && objectTrigger?.isConnected) objectTrigger.focus({ preventScroll: true });
    lastOpenPin = '';
    objectTrigger = undefined;
  }
  if (!objectDialog.open) document.body.classList.remove('dialog-open');
  current = state;
}

function resetEntry(message = '') {
  entryRequest++;
  profile = current = laidOutField = undefined;
  baseKey = lastOpenPin = '';
  objectTrigger = undefined;
  if (objectDialog.open) objectDialog.close();
  document.body.classList.remove('dialog-open');
  footer.hidden = true;
  showEntry();
  document.getElementById('entry-error').textContent = message;
  window.scrollTo(0, 0);
}

async function refresh() {
  const route = readRoute();
  if (!route) {
    resetEntry();
    return;
  }
  if (profile?.id === route.id) {
    render(makeState(route));
    return;
  }
  const request = ++entryRequest;
  if (objectDialog.open) objectDialog.close();
  document.body.classList.remove('dialog-open');
  footer.hidden = true;
  main.innerHTML = '<p class="blank" role="status">기록을 불러오는 중입니다.</p>';
  try {
    const { record: data, descriptions } = await loadExhibitionView(route.id);
    if (request !== entryRequest) return;
    if (!data) {
      history.replaceState(null, '', '#');
      resetEntry('이 기록을 찾지 못했습니다.');
      return;
    }
    profile = { id: route.id, data, descriptions, gameOrder: rankedGames(data.days, gameTieRanks) };
    render(makeState(route));
  } catch (error) {
    if (request !== entryRequest) return;
    history.replaceState(null, '', '#');
    resetEntry(exhibitionErrorMessage(error));
  }
}

function navigate(href, marker = null, replace = false) {
  if ((location.hash || '#') === href) return;
  history[replace ? 'replaceState' : 'pushState'](marker, '', href);
  void refresh();
}

function closeObject() {
  if (!current?.pin) return;
  const base = formPath(current.id, current.date, current.companion?.profileId);
  if (history.state?.avalonFrom === base) history.back();
  else navigate(base, null, true);
}

document.addEventListener('submit', async event => {
  if (event.target.id !== 'name-form') return;
  event.preventDefault();
  const request = ++entryRequest;
  const error = document.getElementById('entry-error');
  const choices = document.getElementById('name-matches');
  const input = document.getElementById('member-name');
  choices.replaceChildren();
  error.textContent = '기록을 확인하는 중입니다.';
  try {
    const matches = await findExhibitionMembers(input.value);
    if (request !== entryRequest) return;
    if (matches.length > 0) input.blur();
    if (matches.length === 1) {
      navigate(formPath(matches[0].profileId));
      return;
    }
    error.textContent = matches.length
      ? '같은 이름의 기록이 있어 해당 항목을 선택해 주세요.'
      : '기록에서 해당 이름을 찾지 못했습니다. 이름을 다시 확인해 주세요.';
    const counts = new Map();
    for (const match of matches) counts.set(match.yearLabel, (counts.get(match.yearLabel) || 0) + 1);
    matches.forEach(({ profileId, yearLabel }, index) => {
      const button = document.createElement('button');
      const year = yearLabel ? `${yearLabel}학번` : '학번 미표기';
      button.type = 'button';
      button.dataset.member = profileId;
      button.textContent = counts.get(yearLabel) > 1 ? `${year} · 기록 ${index + 1}` : year;
      choices.append(button);
    });
  } catch (cause) {
    if (request === entryRequest) error.textContent = exhibitionErrorMessage(cause);
  }
});

document.getElementById('skip').addEventListener('click', event => {
  event.preventDefault();
  main.focus();
});
document.addEventListener('click', event => {
  const el = event.target instanceof Element ? event.target : null;
  if (!el) return;
  const member = el.closest('[data-member]');
  if (member) { navigate(formPath(member.dataset.member)); return; }
  if (el.closest('[data-close]')) { closeObject(); return; }
  const pin = el.closest('[data-pin]');
  if (pin && current) {
    const base = formPath(current.id, current.date, current.companion?.profileId);
    navigate(formPath(current.id, current.date, current.companion?.profileId, pin.dataset.pin), { avalonFrom: base });
    return;
  }
  if (el.closest('.label-toggle')) {
    showLabels = !showLabels;
    main.querySelector('.works')?.classList.toggle('labels-off', !showLabels);
    main.querySelector('.label-toggle')?.setAttribute('aria-pressed', String(showLabels));
    return;
  }
  const link = el.closest('a[href^="#"]');
  if (link && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
    event.preventDefault();
    navigate(link.getAttribute('href'));
  }
});

objectDialog.addEventListener('cancel', event => { event.preventDefault(); closeObject(); });
objectDialog.addEventListener('click', event => {
  if (event.target !== objectDialog) return;
  const box = objectDialog.getBoundingClientRect();
  if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) closeObject();
});
window.addEventListener('popstate', () => { void refresh(); });
window.addEventListener('hashchange', () => { void refresh(); });
void refresh();
