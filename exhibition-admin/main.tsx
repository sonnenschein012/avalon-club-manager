import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type RefObject } from 'react';
import { createRoot } from 'react-dom/client';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { collection, getDocsFromServer } from 'firebase/firestore';
import { ArrowUpRight, ClipboardList, Globe2, ImageIcon, LogOut, RefreshCw, Search, Type } from 'lucide-react';
import { auth, checkAdminStatus, db, logout, signInWithGoogle } from '../src/lib/firebase';
import {
  loadExhibitionSettings, loadExhibitionStatus, loadPublishedExhibitionGameKeys, saveExhibitionSettings,
  watchExhibitionSync, type ExhibitionSettings, type ExhibitionSyncStatus, type ExhibitionSyncError,
} from '../src/services/exhibitionSyncService';
import {
  defaultExhibitionPin, exhibitionCopy, exhibitionImageUrl, exhibitionPins, exhibitionPublicationWindow,
  isExhibitionImageUpload, normalizeExhibitionGameTitle, type ExhibitionCopy, type ExhibitionVisibility,
} from '../src/domain/exhibition/presentation';
import { readUploadedPinImage } from '../exhibition/reader';
import { preparePinImage, type PreparedPinImage } from './pinImage';
import { DateRange } from './DateRange';
import { PinWorklist } from './PinWorklist';
import { PinImageRequirements } from './PinImageRequirements';
import { contentForGame, type GameChoice, type PinContent } from './pinContent';
import { StudioLanguageContext, studioImageError, studioLanguageKey, studioPublicationStep, useStudioLanguage,
  useStudioText, type StudioLanguage, type StudioMessage } from './language';
import gameTitles from './gameTitles.json';
import { Alert, AlertDescription } from './ui/alert';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { RadioGroup, RadioGroupItem } from './ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { Textarea } from './ui/textarea';
import './style.css';

const exhibitionId = import.meta.env.VITE_EXHIBITION_ID || 'avalon';
const empty: ExhibitionSettings = { enabled: false, period: { kind: 'all' }, gameMapping: [] };
const englishGameTitles = new Map(Object.entries(gameTitles)
  .map(([title, english]) => [normalizeExhibitionGameTitle(title), english]));
const sections = {
  publication: { label: 'Publication', icon: Globe2 },
  pins: { label: 'Games and pins', icon: ImageIcon },
  worklist: { label: 'Needs attention', icon: ClipboardList },
  copy: { label: 'Exhibit text', icon: Type },
} as const;
const copyLabels: Record<keyof typeof exhibitionCopy, StudioMessage> = {
  entryTitle: 'Home title', edition: 'Edition label', namePrompt: 'Name prompt', collectionTitle: 'Collection title',
  pinHint: 'Pin instructions', archiveTitle: 'Session history title', groupLabel: 'Group heading',
  companionsLabel: 'Players heading', labelsToggle: 'Pin labels toggle', anotherName: 'Search again link',
  unpublished: 'Private exhibit message', allDates: 'All dates label', clearFilter: 'Clear filter link',
  fallbackPin: 'Default pin label', checkingName: 'Searching message', sameName: 'Duplicate name message',
  loadingRecord: 'Loading message', missingRecord: 'Missing record message', loadError: 'Error message',
  noNameMatch: 'No matches message', noGames: 'No games message', noDayGames: 'No games that day',
  noCompanionGames: 'No games together',
};
const copyGroups = [
  { title: 'Home and search', fields: ['entryTitle', 'edition', 'namePrompt', 'anotherName', 'checkingName', 'sameName', 'noNameMatch'] },
  { title: 'Collection', fields: ['collectionTitle', 'pinHint', 'labelsToggle', 'fallbackPin', 'archiveTitle', 'groupLabel', 'companionsLabel', 'allDates', 'clearFilter'] },
  { title: 'Status messages', fields: ['unpublished', 'loadingRecord', 'missingRecord', 'loadError', 'noGames', 'noDayGames', 'noCompanionGames'] },
] as const;
const visibilityOptions = [['public', 'Public'], ['private', 'Private'], ['temporary', 'Scheduled']] as const;
const periodOptions = [['all', 'All records'], ['semesterRange', 'Semesters'], ['range', 'Dates']] as const;
type Section = keyof typeof sections;
type EditorPeriod = Exclude<ExhibitionSettings['period'], { kind: 'semester' }> |
  { kind: 'semesterRange'; start: string; end: string };
type PeriodRange = { start: string; end: string };
const emptyRange: PeriodRange = { start: '', end: '' };

function sameRange(left: PeriodRange, right: PeriodRange) {
  return left.start === right.start && left.end === right.end;
}

function clean(values: Record<string, string | undefined>) {
  return Object.fromEntries(Object.entries(values).flatMap(([key, value]) => value?.trim() ? [[key, value.trim()]] : []));
}

