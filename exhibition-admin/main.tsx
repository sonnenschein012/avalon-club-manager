import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { collection, getDocsFromServer } from 'firebase/firestore';
import { ArrowUpRight, ClipboardList, Globe2, ImageIcon, LogOut, RefreshCw, Search, Type } from 'lucide-react';
import { auth, checkAdminStatus, db, logout, signInWithGoogle } from '../src/lib/firebase';
import {
  loadExhibitionSettings, loadExhibitionStatus, retryExhibitionRefresh, saveExhibitionSettings,
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
import { contentForGame, type GameChoice, type PinContent } from './pinContent';
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
};
const copyLabels: Record<keyof typeof exhibitionCopy, string> = {
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
  const [year = '', term = '1'] = value.split('-');
  return <div className="grid gap-2" role="group" aria-label={label}>
    <Label>{label}</Label>
    <div className="grid grid-cols-2 gap-2">
      <Input aria-label={label + ' year'} inputMode="numeric" placeholder="Year" maxLength={4} value={year}
        onChange={event => onChange(`${event.target.value.replace(/[^0-9]/g, '')}-${term}`)} />
      <Select value={term} onValueChange={next => onChange(`${year}-${next}`)}>
        <SelectTrigger aria-label={label + ' term'} className="w-full"><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value="1">Semester 1</SelectItem><SelectItem value="2">Semester 2</SelectItem></SelectContent>
      </Select>
    </div>
  </div>;
}

function PinEditor({ games, selected, active, onSelect, content, uploads, onExclusion, onDescription, onImage, onFile }: {
  games: GameChoice[];
  selected: GameChoice | undefined;
  active: boolean;
  onSelect: (game: GameChoice) => void;
  content: PinContent;
  uploads: ReadonlyMap<string, PreparedPinImage>;
  onExclusion: (id: string, excluded: boolean) => void;
  onDescription: (pin: string, text: string | undefined) => void;
  onImage: (pin: string, text: string) => void;
  onFile: (pin: string, file: File) => void;
}) {
  const [search, setSearch] = useState('');
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
      <Label htmlFor="game-search">Find a game</Label>
      <div className="relative max-w-md">
        <Search aria-hidden="true" className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground" />
        <Input id="game-search" type="search" value={search} placeholder="Search by title"
          className="pl-9" onChange={event => setSearch(event.target.value)} />
      </div>
      {query && <div className="flex flex-wrap gap-2" aria-label="Search results">
        {matches.length === 0 && <p className="text-sm text-muted-foreground" role="status">No games found.</p>}
        {matches.slice(0, 12).map(game => <Button type="button" key={game.id}
          variant={selected?.id === game.id ? 'default' : 'outline'} aria-pressed={selected?.id === game.id}
          onClick={() => { onSelect(game); setBrokenImage(undefined); }}>{game.displayName}</Button>)}
        {matches.length > 12 && <p className="w-full text-sm text-muted-foreground">Type more to narrow the results.</p>}
      </div>}
    </div>
    {selected && pin && <div className="grid gap-6 min-[680px]:grid-cols-[minmax(0,1fr)_minmax(0,15rem)]">
      <div className="grid gap-4">
        <h3 ref={editHeading} tabIndex={-1} className="text-base font-semibold">{selected.displayName}</h3>
        <div className="grid gap-2">
          <Label htmlFor="pin-description">Pin description</Label>
          <Textarea id="pin-description" rows={4} maxLength={500}
            value={pin.description} onChange={event => onDescription(pin.gameKey, event.target.value)} />
          {pin.defaultDescription && pin.description !== pin.defaultDescription &&
            <Button className="justify-self-start px-0" type="button" variant="link" size="sm"
              onClick={() => onDescription(pin.gameKey, undefined)}>Restore default description</Button>}
        </div>
        <div className="grid gap-2">
          <span className="text-sm font-medium">Pin image</span>
          <p className="text-sm text-muted-foreground" role="status">{imageStatus}</p>
          <input hidden ref={fileInput} id="pin-file" type="file" accept="image/png,image/jpeg,image/webp" onChange={event => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            if (file) { setBrokenImage(undefined); onFile(pin.gameKey, file); }
          }} />
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => fileInput.current?.click()}>
              {pin.hasImage ? 'Replace image' : 'Choose image'}
            </Button>
            {content.images[pin.gameKey] && <Button type="button" variant="ghost" onClick={() => onImage(pin.gameKey, '')}>Remove custom image</Button>}
          </div>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="pin-image">Custom image URL</Label>
          <Input id="pin-image" inputMode="url" maxLength={400} placeholder="https://"
            value={isExhibitionImageUpload(content.images[pin.gameKey]) ? '' : content.images[pin.gameKey] ?? exhibitionImageUrl(imageConfig) ?? ''}
            onChange={event => { setBrokenImage(undefined); onImage(pin.gameKey, event.target.value); }} />
        </div>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input type="checkbox" checked={pin.excluded} onChange={event => onExclusion(selected.id, event.target.checked)} />
          Exclude this game from the exhibit
        </label>
      </div>
      <Card className="self-start border-dashed bg-muted/50 py-4 shadow-none">
        <CardHeader className="px-4"><CardTitle className="text-sm">Pin preview</CardTitle></CardHeader>
        <CardContent className="grid min-h-32 place-items-center px-4 text-center text-sm text-muted-foreground">
          {image && brokenImage !== image ? <img className="max-h-48 w-full object-contain" src={image}
            referrerPolicy="no-referrer" alt={selected.displayName + ' pin'} onError={() => setBrokenImage(image)} />
            : <p>{imageFailed ? 'Image could not load.' : uploaded ? 'Loading saved image…' : 'No image for this pin.'}</p>}
        </CardContent>
      </Card>
    </div>}
  </div>;
}

