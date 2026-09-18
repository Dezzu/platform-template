import { Component, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideIcons } from '@ng-icons/core';
import { lucideFolder, lucideHouse } from '@ng-icons/lucide';
import { beforeEach, describe, expect, it } from 'vitest';
import { HlmSidebarService } from '@spartan-ng/helm/sidebar';
import { provideI18n } from '@app/i18n';
import { AppShellComponent, type ShellNavSection } from './app-shell.component';

const SECTIONS: ShellNavSection[] = [
  {
    // No heading: whatever sits above the first divider is the product itself.
    id: 'main',
    items: [
      { id: 'dashboard', labelKey: 'nav.dashboard', icon: 'lucideHouse', route: '/dashboard' },
    ],
  },
  {
    id: 'workspace',
    labelKey: 'nav.sections.workspace',
    items: [{ id: 'projects', labelKey: 'nav.projects', icon: 'lucideFolder', route: '/projects' }],
  },
];

@Component({
  imports: [AppShellComponent],
  template: `
    <dui-app-shell appName="Test" [sections]="sections">
      <span shellHeaderEnd data-testid="header-end">account</span>
      <p data-testid="content">contenuto</p>
    </dui-app-shell>
  `,
})
class Host {
  readonly sections = SECTIONS;
}

describe('AppShellComponent sections', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        provideI18n('it'),
        provideIcons({ lucideHouse, lucideFolder }),
      ],
    });
    localStorage.clear();
  });

  const build = () => {
    const fixture = TestBed.createComponent(Host);
    return fixture;
  };

  const labelButton = (fixture: { nativeElement: unknown }) =>
    (fixture.nativeElement as HTMLElement).querySelector(
      '[data-slot="sidebar-group-label"], button[hlmsidebargrouplabel]',
    ) as HTMLButtonElement | null;

  it('starts with every section open', async () => {
    const fixture = build();
    await fixture.whenStable();

    // A menu that opens empty helps nobody.
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Progetti');
  });

  it('closes a section when its heading is pressed, and remembers it', async () => {
    const fixture = build();
    await fixture.whenStable();

    const heading = labelButton(fixture);
    expect(heading).not.toBeNull();
    expect(heading?.getAttribute('aria-expanded')).toBe('true');

    heading?.click();
    await fixture.whenStable();

    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('Progetti');
    expect(labelButton(fixture)?.getAttribute('aria-expanded')).toBe('false');
    // Persisted, so it survives the reload that would otherwise undo it every time.
    expect(localStorage.getItem('dui-menu-collapsed')).toContain('workspace');
  });

  it('forces a closed section open while the sidebar is icon-only', async () => {
    const fixture = build();
    await fixture.whenStable();

    labelButton(fixture)?.click();
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('Progetti');

    // In icon mode the headings are hidden, and with them the only control that could
    // reopen a section: entries nobody can reach, and no way to find out why.
    TestBed.inject(HlmSidebarService).setOpen(false);
    await fixture.whenStable();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Progetti');
  });

  it('leaves the entries that belong to no section alone', async () => {
    const fixture = build();
    await fixture.whenStable();

    labelButton(fixture)?.click();
    await fixture.whenStable();

    // Nothing to click above them, so nothing may hide them.
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Dashboard');
  });
});

describe('AppShellComponent', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    // The collapsed sections are persisted, so a case that closed one leaks into
    // whatever runs next unless the store is cleared between them.
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        provideI18n('it'),
        // The shell renders icons named as data, so they have to be registered by
        // whoever hosts it — see apps/app/src/app/icons.ts.
        provideIcons({ lucideHouse, lucideFolder }),
      ],
    });
  });

  async function render() {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  it('renders one link per visible item, translated', async () => {
    const el = await render();
    const links = el.querySelectorAll('hlm-sidebar a[href]');

    expect(links).toHaveLength(2);
    expect(links[0]?.getAttribute('href')).toBe('/dashboard');
    expect(el.querySelector('hlm-sidebar')?.textContent).toContain('Progetti');
  });

  it('actually draws the icons, not just their labels', async () => {
    const el = await render();

    // A name with no registered icon renders nothing at all: the entry keeps its label
    // and quietly loses its glyph, which no type check and no review would notice.
    const svgs = el.querySelectorAll('hlm-sidebar ng-icon svg');
    expect(svgs.length).toBeGreaterThanOrEqual(2);
  });

  it('collapses to icons, which is what makes the rail and tooltips worth having', async () => {
    const el = await render();
    expect(el.querySelector('hlm-sidebar')?.getAttribute('collapsible')).toBe('icon');
  });

  it('projects the account control into the header', async () => {
    const el = await render();
    expect(el.querySelector('header [data-testid="header-end"]')).not.toBeNull();
  });

  it('puts nothing about the session in the header itself', async () => {
    const el = await render();

    // Everything to do with the signed-in person lives in one control in the corner.
    // A sign-out button loose in the header is both easy to hit by accident and a
    // second place that has to know about sessions.
    const projected = el.querySelector('[data-testid="header-end"]');
    const shellButtons = [...el.querySelectorAll('header button')].filter(
      (button) => !projected?.contains(button),
    );

    // Only the sidebar trigger belongs to the shell.
    expect(shellButtons).toHaveLength(1);
    expect(shellButtons[0]?.hasAttribute('hlmSidebarTrigger')).toBe(true);
  });

  it('renders the routed content', async () => {
    const el = await render();
    expect(el.querySelector('main [data-testid="content"]')?.textContent).toBe('contenuto');
  });
});