function sameOverrides(left: Record<string, string>, right: Record<string, string>) {
  const entries = Object.entries(clean(left));
  const cleanRight = clean(right);
  return entries.length === Object.keys(cleanRight).length && entries.every(([key, value]) => cleanRight[key] === value);
}

function getEditorPeriod(period: ExhibitionSettings['period']): EditorPeriod {
  if (period.kind === 'semester') return { kind: 'semesterRange', start: period.semester, end: period.semester };
  if (period.kind === 'range' && period.semesters) return { kind: 'semesterRange', ...period.semesters };
  return period;
}

function semesterDates(start: string, end: string): ExhibitionSettings['period'] {
  const startYear = start.slice(0, 4);
  const endYear = end.slice(0, 4);
  const endDate = end.endsWith('-1') ? endYear + '-08-31' :
    new Date(Date.UTC(Number(endYear) + 1, 2, 0)).toISOString().slice(0, 10);
  return { kind: 'range', start: startYear + (start.endsWith('-1') ? '-03-01' : '-09-01'),
    end: endDate, semesters: { start, end } };
}

function RadioChoices<T extends string>({ label, items, value, onChange }: {
  label: string; items: readonly (readonly [T, string])[]; value: T; onChange: (value: T) => void;
}) {
  const id = useId();
  return <div className="grid gap-2">
    <Label id={id}>{label}</Label>
    <RadioGroup aria-labelledby={id} value={value} onValueChange={next => onChange(next as T)}
      className="grid-cols-3 gap-1.5 sm:gap-3">
      {items.map(([key, text]) => <Label key={key} htmlFor={id + key}
        className="min-h-11 gap-1.5 rounded-lg border bg-card px-2 leading-tight transition-colors has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-accent sm:gap-2 sm:px-3">
        <RadioGroupItem id={id + key} value={key} />
        {text}
      </Label>)}
    </RadioGroup>
  </div>;
}

function SemesterField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const t = useStudioText();
  const [year = '', term = '1'] = value.split('-');
  return <div className="grid gap-2" role="group" aria-label={label}>
    <Label>{label}</Label>
    <div className="grid grid-cols-2 gap-2">
      <Input aria-label={label + ' ' + t('year')} inputMode="numeric" placeholder={t('Year')} maxLength={4} value={year}
        onChange={event => onChange(`${event.target.value.replace(/[^0-9]/g, '')}-${term}`)} />
      <Select value={term} onValueChange={next => onChange(`${year}-${next}`)}>
        <SelectTrigger aria-label={label + ' ' + t('term')} className="w-full"><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value="1">{t('Semester 1')}</SelectItem><SelectItem value="2">{t('Semester 2')}</SelectItem></SelectContent>
      </Select>
    </div>
  </div>;
}