function Settings({ initial, games }: { initial: ExhibitionSettings; games: GameChoice[] }) {
  const [section, setSection] = useState<Section>(() => {
    const hash = window.location.hash.slice(1);
    return Object.hasOwn(sections, hash) ? hash as Section : 'publication';
  });
  const [visibility, setVisibility] = useState<ExhibitionVisibility>(initial.visibility ?? (initial.enabled ? 'public' : 'private'));
  const [schedule, setSchedule] = useState(initial.schedule ?? { start: '', end: '' });
  const [savedPublication, setSavedPublication] = useState({ visibility, schedule });
  const initialPeriod = getEditorPeriod(initial.period);
  const [periodKind, setPeriodKind] = useState(initialPeriod.kind);
  const [semesterRange, setSemesterRange] = useState<PeriodRange>(() => initialPeriod.kind === 'semesterRange' ? initialPeriod : { start: '', end: '' });
  const [dateRange, setDateRange] = useState<PeriodRange>(() => initialPeriod.kind === 'range' ? initialPeriod : { start: '', end: '' });
  const [mapping, setMapping] = useState(new Map(initial.gameMapping.map(item => [item.sourceId, item.pinId])));
  const [descriptions, setDescriptions] = useState(initial.descriptions ?? {});
  const [images, setImages] = useState(initial.images ?? {});
  const [savedPins, setSavedPins] = useState<PinContent>({ mapping, descriptions, images });
  const [selectedGame, setSelectedGame] = useState<GameChoice>();
  const [uploads, setUploads] = useState(new Map<string, PreparedPinImage>());
  const [preparingImage, setPreparingImage] = useState(false);
  const [copy, setCopy] = useState<ExhibitionCopy>(initial.copy ?? {});
  const [sync, setSync] = useState<ExhibitionSyncStatus>('idle');
  const [status, setStatus] = useState<Awaited<ReturnType<typeof loadExhibitionStatus>>>();
  const [message, setMessage] = useState<{ text: string; error?: boolean }>();
  const [busy, setBusy] = useState(false);

  const [syncFailure, setSyncFailure] = useState<ExhibitionSyncError | null>(null);
  const requestSync = useRef<() => void>(() => {});
  useEffect(() => {
    const watcher = watchExhibitionSync(setSync, setSyncFailure, 'requests');
    requestSync.current = watcher.request;
    return watcher.stop;
  }, []);
  useEffect(() => {
    let cancelled = false;
    void loadExhibitionStatus(exhibitionId).then(result => { if (!cancelled) setStatus(result); })
      .catch(() => { if (!cancelled) setStatus(undefined); });
    return () => { cancelled = true; };
  }, [sync, busy]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
    if (preparingImage) return;
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
    const clean = (values: Record<string, string | undefined>) =>
      Object.fromEntries(Object.entries(values).flatMap(([key, value]) => value?.trim() ? [[key, value.trim()]] : []));
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
        ...(visibility === 'temporary' ? { schedule } : {}),
        gameMapping: [...mapping].map(([sourceId, pinId]) => ({ sourceId, pinId })),
        descriptions: savedDescriptions, images: savedImages, copy: savedCopy,
      }, ...(uploads.size ? [uploads] as const : []));
      setCopy(savedCopy);
      setDescriptions(savedDescriptions);
      setImages(savedImages);
      setSavedPins({ mapping, descriptions: savedDescriptions, images: savedImages });
      setUploads(new Map());
      setSavedPublication({ visibility, schedule });
      setMessage({ text: 'Changes saved.' });
      if (needsSync) {
        setMessage({ text: 'Changes saved. Updating records…' });
        requestSync.current();
      }
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
      setMessage({ text: error instanceof Error ? error.message : 'Could not prepare this image.', error: true });
    } finally { setPreparingImage(false); }
  }

  async function synchronize() {
    setBusy(true);
    try {
      await retryExhibitionRefresh();
      requestSync.current();
      setMessage({ text: 'Publishing records using saved settings.' });
    } catch {
      setMessage({ text: 'Could not start sync. Try again.', error: true });
    } finally {
      setBusy(false);
    }
  }

  const lastSync = status?.lastSyncedAt?.toLocaleString('en-US', { timeZone: 'Asia/Seoul', dateStyle: 'medium', timeStyle: 'short' });
  const savedWindow = savedPublication.visibility === 'temporary' ? exhibitionPublicationWindow(savedPublication.schedule) : null;
  const now = Date.now();
  const publicationLabel = savedPublication.visibility === 'public' ? 'Public'
    : !savedWindow ? 'Private'
      : now < savedWindow.start.getTime() ? 'Scheduled'
        : now >= savedWindow.end.getTime() ? 'Ended' : 'Public · scheduled';
  const syncLabel = sync === 'syncing' ? 'Publishing records…' : sync === 'error' && status?.pending !== false ? 'Publication failed · retrying'
    : status?.pending || (sync === 'pending' && !status) ? 'Publication pending'
    : lastSync ? `Last published: ${lastSync} KST · ${status?.profileCount ?? 0} collections` : 'No records published yet';

  function openSection(next: Section) {
    setSection(next);
    history.replaceState(history.state, '', '#' + next);
  }

  return <div className="grid gap-5">
    {syncFailure && <Alert variant="destructive"><AlertDescription>
      Record publication: {syncFailure.step} ({syncFailure.code})
    </AlertDescription></Alert>}
    <Card className="gap-0 py-4 shadow-none">
      <CardContent className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-5">
        <div className="grid gap-1.5">
          <div className="flex items-center gap-2 text-sm font-semibold">Exhibit status <Badge variant="secondary">{publicationLabel}</Badge></div>
          <p className="text-sm text-muted-foreground" role="status">{syncLabel}</p>
        </div>
        <Button type="button" variant="outline" disabled={busy || sync === 'syncing'} onClick={() => void synchronize()}>
          <RefreshCw className={sync === 'syncing' ? 'motion-safe:animate-spin' : undefined} /> Publish records
        </Button>
      </CardContent>
    </Card>
    <form onSubmit={event => void save(event)}>
      <Tabs value={section} onValueChange={next => openSection(next as Section)} className="gap-4">
        <TabsList aria-label="Exhibit settings" className="grid h-auto! w-full max-w-xl grid-cols-2 gap-1 p-1 sm:grid-cols-4">
          {Object.entries(sections).map(([key, item]) => <TabsTrigger key={key} value={key}
            className="h-10 min-w-0 whitespace-normal px-1.5 text-center leading-tight sm:px-3">
            <item.icon aria-hidden="true" className="hidden sm:block" />{item.label}
          </TabsTrigger>)}
        </TabsList>
        <Card className="shadow-none">
          <CardHeader><CardTitle>{sections[section].label}</CardTitle></CardHeader>
          <CardContent>
            <fieldset disabled={busy || preparingImage} className="min-w-0">
              <TabsContent value="publication" className="grid max-w-2xl gap-5">
                <RadioChoices label="Visibility" items={visibilityOptions} value={visibility} onChange={setVisibility} />
                {visibility === 'temporary' && <>
                  <DateRange startLabel="Publish on" endLabel="Close after" value={schedule} onChange={setSchedule} />
                  <p className="text-sm text-muted-foreground">Both dates are included. All times are KST.</p>
                </>}
                <div className="border-t pt-5">
                  <RadioChoices label="Record range" items={periodOptions} value={periodKind} onChange={setPeriodKind} />
                </div>
                {periodKind === 'semesterRange' && <div className="grid gap-4 sm:grid-cols-2">
                  <SemesterField label="Start semester" value={semesterRange.start} onChange={start => setSemesterRange({ ...semesterRange, start })} />
                  <SemesterField label="End semester" value={semesterRange.end} onChange={end => setSemesterRange({ ...semesterRange, end })} />
                </div>}
                {periodKind === 'range' && <DateRange startLabel="First record date" endLabel="Last record date" value={dateRange} onChange={setDateRange} />}
              </TabsContent>
              <TabsContent value="pins" forceMount className="data-[state=inactive]:hidden">
                <PinEditor games={games} selected={selectedGame} active={section === 'pins'} onSelect={setSelectedGame}
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
                <PinWorklist games={games} saved={savedPins} onEdit={game => {
                  setSelectedGame(game);
                  openSection('pins');
                }} />
              </TabsContent>
              <TabsContent value="copy" className="space-y-6">
                {copyGroups.map(group => <fieldset key={group.title} className="border-b pb-6 last:border-0 last:pb-0">
                  <legend className="mb-4 text-sm font-semibold">{group.title}</legend>
                  <div className="grid gap-4 sm:grid-cols-2">
                    {group.fields.map(key => <div key={key} className="grid gap-2">
                      <Label htmlFor={key}>{copyLabels[key]}</Label>
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
      <div className="mt-4 flex flex-wrap items-center gap-3">
        {section !== 'worklist' && <Button type="submit" disabled={busy || preparingImage}>{preparingImage ? 'Preparing image…' : 'Save changes'}</Button>}
        {message && (message.error
          ? <Alert variant="destructive" className="w-fit"><AlertDescription>{message.text}</AlertDescription></Alert>
          : <p className="text-sm text-muted-foreground" role="status">{message.text}</p>)}
      </div>
    </form>
  </div>;
}

function Workspace() {
  const [loaded, setLoaded] = useState<{ settings: ExhibitionSettings; games: GameChoice[] }>();
  const [error, setError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void Promise.all([loadExhibitionSettings(exhibitionId), getDocsFromServer(collection(db, 'games'))]).then(([settings, games]) => {
      const choices = games.docs.map(item => {
        const title = String(item.data().title ?? item.id);
        const defaultPin = defaultExhibitionPin(item.id, title);
        const pin = exhibitionPins[defaultPin];
        const displayName = englishGameTitles.get(normalizeExhibitionGameTitle(title)) ?? pin?.en ?? title;
        const searchTitles = [title, ...displayName.split(' / '), pin?.ko ?? ''].map(normalizeExhibitionGameTitle);
        return { id: item.id, defaultPin, displayName, searchTitles };
      });
      choices.sort((a, b) => a.displayName.localeCompare(b.displayName, 'en'));
      if (!cancelled) setLoaded({ settings: settings ?? empty, games: choices });
    }).catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, []);
  if (error) return <Alert variant="destructive"><AlertDescription>Could not load settings. Check your connection and permissions.</AlertDescription></Alert>;
  return loaded ? <Settings initial={loaded.settings} games={loaded.games} />
    : <p className="text-sm text-muted-foreground" role="status">Loading settings…</p>;
}

function App() {
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
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-8">
        <div className="flex items-center gap-3">
          <img src="/brand/studio-light.svg" alt="" className="size-9 shrink-0" />
          <h1 className="text-base font-semibold tracking-tight sm:text-lg">AVALON Studio</h1>
        </div>
        <div className="flex flex-wrap gap-1">
          <Button asChild variant="ghost"><a href="https://avalon-collection.web.app/" target="_blank" rel="noreferrer">View Collection <ArrowUpRight aria-hidden="true" /></a></Button>
          {session?.user && <Button type="button" variant="ghost" onClick={() => void logout()}><LogOut aria-hidden="true" /> Sign out</Button>}
        </div>
      </div>
    </header>
    <main className="mx-auto max-w-5xl px-4 py-7 sm:px-8 sm:py-10">
      {!session ? <p className="text-sm text-muted-foreground" role="status">Checking access…</p>
        : session.user && session.allowed ? <Workspace key={session.user.uid} />
          : session.user ? <Alert variant="destructive"><AlertDescription>Admin access is required.</AlertDescription></Alert>
            : <Card className="mx-auto max-w-sm shadow-none">
              <CardHeader><CardTitle>Sign in to Studio</CardTitle><CardDescription>Use your Avalon admin account.</CardDescription></CardHeader>
              <CardContent className="grid gap-3">
                <Button type="button" onClick={() => {
                  setSignInError(false);
                  void signInWithGoogle().catch(() => setSignInError(true));
                }}>Sign in with Google</Button>
                {signInError && <Alert variant="destructive"><AlertDescription>Could not sign in. Try again.</AlertDescription></Alert>}
              </CardContent>
            </Card>}
    </main>
  </>;
}

createRoot(document.getElementById('root')!).render(<App />);
