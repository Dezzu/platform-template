import { Component, provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { provideI18n } from '@app/i18n';
import { ToasterComponent, type ToastMessage } from './toaster.component';

@Component({
  imports: [ToasterComponent],
  template: `<dui-toaster [toasts]="toasts()" (dismissed)="dismissed.set($event)" />`,
})
class Host {
  readonly toasts = signal<ToastMessage[]>([]);
  readonly dismissed = signal<number | null>(null);
}

function setup() {
  TestBed.configureTestingModule({
    providers: [provideZonelessChangeDetection(), provideI18n('it')],
  });
  return TestBed.createComponent(Host);
}

const root = (fixture: { nativeElement: unknown }) => fixture.nativeElement as HTMLElement;

describe('ToasterComponent', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('translates the key it is handed, with its parameters', async () => {
    const fixture = setup();
    fixture.componentInstance.toasts.set([
      {
        id: 1,
        tone: 'success',
        messageKey: 'admin.verificationQueued',
        params: { email: 'erika@demo.it' },
      },
    ]);
    await fixture.whenStable();

    expect(root(fixture).textContent).toContain('erika@demo.it');
    expect(root(fixture).textContent).not.toContain('admin.verificationQueued');
  });

  it('interrupts for an error and waits its turn for a confirmation', async () => {
    const fixture = setup();
    fixture.componentInstance.toasts.set([
      { id: 1, tone: 'success', messageKey: 'common.save' },
      { id: 2, tone: 'error', messageKey: 'errors.INTERNAL_ERROR' },
    ]);
    await fixture.whenStable();

    const live = [...root(fixture).querySelectorAll('[aria-live]')].map((node) =>
      node.getAttribute('aria-live'),
    );
    // Announcing every success over whatever the reader was hearing makes a screen
    // reader unusable; an error is worth the interruption.
    expect(live).toEqual(['polite', 'assertive']);

    const roles = [...root(fixture).querySelectorAll('[role]')].map((node) =>
      node.getAttribute('role'),
    );
    expect(roles).toContain('status');
    expect(roles).toContain('alert');
  });

  it('reports the toast the reader closed', async () => {
    const fixture = setup();
    fixture.componentInstance.toasts.set([{ id: 7, tone: 'info', messageKey: 'common.save' }]);
    await fixture.whenStable();

    (root(fixture).querySelector('button') as HTMLButtonElement).click();
    await fixture.whenStable();

    // Dismissing is the owner's decision; the component only says it happened.
    expect(fixture.componentInstance.dismissed()).toBe(7);
  });

  it('renders nothing at all when there is nothing to say', async () => {
    const fixture = setup();
    await fixture.whenStable();

    expect(root(fixture).querySelectorAll('[role="status"], [role="alert"]')).toHaveLength(0);
  });
});