function PinEditor({ games, selected, active, onSelect, search, onSearch, searchInput, content, uploads,
  onExclusion, onDescription, onImage, onFile }: {
  games: GameChoice[];
  selected: GameChoice | undefined;
  active: boolean;
  onSelect: (game: GameChoice) => void;
  search: string;
  onSearch: (query: string) => void;
  searchInput: RefObject<HTMLInputElement | null>;
  content: PinContent;
  uploads: ReadonlyMap<string, PreparedPinImage>;
  onExclusion: (id: string, excluded: boolean) => void;
  onDescription: (pin: string, text: string | undefined) => void;
  onImage: (pin: string, text: string) => void;
  onFile: (pin: string, file: File) => void;
}) {
  const t = useStudioText();
  const language = useStudioLanguage();
  const [brokenImage, setBrokenImage] = useState<string>();
  const fileInput = useRef<HTMLInputElement>(null);
  const editHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (active && selected) editHeading.current?.focus(); }, [active, selected]);
  const query = normalizeExhibitionGameTitle(search);
  const matches = query ? games.filter(game => game.searchTitles.some(title => title.includes(query)))
    .sort((a, b) => Number(b.searchTitles.includes(query)) - Number(a.searchTitles.includes(query))) : [];
  const pin = selected && contentForGame(selected, content);
  const draft = pin && uploads.get(pin.imageKey);
  const imageKey = pin?.imageKey;
  const imageConfig = pin?.imageConfig;
  const uploaded = isExhibitionImageUpload(imageConfig);
  const [preview, setPreview] = useState<{ version: string; image: string | undefined }>();
  useEffect(() => {
    if (!active || !imageKey || !imageConfig || !uploaded || draft?.version === imageConfig) return;
    let current = true;
    void readUploadedPinImage(db, exhibitionId, imageKey, imageConfig).then(image => {
      if (current) setPreview({ version: imageConfig, image });
    }).catch(() => { if (current) setPreview({ version: imageConfig, image: undefined }); });
    return () => { current = false; };
  }, [active, imageConfig, imageKey, uploaded, draft]);
  const draftImage = draft?.version === imageConfig ? draft?.preview : undefined;
  const savedImage = preview?.version === imageConfig ? preview : undefined;
  const image = uploaded ? draftImage ?? savedImage?.image : exhibitionImageUrl(imageConfig) ?? pin?.bundledImage;
  const imageFailed = (image && brokenImage === image) || (uploaded && !draftImage && savedImage && !savedImage.image);
  const imageStatus = imageFailed ? 'Current image could not load.'
    : draftImage ? 'New image ready to save.'
    : uploaded ? 'Uploaded image' : exhibitionImageUrl(imageConfig) ? 'Linked image'
    : pin?.bundledImage ? 'Default image' : 'No image registered';

  return <div className="grid gap-6">
    <div className="grid gap-2">
      <Label htmlFor="game-search">{t('Find a game')}</Label>
      <div className="relative max-w-md">
        <Search aria-hidden="true" className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground" />
        <Input ref={searchInput} id="game-search" type="search" value={search} placeholder={t('Search by title')}
          className="pl-9" onChange={event => onSearch(event.target.value)}
          onKeyDown={event => { if (event.key === 'Enter') event.preventDefault(); }} />
      </div>
      {query && <div className="flex flex-wrap gap-2" aria-label={t('Search results')}>
        {matches.length === 0 && <p className="text-sm text-muted-foreground" role="status">{t('No games found.')}</p>}
        {matches.slice(0, 12).map(game => <Button type="button" key={game.id}
          variant={selected?.id === game.id ? 'default' : 'outline'} aria-pressed={selected?.id === game.id}
          onClick={() => { onSelect(game); setBrokenImage(undefined); }}>{game.names[language]}</Button>)}
        {matches.length > 12 && <p className="w-full text-sm text-muted-foreground">{t('Type more to narrow the results.')}</p>}
      </div>}
    </div>
    {selected && pin && <div className="grid gap-6 min-[680px]:grid-cols-[minmax(0,1fr)_minmax(0,15rem)]">
      <div className="grid gap-4">
        <h3 ref={editHeading} tabIndex={-1} className="text-base font-semibold">{selected.names[language]}</h3>
        <div className="grid gap-2">
          <Label htmlFor="pin-description">{t('Pin description')}</Label>
          <Textarea id="pin-description" rows={4} maxLength={500}
            value={pin.description} onChange={event => onDescription(pin.gameKey, event.target.value)} />
          {pin.defaultDescription && pin.description !== pin.defaultDescription &&
            <Button className="justify-self-start px-0" type="button" variant="link" size="sm"
              onClick={() => onDescription(pin.gameKey, undefined)}>{t('Restore default description')}</Button>}
        </div>
        <div className="grid gap-2">
          <div className="flex items-center gap-1">
            <span className="text-sm font-medium">{t('Pin image')}</span>
            <PinImageRequirements key={selected.id} />
          </div>
          <p className="text-sm text-muted-foreground" role="status">{t(imageStatus)}</p>
          <input hidden ref={fileInput} id="pin-file" type="file" accept="image/png,image/jpeg,image/webp" onChange={event => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            if (file) { setBrokenImage(undefined); onFile(pin.gameKey, file); }
          }} />
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => fileInput.current?.click()}>
              {t(pin.hasImage ? 'Replace image' : 'Choose image')}
            </Button>
            {content.images[pin.gameKey] && <Button type="button" variant="ghost" onClick={() => onImage(pin.gameKey, '')}>{t('Remove custom image')}</Button>}
          </div>
        </div>
        <details key={selected.id} className="border-t pt-3">
          <summary className="cursor-pointer text-sm font-medium">
            {t('Advanced options')}{pin.excluded && <Badge className="ml-2" variant="outline">{t('Excluded')}</Badge>}
          </summary>
          <div className="mt-3 grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="pin-image">{t('Image URL (optional)')}</Label>
              <Input id="pin-image" inputMode="url" maxLength={400} placeholder="https://" aria-describedby="pin-image-hint"
                value={isExhibitionImageUpload(content.images[pin.gameKey]) ? '' : content.images[pin.gameKey] ?? exhibitionImageUrl(imageConfig) ?? ''}
                onChange={event => { setBrokenImage(undefined); onImage(pin.gameKey, event.target.value); }} />
              <p id="pin-image-hint" className="text-sm text-muted-foreground">
                {t('Use a direct HTTPS image link if the image is hosted elsewhere. File uploads do not need a link.')}
              </p>
            </div>
            <div className="grid gap-2">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={pin.excluded} aria-describedby="pin-exclusion-hint"
                  onChange={event => onExclusion(selected.id, event.target.checked)} />
                {t('Exclude this game from the exhibit')}
              </label>
              <p id="pin-exclusion-hint" className="text-sm text-muted-foreground">
                {t('After saving, the game is omitted from the next published collection. Records in the operations app are kept.')}
              </p>
            </div>
          </div>
        </details>
      </div>
      <Card className="self-start border-dashed bg-muted/50 py-4 shadow-none">
        <CardHeader className="px-4"><CardTitle className="text-sm">{t('Pin preview')}</CardTitle></CardHeader>
        <CardContent className="grid min-h-32 place-items-center px-4 text-center text-sm text-muted-foreground">
          {image && brokenImage !== image ? <img className="max-h-48 w-full object-contain" src={image}
            referrerPolicy="no-referrer" alt={selected.names[language] + ' ' + t('pin')} onError={() => setBrokenImage(image)} />
            : <p>{t(imageFailed ? 'Image could not load.' : uploaded ? 'Loading saved image…' : 'No image for this pin.')}</p>}
        </CardContent>
      </Card>
    </div>}
  </div>;
}

