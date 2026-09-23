import {
  lucideChartLine,
  lucideChartNoAxesColumn,
  lucideChevronRight,
  lucideCreditCard,
  lucideFlag,
  lucideFolderKanban,
  lucideFolderOpen,
  lucideHardHat,
  lucideLayoutDashboard,
  lucideLockKeyhole,
  lucideLogOut,
  lucideMoon,
  lucideScrollText,
  lucideSettings,
  lucideShieldCheck,
  lucideSun,
  lucideUser,
  lucideUsers,
} from '@ng-icons/lucide';

/**
 * Every icon referenced by *data* rather than by a template.
 *
 * NAV_MANIFEST and the account menu carry icon names as strings, so the component that
 * renders them cannot import what it needs — the name only exists at runtime. Anything
 * named in those structures has to be registered here, application-wide.
 *
 * An icon that is missing from this map does not fail, it simply renders nothing: the
 * menu entry keeps its label and loses its glyph. `icons.spec.ts` asserts the manifest
 * and this map agree, because a silent blank is not something code review catches.
 *
 * Icons hard-coded inside a component's own template stay with that component, where
 * `provideIcons` sits next to the markup using them.
 */
export const APP_ICONS = {
  lucideChartLine,
  lucideChartNoAxesColumn,
  lucideChevronRight,
  lucideCreditCard,
  lucideFlag,
  lucideFolderKanban,
  lucideFolderOpen,
  lucideHardHat,
  lucideLayoutDashboard,
  lucideLockKeyhole,
  lucideLogOut,
  lucideMoon,
  lucideScrollText,
  lucideSettings,
  lucideShieldCheck,
  lucideSun,
  lucideUser,
  lucideUsers,
} as const;

export type AppIconName = keyof typeof APP_ICONS;
