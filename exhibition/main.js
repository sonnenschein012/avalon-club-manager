import games from './games.json';
import { placeRankedPins } from './pin-layout.js';
import { exhibitionGames, rankedCompanions, rankedGames } from '../src/domain/exhibition/collection';
import { exhibitionCopy, exhibitionImageUrl, isExhibitionImageUpload } from '../src/domain/exhibition/presentation';
import {
  exhibitionErrorMessage, findExhibitionMembers, loadExhibitionView, loadExhibitionPinImage,
  watchExhibitionPublication, watchExhibitionCopy, watchExhibitionAppearance,
} from './data';

const pinAssets = import.meta.glob('./assets/pins/*.webp', { eager: true, query: '?url', import: 'default' });
const main = document.getElementById('main');
const footer = document.getElementById('collection-footer');
const objectDialog = document.getElementById('object-dialog');
const week = ['일', '월', '화', '수', '목', '금', '토'];
const esc = value => String(value).replace(/[&<>"']/g, char =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const icon = id => '<svg class="icon" aria-hidden="true" viewBox="0 0 24 24"><use href="#'+id+'"/></svg>';
const artworkKey = id => profile?.data.gamePins?.[id] ?? id;
const imageKey = id => Object.hasOwn(profile.images, id) ? id : artworkKey(id);
const imageSetting = id => profile.images[imageKey(id)];
const asset = id => exhibitionImageUrl(imageSetting(id)) ?? pinAssets[`./assets/pins/${artworkKey(id)}.webp`];
const pinDescription = id => profile.descriptions[id] ?? profile.descriptions[artworkKey(id)] ?? gameItem(id)?.motif ?? '';
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
let copy = { ...exhibitionCopy };
let publicationSubscription;
let appearanceSubscription;
let pinAppearance;
let publicationTimer;
const imageLoads = new Map();
const imageObserver = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
  for (const { isIntersecting, target } of entries) {
    if (!isIntersecting) continue;
    imageObserver.unobserve(target);
    loadPinArtwork(target);
  }
}, { rootMargin: '180px' }) : undefined;

function loadPinArtwork(element) {
  const { imageKey: key, imageUpload: version } = element.dataset;
  if (!imageLoads.has(version)) {
    const pending = loadExhibitionPinImage(key, version).catch(() => undefined);
    imageLoads.set(version, pending);
    void pending.then(url => { if (!url && imageLoads.get(version) === pending) imageLoads.delete(version); });
  }
  void imageLoads.get(version).then(url => {
    if (url && element.isConnected && profile?.images[key] === version) element.src = url;
  });
}

function artworkMarkup(id, alt, lazy = false) {
  const setting = imageSetting(id);
  const src = asset(id);
  const upload = isExhibitionImageUpload(setting)
    ? ' data-image-key="'+esc(imageKey(id))+'" data-image-upload="'+esc(setting)+'"' : '';
  return '<img'+(src ? ' src="'+esc(src)+'"' : '')+upload+' alt="'+esc(alt)+'" draggable="false"'
    +(lazy ? ' loading="lazy"' : '')+' decoding="async">';
}

function intro(){
  const title = copy.collectionTitle;
  const split=title.lastIndexOf(" ");
  return '<header class="exhibit-intro"><h1 class="exhibit-title">'+(split === -1 ? esc(title) :
    '<span class="title-name">'+esc(title.slice(0,split))+'</span> <span class="title-kind">'+esc(title.slice(split+1))+'</span>')+'</h1></header>';
}

function gameItem(id) {
  const key = artworkKey(id);
  const title = profile?.data.gameTitles?.[id] ?? profile?.gameTitles?.[id];
  if (Object.hasOwn(games, key)) return title ? { ...games[key], ko: title } : games[key];
  return /^game-[a-f0-9]+$/.test(id) && title ? { ko: title, pending: true, unillustrated: true } : null;
}

