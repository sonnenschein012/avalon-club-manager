import { useId, useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { ko } from 'react-day-picker/locale';
import { exhibitionPublicationWindow, type ExhibitionSchedule } from '../src/domain/exhibition/presentation';
import { koreaDateKey } from '../src/domain/shared/koreaDate';
import { Button } from './ui/button';
import { Calendar } from './ui/calendar';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from './ui/dialog';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { useStudioLanguage, useStudioText } from './language';

function parseDate(date: string) {
  return exhibitionPublicationWindow({ start: date, end: date }) ? parseISO(date) : undefined;
}

function DateField({ label, value, minimum, onChange }: {
  label: string;
  value: string;
  minimum?: string;
  onChange: (date: string) => void;
}) {
  const id = useId();
  const language = useStudioLanguage();
  const t = useStudioText();
  const [open, setOpen] = useState(false);
  const selected = parseDate(value);
  const earliest = minimum ? parseDate(minimum) : undefined;

  return <div className="grid gap-2">
    <Label htmlFor={id}>{label}</Label>
    <div className="flex gap-2">
      <Input id={id} value={value} onChange={event => onChange(event.target.value)}
        placeholder="YYYY-MM-DD" maxLength={10} autoComplete="off" className="tabular-nums" />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button type="button" size="icon" variant="outline"
            aria-label={language === 'ko' ? `${label} 선택` : `Choose ${label.toLowerCase()}`}>
            <CalendarDays aria-hidden="true" />
          </Button>
        </DialogTrigger>
        <DialogContent aria-describedby={undefined} closeLabel={t('Close')} className="w-fit max-w-[calc(100vw-1.5rem)] gap-2">
          <DialogHeader><DialogTitle>{label}</DialogTitle></DialogHeader>
          <Calendar mode="single" selected={selected} defaultMonth={selected ?? earliest ?? parseISO(koreaDateKey())}
            {...(language === 'ko' ? { locale: ko, formatters: { formatCaption: (date: Date) => format(date, 'yyyy년 M월') } } : {})}
            {...(earliest ? { disabled: { before: earliest } } : {})}
            onSelect={date => {
              if (!date) return;
              onChange(format(date, 'yyyy-MM-dd'));
              setOpen(false);
            }} />
        </DialogContent>
      </Dialog>
    </div>
  </div>;
}

export function DateRange({ startLabel, endLabel, value, onChange }: {
  startLabel: string;
  endLabel: string;
  value: ExhibitionSchedule;
  onChange: (value: ExhibitionSchedule) => void;
}) {
  return <div className="grid gap-4 sm:grid-cols-2">
    <DateField label={startLabel} value={value.start} onChange={start => onChange({ ...value, start })} />
    <DateField label={endLabel} value={value.end} minimum={value.start} onChange={end => onChange({ ...value, end })} />
  </div>;
}
