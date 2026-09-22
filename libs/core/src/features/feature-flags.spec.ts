import { Component, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { FeatureFlagsService } from './feature-flags.service';
import { IfFlagDirective } from './if-flag.directive';

@Component({
  selector: 'app-flag-host',
  imports: [IfFlagDirective],
  template: `<p *appIfFlag="'teams.beta'">visible</p>`,
})
class FlagHost {}

describe('FeatureFlagsService', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  });

  it('answers what the server resolved', () => {
    const flags = TestBed.inject(FeatureFlagsService);
    flags.set({ 'teams.beta': true, 'billing.enabled': false });

    expect(flags.enabled('teams.beta')).toBe(true);
    expect(flags.enabled('billing.enabled')).toBe(false);
  });

  it('treats an unknown key as off', () => {
    const flags = TestBed.inject(FeatureFlagsService);
    flags.set({ 'teams.beta': true });

    /**
     * The safe reading of "never heard of this flag" is "not for you". A typo in a
     * guard must not open a feature, and this matches what the API does — so the two
     * cannot disagree about a name one of them has not seen yet.
     */
    expect(flags.enabled('teams.beta.v2')).toBe(false);
    expect(flags.enabled('')).toBe(false);
  });

  it('forgets everything on sign-out', () => {
    const flags = TestBed.inject(FeatureFlagsService);
    flags.set({ 'teams.beta': true });
    flags.clear();

    // The next account is a different person: keeping the previous answer would show
    // them a feature nobody granted them.
    expect(flags.enabled('teams.beta')).toBe(false);
  });
});

describe('*appIfFlag', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  });

  it('renders nothing while the flag is off, and appears when it is turned on', async () => {
    const flags = TestBed.inject(FeatureFlagsService);
    flags.set({ 'teams.beta': false });

    const fixture = TestBed.createComponent(FlagHost);
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('visible');

    flags.set({ 'teams.beta': true });
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('visible');
  });
});