function scatterPin(id) {
  const item=gameItem(id);
  const custom = exhibitionImageUrl(imageSetting(id)) || isExhibitionImageUpload(imageSetting(id));
  const art=item.pending&&!custom?'<span class="pending-art" aria-hidden="true"><span>+</span><small>'+
    esc(item.unillustrated ? copy.fallbackPin : '제작 예정')+'</small></span>':artworkMarkup(id, '', true);
  return '<button type="button" class="pin scatter-pin'+(item.pending?' pending-pin':'')+'" aria-label="'+esc(item.ko)+' 함께한 날 보기" data-pin="'+id+'">'+art+'<span class="pin-label">'+esc(item.ko)+'</span></button>';
}
function showEntry(){
  main.innerHTML='<section class="entry"><h1 class="entry-title"></h1><form id="name-form" class="name-form"><p class="entry-edition"></p><div class="name-input-row"><input id="member-name" name="name" type="text" autocomplete="off" maxlength="30" required><button type="submit" class="entry-submit" aria-label="컬렉션 열기"><svg aria-hidden="true" width="23" height="19" viewBox="0 0 29 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12H24m-6-6 6 6-6 6"/></svg></button></div><p id="entry-error" role="status"></p><div id="name-matches"></div></form></section>';
  updateEntryCopy();
}

function updateEntryCopy() {
  const title = main.querySelector('.entry-title');
  const edition = main.querySelector('.entry-edition');
  const input = main.querySelector('#member-name');
  if (!title || !edition || !input) return;
  document.title = copy.entryTitle;
  const split = copy.entryTitle.lastIndexOf(' ');
  title.innerHTML = split < 0 ? esc(copy.entryTitle) :
    '<span>'+esc(copy.entryTitle.slice(0,split))+'</span> <span>'+esc(copy.entryTitle.slice(split+1))+'</span>';
  edition.textContent = copy.edition;
  input.placeholder = copy.namePrompt;
  input.setAttribute('aria-label', copy.namePrompt);
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
  const requestedPin = selected.has(route.pin) ? route.pin : gameOrder.find(id => artworkKey(id) === route.pin);
  const pin = requestedPin && gameItem(requestedPin) ? requestedPin : '';
  return { id: route.id, date, dates, companions, companion, gameOrder, pin };
}

function archive(state) {
  const { id, date, dates, companions, companion } = state;
  if (!dates.length) return '';
  const companionId = companion?.profileId || '';
  const all = `<a class="archive-date all-dates" href="${formPath(id, '', companionId)}" ${date ? '' : 'aria-current="true"'}><span>${esc(copy.allDates)}</span></a>`;
  const datesHtml = dates.map(day => {
    const path = formPath(id, day.date, companionId);
    const active = day.date === date ? 'aria-current="date"' : '';
    return `<a class="archive-date" href="${path}" ${active} aria-label="${esc(dateText(day.date))}"><time datetime="${esc(day.date)}">${esc(day.date.slice(5).replace('-', '.'))}</time></a>`;
  }).join('');
  const people = companions.map(person => {
    const active = person.profileId === companionId ? 'aria-current="true"' : '';
    return `<li><a href="${formPath(id, '', person.profileId)}" ${active}>${esc(person.name)}</a></li>`;
  }).join('');
  const peopleLabel = date ? copy.groupLabel : copy.companionsLabel;
  const peopleClass = date ? 'archive-people archive-people-before-dates' : 'archive-people';
  const peopleSection = people
    ? `<div class="${peopleClass}"><span class="archive-people-label">${esc(peopleLabel)}</span><ul>${people}</ul></div>`
    : '';
  const datesSection = '<h2 class="archive-heading">'+esc(copy.archiveTitle)+'</h2>'+
    '<nav class="archive-dates" aria-label="모임 날짜">'+all+datesHtml+'</nav>';
  return '<section class="session-archive" aria-label="세션 기록">'+
    (date ? peopleSection+datesSection : datesSection+peopleSection)+'</section>';
}