function Settings({ initial, games }: { initial: ExhibitionSettings; games: GameChoice[] }) {
  const t = useStudioText();
  const language = useStudioLanguage();
  const [section, setSection] = useState<Section>(() => {
    const hash = window.location.hash.slice(1);
    return Object.hasOwn(sections, hash) ? hash as Section : 'publication';
  });
  const [visibility, setVisibility] = useState<ExhibitionVisibility>(initial.visibility ?? (initial.enabled ? 'public' : 'private'));
  const [autoPublish, setAutoPublish] = useState(initial.autoPublish === true);
  const [schedule, setSchedule] = useState(initial.schedule ?? emptyRange);
  const initialPeriod = getEditorPeriod(initial.period);
  const [periodKind, setPeriodKind] = useState(initialPeriod.kind);
  const [semesterRange, setSemesterRange] = useState<PeriodRange>(() => initialPeriod.kind === 'semesterRange' ? initialPeriod : emptyRange);
  const [dateRange, setDateRange] = useState<PeriodRange>(() => initialPeriod.kind === 'range' ? initialPeriod : emptyRange);
  const [mapping, setMapping] = useState(new Map(initial.gameMapping.map(item => [item.sourceId, item.pinId])));
  const [descriptions, setDescriptions] = useState(initial.descriptions ?? {});
  const [images, setImages] = useState(initial.images ?? {});
  const [savedPins, setSavedPins] = useState<PinContent>({ mapping, descriptions, images });
  const [selectedGame, setSelectedGame] = useState<GameChoice>();
  const [pinSearch, setPinSearch] = useState('');
  const pinSearchInput = useRef<HTMLInputElement>(null);
  const [uploads, setUploads] = useState(new Map<string, PreparedPinImage>());
  const [preparingImage, setPreparingImage] = useState(false);
  const [copy, setCopy] = useState<ExhibitionCopy>(initial.copy ?? {});
  const [savedForm, setSavedForm] = useState({ visibility, autoPublish, schedule, periodKind, semesterRange, dateRange, copy });
  const [sync, setSync] = useState<ExhibitionSyncStatus>('idle');
  const [status, setStatus] = useState<Awaited<ReturnType<typeof loadExhibitionStatus>>>();
  const [statusFailed, setStatusFailed] = useState(false);
  const [worklistReload, setWorklistReload] = useState(0);
  const [olderGeneration, setOlderGeneration] = useState<{ id: string; keys?: string[]; failed?: boolean }>();
  const activeGeneration = status?.generationId;
  const publishedKeys = status?.publishedGameKeys ??
    (activeGeneration ? (olderGeneration?.id === activeGeneration ? olderGeneration.keys : undefined)
      : status ? [] : undefined);
  const [message, setMessage] = useState<{ text: StudioMessage; error?: boolean }>();
  const [busy, setBusy] = useState(false);
  const canEdit = section !== 'worklist' && (section !== 'pins' || Boolean(selectedGame));
  const hasChanges = visibility !== savedForm.visibility || autoPublish !== savedForm.autoPublish || periodKind !== savedForm.periodKind ||
    (visibility === 'temporary' && !sameRange(schedule, savedForm.schedule)) ||
    (periodKind === 'semesterRange' && !sameRange(semesterRange, savedForm.semesterRange)) ||
    (periodKind === 'range' && !sameRange(dateRange, savedForm.dateRange)) ||
    Object.entries(exhibitionCopy).some(([key, fallback]) => {
      const field = key as keyof ExhibitionCopy;
      return (copy[field]?.trim() || fallback) !== (savedForm.copy[field]?.trim() || fallback);
    }) || uploads.size > 0 || mapping.size !== savedPins.mapping.size ||
    [...mapping].some(([key, value]) => savedPins.mapping.get(key) !== value) ||
    !sameOverrides(descriptions, savedPins.descriptions) || !sameOverrides(images, savedPins.images);

  const [syncFailure, setSyncFailure] = useState<ExhibitionSyncError | null>(null);
  const requestSync = useRef<() => void>(() => {});
  useEffect(() => {
    const watcher = watchExhibitionSync(setSync, setSyncFailure, 'requests', exhibitionId);
    requestSync.current = watcher.request;
    return watcher.stop;
  }, []);
  useEffect(() => {
    let cancelled = false;
    void loadExhibitionStatus(exhibitionId).then(result => {
      if (!cancelled) { setStatus(result); setStatusFailed(false); }
    }).catch(() => { if (!cancelled) setStatusFailed(true); });
    return () => { cancelled = true; };
  }, [sync, busy, worklistReload]);
  useEffect(() => {
    if (section !== 'worklist' || !activeGeneration || publishedKeys !== undefined) return;
    let cancelled = false;
    void loadPublishedExhibitionGameKeys(exhibitionId, activeGeneration).then(keys => {
      if (!cancelled) setOlderGeneration({ id: activeGeneration, keys });
    }).catch(() => { if (!cancelled) setOlderGeneration({ id: activeGeneration, failed: true }); });
    return () => { cancelled = true; };
  }, [section, activeGeneration, publishedKeys, worklistReload]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canEdit || !hasChanges || busy || preparingImage) return;
    if (visibility === 'temporary' && !exhibitionPublicationWindow(schedule)) {
      setMessage({ text: 'Check the publication dates.', error: true });
      return;
    }
    if ((periodKind === 'range' && !exhibitionPublicationWindow(dateRange)) ||
      (periodKind === 'semesterRange' && (!/^[1-9]\d{3}-[12]$/.test(semesterRange.start) ||
        !/^[1-9]\d{3}-[12]$/.test(semesterRange.end) || semesterRange.start > semesterRange.end))) {
      setMessage({ text: 'Check the start and end of the record range.', error: true });
      return;
    }
    if ([...uploads.values()].reduce((sum, upload) => sum + upload.bytes.length, 0) > 6 * 1024 * 1024) {
      setMessage({ text: 'Save fewer image files at a time.', error: true });
      return;
    }
    const cleanImages = Object.entries(images).flatMap(([id, value]) => value.trim() ?
      [[id, isExhibitionImageUpload(value) ? value : exhibitionImageUrl(value.trim())]] as const : []);
    if (cleanImages.some(([, url]) => !url)) {
      setMessage({ text: 'Use an HTTPS URL for each custom image.', error: true });
      return;
    }
    const savedCopy = clean(copy);
    const savedDescriptions = clean(descriptions);
    const savedImages = clean(Object.fromEntries(cleanImages));
    const period: ExhibitionSettings['period'] = periodKind === 'semesterRange'
      ? semesterDates(semesterRange.start, semesterRange.end)
      : periodKind === 'range' ? { kind: 'range', start: dateRange.start, end: dateRange.end } : { kind: 'all' };
    setBusy(true);
    try {
      const needsSync = await saveExhibitionSettings(exhibitionId, {
        enabled: visibility !== 'private', visibility, period,
        ...(autoPublish !== savedForm.autoPublish ? { autoPublish } : {}),
        ...(visibility === 'temporary' ? { schedule } : {}),
        gameMapping: [...mapping].map(([sourceId, pinId]) => ({ sourceId, pinId })),
        descriptions: savedDescriptions, images: savedImages, copy: savedCopy,
      }, ...(uploads.size ? [uploads] as const : []));
      setCopy(savedCopy);
      setDescriptions(savedDescriptions);
      setImages(savedImages);
      setSavedPins({ mapping, descriptions: savedDescriptions, images: savedImages });
      setUploads(new Map());
      setSavedForm({
        visibility, autoPublish, periodKind, copy: savedCopy,
        schedule: visibility === 'temporary' ? schedule : emptyRange,
        semesterRange: periodKind === 'semesterRange' ? semesterRange : emptyRange,
        dateRange: periodKind === 'range' ? dateRange : emptyRange,
      });
      setMessage({ text: needsSync && !autoPublish
        ? 'Changes saved. Publish records to apply them to the exhibit.' : 'Changes saved.' });
    } catch {
      setMessage({ text: 'Could not save changes. Try again.', error: true });
    } finally {
      setBusy(false);
    }
  }

  async function selectPinFile(key: string, file: File) {
    setPreparingImage(true);
    setMessage(undefined);
    try {
      const upload = await preparePinImage(file);
      setUploads(previous => new Map(previous).set(key, upload));
      setImages(previous => ({ ...previous, [key]: upload.version }));
    } catch (error) {
      setMessage({ text: studioImageError(error), error: true });
    } finally { setPreparingImage(false); }
  }

  function cancel() {
    setVisibility(savedForm.visibility);
    setAutoPublish(savedForm.autoPublish);
    setSchedule(savedForm.schedule);
    setPeriodKind(savedForm.periodKind);
    setSemesterRange(savedForm.semesterRange);
    setDateRange(savedForm.dateRange);
    setCopy(savedForm.copy);
    setMapping(new Map(savedPins.mapping));
    setDescriptions(savedPins.descriptions);
    setImages(savedPins.images);
    setUploads(new Map());
    if (section === 'pins') {
      setPinSearch('');
      setSelectedGame(undefined);
      pinSearchInput.current?.focus();
      setMessage(undefined);
      return;
    }
    setMessage({ text: 'Returned to saved settings.' });
  }

  const lastSync = status?.lastSyncedAt?.toLocaleString(language === 'ko' ? 'ko-KR' : 'en-US',
    { timeZone: 'Asia/Seoul', dateStyle: 'medium', timeStyle: 'short' });
  const count = status?.profileCount ?? 0;
  const savedWindow = savedForm.visibility === 'temporary' ? exhibitionPublicationWindow(savedForm.schedule) : null;
  const now = Date.now();
  const publicationLabel = savedForm.visibility === 'public' ? 'Public'
    : !savedWindow ? 'Private'
      : now < savedWindow.start.getTime() ? 'Scheduled'
        : now >= savedWindow.end.getTime() ? 'Ended' : 'Public · scheduled';
  const lastSyncLabel = language === 'ko' ? `${t('Last published:')} ${lastSync} · 컬렉션 ${count}개`
    : `Last published: ${lastSync} KST · ${count} collections`;
  const syncLabel = sync === 'syncing' ? t('Publishing records…')
    : sync === 'quota' ? t('Publication paused · Firestore usage limit')
    : sync === 'current' ? t('Published records are up to date.')
    : sync === 'error' ? t('Publication failed')
      : status?.pending || (sync === 'pending' && !status) ? t('Publication pending')
        : lastSync ? lastSyncLabel : t('No records published yet');

  function openSection(next: Section) {
    if (next !== section) setMessage(undefined);
    setSection(next);
    history.replaceState(history.state, '', '#' + next);
  }

  return <div className="grid gap-5">
    {syncFailure && <Alert variant="destructive"><AlertDescription>
      {t('Record publication:')} {studioPublicationStep(syncFailure.step, language)} ({syncFailure.code})
    </AlertDescription></Alert>}
    <Card className="gap-0 py-4 shadow-none">
      <CardContent className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-5">
        <div className="grid gap-1.5">
          <div className="flex items-center gap-2 text-sm font-semibold">{t('Exhibit status')} <Badge variant="secondary">{t(publicationLabel)}</Badge></div>
          <p className="text-sm text-muted-foreground" role="status">{syncLabel}</p>
        </div>
        <Button type="button" variant="outline" disabled={busy || sync === 'syncing' || sync === 'quota'} onClick={() => requestSync.current()}>
          <RefreshCw className={sync === 'syncing' ? 'motion-safe:animate-spin' : undefined} /> {t('Publish records')}
        </Button>
      </CardContent>
    </Card>
    <form onSubmit={event => void save(event)}>
      <Tabs value={section} onValueChange={next => openSection(next as Section)} className="gap-4">
        <TabsList aria-label={t('Exhibit settings')} className="grid h-auto! w-full max-w-xl grid-cols-2 gap-1 p-1 sm:grid-cols-4">
          {Object.entries(sections).map(([key, item]) => <TabsTrigger key={key} value={key}
            className="h-10 min-w-0 whitespace-normal px-1.5 text-center leading-tight sm:px-3">
            <item.icon aria-hidden="true" className="hidden sm:block" />{t(item.label)}
          </TabsTrigger>)}
        </TabsList>
        <Card className="shadow-none">
          <CardHeader><CardTitle>{t(sections[section].label)}</CardTitle></CardHeader>
          <CardContent>
            <fieldset disabled={busy || preparingImage} className="min-w-0">
              <TabsContent value="publication" className="grid max-w-2xl gap-5">
                <RadioChoices label={t('Visibility')} items={visibilityOptions.map(([id, label]) => [id, t(label)] as const)}
                  value={visibility} onChange={setVisibility} />
                {visibility === 'temporary' && <>
                  <DateRange startLabel={t('Publish on')} endLabel={t('Close after')} value={schedule} onChange={setSchedule} />
                  <p className="text-sm text-muted-foreground">{t('Both dates are included. All times are KST.')}</p>
                </>}
                <div className="border-t pt-5">
                  <RadioChoices label={t('Record range')} items={periodOptions.map(([id, label]) => [id, t(label)] as const)}
                    value={periodKind} onChange={setPeriodKind} />
                </div>
                {periodKind === 'semesterRange' && <div className="grid gap-4 sm:grid-cols-2">
                  <SemesterField label={t('Start semester')} value={semesterRange.start} onChange={start => setSemesterRange({ ...semesterRange, start })} />
                  <SemesterField label={t('End semester')} value={semesterRange.end} onChange={end => setSemesterRange({ ...semesterRange, end })} />
                </div>}
                {periodKind === 'range' && <DateRange startLabel={t('First record date')} endLabel={t('Last record date')} value={dateRange} onChange={setDateRange} />}
                <div className="grid gap-2 border-t pt-5">
                  <Label htmlFor="auto-publish" className="min-h-8">
                    <input id="auto-publish" type="checkbox" checked={autoPublish}
                      aria-describedby="auto-publish-hint" className="size-4 accent-primary"
                      onChange={event => setAutoPublish(event.target.checked)} />
                    {t('Automatically publish records')}
                  </Label>
                  <p id="auto-publish-hint" className="text-sm text-muted-foreground">
                    {t('When off, use Publish records to update the public collection. Automatic publishing runs in a signed-in admin browser.')}
                  </p>
                </div>
              </TabsContent>
              <TabsContent value="pins" forceMount className="data-[state=inactive]:hidden">
                <PinEditor games={games} selected={selectedGame} active={section === 'pins'} onSelect={setSelectedGame}
                  search={pinSearch} onSearch={setPinSearch} searchInput={pinSearchInput}
                  content={{ mapping, descriptions, images }} uploads={uploads}
                  onExclusion={(id, excluded) => setMapping(previous => {
                    const next = new Map(previous);
                    const savedSource = savedPins.mapping.get(id);
                    if (excluded) next.set(id, '');
                    else if (savedSource) next.set(id, savedSource);
                    else next.delete(id);
                    return next;
                  })}
                  onDescription={(pin, text) => setDescriptions(previous => {
                    const next = { ...previous };
                    if (text === undefined) delete next[pin]; else next[pin] = text;
                    return next;
                  })}
                  onImage={(pin, text) => {
                    setUploads(previous => { const next = new Map(previous); next.delete(pin); return next; });
                    setImages(previous => ({ ...previous, [pin]: text }));
                  }}
                  onFile={(pin, file) => { if (!preparingImage && !busy) void selectPinFile(pin, file); }} />
              </TabsContent>
              <TabsContent value="worklist" forceMount className="data-[state=inactive]:hidden">
                <PinWorklist games={games} saved={savedPins} publishedKeys={publishedKeys}
                  failed={statusFailed || Boolean(olderGeneration?.id === activeGeneration && olderGeneration?.failed)}
                  onRetry={() => {
                    setStatusFailed(false);
                    setOlderGeneration(undefined);
                    setWorklistReload(previous => previous + 1);
                  }} onEdit={game => {
                  setSelectedGame(game);
                  openSection('pins');
                }} />
              </TabsContent>
              <TabsContent value="copy" className="space-y-6">
                {copyGroups.map(group => <fieldset key={group.title} className="border-b pb-6 last:border-0 last:pb-0">
                  <legend className="mb-4 text-sm font-semibold">{t(group.title)}</legend>
                  <div className="grid gap-4 sm:grid-cols-2">
                    {group.fields.map(key => <div key={key} className="grid gap-2">
                      <Label htmlFor={key}>{t(copyLabels[key])}</Label>
                      <Input id={key} maxLength={key.endsWith('Title') ? 45 : 150} value={copy[key] ?? exhibitionCopy[key]}
                        onChange={event => setCopy({ ...copy, [key]: event.target.value })} />
                    </div>)}
                  </div>
                </fieldset>)}
              </TabsContent>
            </fieldset>
          </CardContent>
        </Card>
      </Tabs>
      {canEdit && (hasChanges || message) && <div className="mt-4 flex flex-wrap items-center gap-3">
        {hasChanges && <>
          <Button type="submit" disabled={busy || preparingImage}>{t(preparingImage ? 'Preparing image…' : 'Save changes')}</Button>
          <Button type="button" variant="outline" disabled={busy || preparingImage} onClick={cancel}>{t('Cancel')}</Button>
        </>}
        {message && (message.error || !hasChanges) && (message.error
          ? <Alert variant="destructive" className="w-fit"><AlertDescription>{t(message.text)}</AlertDescription></Alert>
          : <p className="text-sm text-muted-foreground" role="status">{t(message.text)}</p>)}
      </div>}
    </form>
  </div>;
}

