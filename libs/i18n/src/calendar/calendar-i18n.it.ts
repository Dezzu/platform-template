import { type Provider } from '@angular/core';
import { provideBrnCalendarI18n } from '@spartan-ng/brain/calendar';
// Import the token file directly, NOT the `@spartan-ng/helm/date-picker` barrel:
// quel barrel tira dentro HlmCalendar, HlmPopover e HlmSelect, e questi provider
// vivono nella app config, quindi finirebbero tutti nel bundle iniziale (+196 kB).
// the precise file rather than the component barrel, because going through
// `@spartan-ng/helm/date-picker` tirerebbe dentro calendario e popover, che
// would drag the whole component into the initial bundle for one configuration function.
import { provideHlmDatePickerConfig } from '@spartan-ng/helm/date-picker/src/lib/hlm-date-picker.token';

const LOCALE = 'it-IT';

/**
 * The Spartan calendar does NOT read Angular's `LOCALE_ID`: it is localized only
 * through `provideBrnCalendarI18n`, which defaults to English with the week
 * che parte di domenica. Questa configurazione lo porta in italiano.
 */
const weekdayFormat = new Intl.DateTimeFormat(LOCALE, { weekday: 'short' });
const weekdayLongFormat = new Intl.DateTimeFormat(LOCALE, { weekday: 'long' });
const monthShortFormat = new Intl.DateTimeFormat(LOCALE, { month: 'short' });
const monthLongFormat = new Intl.DateTimeFormat(LOCALE, { month: 'long', year: 'numeric' });

/** 2024-01-07 is a Sunday: adding the index yields the wanted weekday. */
const weekdaySample = (index: number) => new Date(2024, 0, 7 + index);
const monthSample = (month: number) => new Date(2000, month, 1);

const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
/** Intl in italiano restituisce "gen." / "lun": via il punto finale. */
const trimDot = (value: string) => value.replace(/\.$/, '');

export function provideCalendarItalian(): Provider {
  return provideBrnCalendarI18n({
    formatWeekdayName: (index) => capitalize(trimDot(weekdayFormat.format(weekdaySample(index)))),
    labelWeekday: (index) => capitalize(weekdayLongFormat.format(weekdaySample(index))),
    months: () =>
      Array.from({ length: 12 }, (_, month) =>
        capitalize(trimDot(monthShortFormat.format(monthSample(month)))),
      ) as [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
      ],
    formatMonth: (month) => capitalize(trimDot(monthShortFormat.format(monthSample(month)))),
    formatHeader: (month, year) => capitalize(monthLongFormat.format(new Date(year, month, 1))),
    formatYear: (year) => String(year),
    labelPrevious: () => 'Mese precedente',
    labelNext: () => 'Mese successivo',
    // In Italia la settimana inizia di lunedi'.
    firstDayOfWeek: () => 1,
  });
}

const dateFormat = new Intl.DateTimeFormat(LOCALE, {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

/**
 * The date picker formats with `Date.toDateString()` by default ("Thu Sep 17 2026").
 * This switches it to dd/mm/yyyy with a matching parser.
 */
export function provideDatePickerItalian(): Provider {
  return provideHlmDatePickerConfig<Date>({
    formatDate: (date) => (date instanceof Date ? dateFormat.format(date) : `${date}`),
    formatInputDate: (date) => (date instanceof Date ? dateFormat.format(date) : `${date}`),
    parseDate: (value) => {
      const match = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/.exec(value.trim());
      if (!match) return null;
      const [, day, month, year] = match;
      if (!year || !month || !day) return null;
      const date = new Date(Number(year), Number(month) - 1, Number(day));
      // Reject impossible dates such as 31/02: Date would roll them into the next month.
      const valid =
        date.getFullYear() === Number(year) &&
        date.getMonth() === Number(month) - 1 &&
        date.getDate() === Number(day);
      return valid ? date : null;
    },
  });
}