function collection(state) {
  const ordered = state.gameOrder.filter(id => gameItem(id));
  const pins = ordered.map(scatterPin).join('');
  const companionHeading = state.companion
    ? `<div class="companion-filter">${esc(state.companion.name)}님과 함께한 게임<a class="text-control" href="${formPath(state.id, state.date)}">${esc(copy.clearFilter)}</a></div>`
    : '';
  const empty = '<p class="collection-empty" role="status">'+esc(state.companion ? copy.noCompanionGames :
    state.date ? copy.noDayGames : copy.noGames)+'</p>';
  return intro()+companionHeading+
    `<section class="works scatter-field ranked-layout${showLabels ? '' : ' labels-off'}" aria-label="보드게임 컬렉션">${pins || empty}</section>`+
    (pins ? '<div class="board-caption"><p class="caption-hint">'+icon('hand')+
    '<span>'+esc(copy.pinHint)+'</span></p><button class="text-control label-toggle" type="button" aria-pressed="'+
    showLabels+'">'+esc(copy.labelsToggle)+'<span aria-hidden="true" class="label-switch"></span></button></div>' : '')+archive(state);
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
  const item = gameItem(state.pin);
  const companionId = state.companion?.profileId || '';
  const dates = exhibitionGames(profile.data, { companionId }).get(state.pin) || [];
  const links = dates.map(date =>
    `<a href="${formPath(state.id, date, companionId)}" aria-label="${esc(dateText(date))} 세션 기록 보기"><time datetime="${esc(date)}">${esc(date.replaceAll('-', '. '))}</time><span class="day">${dayOf(date)}요일</span>${icon('book')}</a>`,
  ).join('');
  const image = asset(state.pin) || isExhibitionImageUpload(imageSetting(state.pin));
  const artwork = image ?
    '<div class="pin-field">'+artworkMarkup(state.pin, item.ko+'의 에나멜 핀')+'</div>' : '';
  const englishTitle = item.en ? '<p lang="en" class="object-en">'+esc(item.en)+'</p>' : '';
  const descriptionText = pinDescription(state.pin);
  const text = '<p class="object-text"'+(descriptionText ? '' : ' hidden')+'>'+esc(descriptionText)+'</p>';
  objectDialog.innerHTML = '<div class="object-sheet'+(image?'':' text-only')+'"><button type="button" class="modal-close" data-close aria-label="핀 상세 닫기">'+
    icon('close')+'</button>'+artwork+'<div class="object-info">'+englishTitle+'<h2 id="object-title">'+esc(item.ko)+
    '</h2>'+text+'<div class="detail-dates"><h3>'+esc(copy.archiveTitle)+'</h3>'+links+'</div></div></div>';
  if (!objectDialog.open) objectDialog.showModal();
  objectDialog.querySelectorAll('[data-image-upload]').forEach(loadPinArtwork);
  document.body.classList.add('dialog-open');
  lastOpenPin = state.pin;
}

