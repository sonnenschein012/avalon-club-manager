import { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { contentForGame, type GameChoice, type PinContent } from './pinContent';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { useStudioLanguage, useStudioText } from './language';

export function PinWorklist({ games, saved, publishedKeys, failed, onRetry, onEdit }: {
  games: GameChoice[];
  saved: PinContent;
  publishedKeys: readonly string[] | undefined;
  failed: boolean;
  onRetry: () => void;
  onEdit: (game: GameChoice) => void;
}) {
  const [filter, setFilter] = useState<'all' | 'image' | 'description'>('all');
  const [scope, setScope] = useState<'published' | 'catalog'>('published');
  const language = useStudioLanguage();
  const t = useStudioText();
  const published = new Set(publishedKeys);
  const entries = games.flatMap(game => {
    const { gameKey, excluded, hasImage, hasDescription } = contentForGame(game, saved);
    const included = scope === 'published' ? published.has(gameKey) : !excluded;
    return !included || (hasImage && hasDescription) ? [] : [{ game, hasImage, hasDescription }];
  });
  const filters = [
    ['all', 'All', entries.length],
    ['image', 'Missing image', entries.filter(entry => !entry.hasImage).length],
    ['description', 'Missing description', entries.filter(entry => !entry.hasDescription).length],
  ] as const;
  const visible = entries.filter(entry => filter === 'all' || (filter === 'image' ? !entry.hasImage : !entry.hasDescription));
  return <div className="grid gap-4">
    <div className="flex flex-wrap gap-2" aria-label={t('Worklist scope')}>
      {([['published', 'In published records'], ['catalog', 'All catalog games']] as const).map(([value, label]) =>
        <Button type="button" key={value} size="sm" variant={scope === value ? 'default' : 'outline'}
          aria-pressed={scope === value} onClick={() => setScope(value)}>{t(label)}</Button>)}
    </div>
    {scope === 'published' && publishedKeys === undefined ? <div className="flex flex-wrap items-center gap-2">
      <p className="text-sm text-muted-foreground" role={failed ? 'alert' : 'status'}>
        {t(failed ? 'Could not load games in the published records.' : 'Loading games in the published records…')}
      </p>
      {failed && <Button type="button" size="sm" variant="outline" onClick={onRetry}>{t('Try again')}</Button>}
    </div> : scope === 'published' && publishedKeys?.length === 0 ?
      <p className="text-sm text-muted-foreground" role="status">{t('No games in the published records.')}</p> : <>
    <p className="text-sm text-muted-foreground">{t('Games with missing pin content. Counts update when changes are saved.')}</p>
    <div className="flex flex-wrap gap-2" aria-label={t('Filter games needing attention')}>
      {filters.map(([value, label, count]) => <Button type="button" key={value}
        size="sm" variant={filter === value ? 'default' : 'outline'} aria-pressed={filter === value}
        onClick={() => setFilter(value)}>{t(label)} <span>{count}</span></Button>)}
    </div>
    {visible.length ? <ul className="max-h-[52vh] divide-y overflow-auto rounded-md border">
      {visible.map(({ game, hasImage, hasDescription }) => <li key={game.id}>
        <Button type="button" variant="ghost" className="h-auto min-h-11 w-full justify-between rounded-none px-3 py-2 text-left whitespace-normal"
          onClick={() => onEdit(game)}>
          <span className="min-w-0 wrap-break-word">{game.names[language]}</span>
          <span className="flex flex-wrap items-center justify-end gap-1">
            {!hasImage && <Badge variant="outline">{t('Missing image')}</Badge>}
            {!hasDescription && <Badge variant="outline">{t('Missing description')}</Badge>}
            <ArrowRight aria-hidden="true" />
          </span>
        </Button>
      </li>)}
    </ul> : <p className="py-4 text-sm text-muted-foreground" role="status">{t('No games need attention in this filter.')}</p>}
    </>}
  </div>;
}