function Workspace() {
  const language = useStudioLanguage();
  const t = useStudioText();
  const [loaded, setLoaded] = useState<{ settings: ExhibitionSettings; games: GameChoice[] }>();
  const [error, setError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void Promise.all([loadExhibitionSettings(exhibitionId), getDocsFromServer(collection(db, 'games'))]).then(([settings, games]) => {
      const choices = games.docs.map(item => {
        const title = String(item.data().title ?? item.id);
        const defaultPin = defaultExhibitionPin(item.id, title);
        const pin = exhibitionPins[defaultPin];
        const english = englishGameTitles.get(normalizeExhibitionGameTitle(title)) ?? pin?.en ?? title;
        const searchTitles = [title, ...english.split(' / '), pin?.ko ?? ''].map(normalizeExhibitionGameTitle);
        const korean = /\p{Script=Hangul}/u.test(title) ? title : pin?.ko ?? title;
        return { id: item.id, defaultPin, names: { ko: korean, en: english }, searchTitles };
      });
      if (!cancelled) setLoaded({ settings: settings ?? empty, games: choices });
    }).catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, []);
  const games = useMemo(() => [...(loaded?.games ?? [])].sort((a, b) =>
    a.names[language].localeCompare(b.names[language], language)), [loaded, language]);
  if (error) return <Alert variant="destructive"><AlertDescription>{t('Could not load settings. Check your connection and permissions.')}</AlertDescription></Alert>;
  return loaded ? <Settings initial={loaded.settings} games={games} />
    : <p className="text-sm text-muted-foreground" role="status">{t('Loading settings…')}</p>;
}