function render(state, replaceRecord = false) {
  footer.hidden = false;
  document.title = copy.collectionTitle;
  footer.querySelector('a').textContent = copy.anotherName;
  const nextKey = formPath(state.id, state.date, state.companion?.profileId);
  const changed = nextKey !== baseKey || replaceRecord;
  const onDate = document.activeElement?.matches('.archive-date');
  const onCompanion = document.activeElement?.matches('.archive-people a');
  if (objectDialog.open && !state.pin) objectDialog.close();
  if (changed) {
    imageObserver?.disconnect();
    main.innerHTML = collection(state);
    layoutPins();
    baseKey = nextKey;
    main.querySelectorAll('[data-image-upload]').forEach(element =>
      imageObserver ? imageObserver.observe(element) : loadPinArtwork(element));
    if (!replaceRecord) {
      if (onDate) main.querySelector('.archive-date[aria-current]')?.focus({ preventScroll: true });
      else if (onCompanion) main.querySelector('.archive-people a[aria-current]')?.focus({ preventScroll: true });
      else main.focus({ preventScroll: true });
      window.scrollTo(0, 0);
    }
  }
  if (state.pin && (!objectDialog.open || lastOpenPin !== state.pin || replaceRecord)) {
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

function showEntryError(message, retryRoute) {
  document.getElementById('entry-error').textContent = message;
  if (!retryRoute || message === copy.unpublished) return;
  const form = document.getElementById('name-form');
  if (retryRoute !== 'search') form.dataset.retryRecord = retryRoute;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'text-control entry-retry';
  button.textContent = '다시 시도';
  document.getElementById('name-matches').append(button);
}

function resetEntry(message = '', retryRoute) {
  entryRequest++;
  publicationSubscription?.();
  publicationSubscription = undefined;
  appearanceSubscription?.();
  appearanceSubscription = undefined;
  pinAppearance = undefined;
  imageObserver?.disconnect();
  imageLoads.clear();
  clearTimeout(publicationTimer);
  profile = current = laidOutField = undefined;
  baseKey = lastOpenPin = '';
  objectTrigger = undefined;
  if (objectDialog.open) objectDialog.close();
  document.body.classList.remove('dialog-open');
  footer.hidden = true;
  showEntry();
  showEntryError(message, retryRoute);
  window.scrollTo(0, 0);
}

function updatePinDescriptions(descriptions) {
  profile.descriptions = descriptions;
  const description = objectDialog.querySelector('.object-text');
  if (objectDialog.open && description && current?.pin) {
    description.textContent = pinDescription(current.pin);
    description.hidden = !description.textContent;
  }
}

function showUnavailable() {
  history.replaceState(null, '', '#');
  resetEntry(copy.unpublished);
}

function trackPublicationEnd(endsAt) {
  clearTimeout(publicationTimer);
  if (!Number.isFinite(endsAt)) return;
  const remaining = endsAt - Date.now();
  if (remaining <= 0) return showUnavailable();
  publicationTimer = setTimeout(() => trackPublicationEnd(endsAt), Math.min(remaining, 2_147_000_000));
}

function watchPublishedRecord() {
  if (publicationSubscription) return;
  publicationSubscription = watchExhibitionPublication(update => {
    if (!profile || readRoute()?.id !== profile.id) return;
    if (!update) return showUnavailable();
    trackPublicationEnd(update.endsAt);
    if (update.id !== profile?.generationId) {
      void refresh(update);
    } else updatePinDescriptions(pinAppearance?.descriptions ?? update.descriptions);
  });
  appearanceSubscription = watchExhibitionAppearance(update => {
    const route = readRoute();
    if (!profile || route?.id !== profile.id) return;
    pinAppearance = update;
    const imagesChanged = JSON.stringify(profile.images) !== JSON.stringify(update.images);
    profile.images = update.images;
    updatePinDescriptions(update.descriptions);
    if (imagesChanged) render(makeState(route), true);
  });
}

async function refresh(published) {
  const route = readRoute();
  if (!route) {
    resetEntry();
    return;
  }
  const previous = profile?.id === route.id ? profile : undefined;
  if (previous && !published) {
    render(makeState(route));
    return;
  }
  const request = ++entryRequest;
  if (!previous) {
    if (objectDialog.open) objectDialog.close();
    document.body.classList.remove('dialog-open');
    footer.hidden = true;
    main.innerHTML = '<p class="record-loading" role="status"><span class="record-loading-indicator" aria-hidden="true"></span><span data-loading-copy>'+esc(copy.loadingRecord)+'</span></p>';
  }
  try {
    const { record: data, generationId, descriptions, images = {}, gameTitles = {}, endsAt } = await loadExhibitionView(route.id, published);
    const latestRoute = readRoute();
    if (request !== entryRequest || latestRoute?.id !== route.id) return;
    if (!data) {
      history.replaceState(null, '', '#');
      resetEntry(copy.missingRecord);
      return;
    }
    if (previous && previous.generationId === generationId) {
      updatePinDescriptions(pinAppearance?.descriptions ?? descriptions);
      trackPublicationEnd(endsAt);
      return;
    }
    profile = { id: route.id, generationId, data, gameTitles, images: pinAppearance?.images ?? images,
      descriptions: pinAppearance?.descriptions ?? descriptions, gameOrder: rankedGames(data.days) };
    render(makeState(latestRoute), Boolean(previous));
    trackPublicationEnd(endsAt);
    if (!profile) return;
    watchPublishedRecord();
  } catch (error) {
    if (request !== entryRequest) return;
    if (previous) return;
    history.replaceState(null, '', '#');
    resetEntry(exhibitionErrorMessage(error, copy), formPath(route.id, route.date, route.companionId, route.pin));
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
  delete input.form.dataset.retryRecord;
  main.querySelector('.entry-retry')?.remove();
  choices.replaceChildren();
  error.textContent = copy.checkingName;
  try {
    const matches = await findExhibitionMembers(input.value);
    if (request !== entryRequest) return;
    if (matches.length > 0) input.blur();
    if (matches.length === 1) {
      navigate(formPath(matches[0].profileId));
      return;
    }
    error.textContent = matches.length
      ? copy.sameName : copy.noNameMatch;
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
    if (request === entryRequest) showEntryError(exhibitionErrorMessage(cause, copy), 'search');
  }
});

document.getElementById('skip').addEventListener('click', event => {
  event.preventDefault();
  main.focus();
});
document.addEventListener('click', event => {
  const el = event.target instanceof Element ? event.target : null;
  if (!el) return;
  if (el.closest('.entry-retry')) {
    const form = main.querySelector('#name-form');
    if (form.dataset.retryRecord) navigate(form.dataset.retryRecord);
    else form.requestSubmit();
    return;
  }
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
watchExhibitionCopy(value => {
  const updated = { ...exhibitionCopy, ...value };
  if (JSON.stringify(copy) === JSON.stringify(updated)) return;
  copy = updated;
  const route = readRoute();
  if (profile && route?.id === profile.id) render(makeState(route), true);
  else {
    updateEntryCopy();
    const loading = main.querySelector('[data-loading-copy]');
    if (loading) loading.textContent = copy.loadingRecord;
  }
});
void refresh();
