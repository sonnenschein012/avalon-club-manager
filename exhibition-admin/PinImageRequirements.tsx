import { useId, useState } from 'react';
import { Info } from 'lucide-react';
import { useStudioText } from './language';
import { Button } from './ui/button';

export function PinImageRequirements() {
  const id = useId();
  const t = useStudioText();
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const visible = pinned || hovered;

  function dismiss() {
    setPinned(false);
    setHovered(false);
  }

  return <div className="relative"
    onPointerEnter={event => { if (event.pointerType === 'mouse') setHovered(true); }}
    onPointerLeave={() => setHovered(false)}
    onKeyDown={event => { if (event.key === 'Escape') dismiss(); }}>
    <Button type="button" variant="ghost" size="icon-xs" aria-label={t('Image requirements')}
      aria-controls={id} aria-expanded={visible}
      onBlur={dismiss} onClick={() => { if (pinned) dismiss(); else setPinned(true); }}>
      <Info aria-hidden="true" />
    </Button>
    <div id={id} hidden={!visible} className="absolute top-full left-0 z-10 w-[min(18rem,calc(100vw-6rem))] pt-1">
      <div className="grid gap-1.5 rounded-md border bg-popover p-3 text-xs leading-relaxed text-popover-foreground shadow-md">
        <p className="font-semibold">{t('Image requirements')}</p>
        <ul className="grid list-disc gap-1 pl-4">
          <li>{t('PNG, JPEG or WebP, up to 16 MB.')}</li>
          <li>{t('For a clear pin, use a transparent PNG or WebP. Center the artwork and keep margins small.')}</li>
          <li>{t('Studio converts uploads to WebP and reduces the longest side to at most 512 px.')}</li>
        </ul>
      </div>
    </div>
  </div>;
}