function Studio({ onLanguageChange }: { onLanguageChange: (language: StudioLanguage) => void }) {
  const language = useStudioLanguage();
  const t = useStudioText();
  const [session, setSession] = useState<{ user: User | null; allowed: boolean }>();
  const [signInError, setSignInError] = useState(false);
  useEffect(() => {
    let epoch = 0;
    const unsubscribe = onAuthStateChanged(auth, async user => {
      const request = ++epoch;
      if (!user?.email) { setSession({ user, allowed: false }); return; }
      setSession(undefined);
      try {
        const result = await checkAdminStatus(user.email);
        if (request === epoch) setSession({ user, allowed: result.isAdmin });
      } catch {
        if (request === epoch) setSession({ user, allowed: false });
      }
    });
    return () => { epoch++; unsubscribe(); };
  }, []);

  return <>
    <header className="border-b bg-card">
      <div className="mx-auto grid max-w-5xl gap-x-3 gap-y-2 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:px-8">
        <div className="flex items-center gap-3 self-start">
          <img src="/brand/studio-light.svg" alt="" className="size-9 shrink-0" />
          <h1 className="text-base font-semibold tracking-tight sm:text-lg">AVALON Studio</h1>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-1">
          <div role="group" aria-label={t('Studio language')} className="flex shrink-0 items-center rounded-md border p-0.5">
            {(['ko', 'en'] as const).map(option => <Button key={option} type="button" size="xs"
              className="h-6 w-[3.1rem] px-0 text-[11px]"
              variant={language === option ? 'secondary' : 'ghost'} aria-pressed={language === option}
              lang={option} onClick={() => onLanguageChange(option)}>{option === 'ko' ? '한국어' : 'English'}</Button>)}
          </div>
          <Button asChild variant="ghost"><a href="https://avalon-collection.web.app/" target="_blank" rel="noreferrer">{t('View Collection')} <ArrowUpRight aria-hidden="true" /></a></Button>
          {session?.user && <Button type="button" variant="ghost" onClick={() => void logout()}><LogOut aria-hidden="true" /> {t('Sign out')}</Button>}
        </div>
      </div>
    </header>
    <main className="mx-auto max-w-5xl px-4 py-7 sm:px-8 sm:py-10">
      {!session ? <p className="text-sm text-muted-foreground" role="status">{t('Checking access…')}</p>
        : session.user && session.allowed ? <Workspace key={session.user.uid} />
          : session.user ? <Alert variant="destructive"><AlertDescription>{t('Admin access is required.')}</AlertDescription></Alert>
            : <Card className="mx-auto max-w-sm shadow-none">
              <CardHeader><CardTitle>{t('Sign in to Studio')}</CardTitle><CardDescription>{t('Use your Avalon admin account.')}</CardDescription></CardHeader>
              <CardContent className="grid gap-3">
                <Button type="button" onClick={() => {
                  setSignInError(false);
                  void signInWithGoogle().catch(() => setSignInError(true));
                }}>{t('Sign in with Google')}</Button>
                {signInError && <Alert variant="destructive"><AlertDescription>{t('Could not sign in. Try again.')}</AlertDescription></Alert>}
              </CardContent>
            </Card>}
    </main>
  </>;
}

function App() {
  const [language, setLanguage] = useState<StudioLanguage>(() => {
    try { return localStorage.getItem(studioLanguageKey) === 'ko' ? 'ko' : 'en'; }
    catch { return 'en'; }
  });
  useEffect(() => {
    document.documentElement.lang = language;
    try { localStorage.setItem(studioLanguageKey, language); } catch { /* Selection still applies to this tab. */ }
  }, [language]);
  return <StudioLanguageContext.Provider value={language}>
    <Studio onLanguageChange={setLanguage} />
  </StudioLanguageContext.Provider>;
}

createRoot(document.getElementById('root')!).render(<App />);
