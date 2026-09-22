import { Component, computed, inject, linkedSignal, resource, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { form, FormField, maxLength, pattern, required } from '@angular/forms/signals';
import { firstValueFrom, merge } from 'rxjs';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmSwitchImports } from '@spartan-ng/helm/switch';
import { FLAG_KEY_PATTERN } from '@app/contracts';
import type { FeatureFlagOverride } from '@app/contracts';
import {
  NumberInputComponent,
  SelectInputComponent,
  TextInputComponent,
  TextareaInputComponent,
} from '@app/ui/input';
import { ToastService } from '@app/core';
import { AdminApi } from './admin.api';
import { AdminNavComponent } from './admin-nav.component';

/** What the form edits. Flat and free of nulls: an input binds to a value. */
interface FlagForm {
  key: string;
  description: string;
  enabled: boolean;
  rolloutPercent: number;
}

/** The inline "add an exception" form. */
interface OverrideForm {
  subject: 'organization' | 'user';
  subjectId: string;
  enabled: boolean;
}

const BLANK: FlagForm = { key: '', description: '', enabled: false, rolloutPercent: 0 };
const BLANK_OVERRIDE: OverrideForm = { subject: 'organization', subjectId: '', enabled: true };

/**
 * Declaring and configuring one flag — a page, not a modal, like every other form here.
 *
 * The key is editable only while creating. Renaming a flag would leave every
 * `@RequireFeature('old.name')` and every menu entry pointing at a key that no longer
 * exists, and since an unknown key resolves to *off*, the feature would quietly
 * disappear for everyone rather than fail loudly. Delete and recreate instead.
 *
 * The exceptions live on this page rather than on a screen of their own: an override
 * only means anything next to the global value it contradicts.
 */
@Component({
  selector: 'app-admin-flag-form-page',
  imports: [
    TranslocoPipe,
    RouterLink,
    FormField,
    TextInputComponent,
    TextareaInputComponent,
    SelectInputComponent,
    NumberInputComponent,
    HlmButtonImports,
    HlmCardImports,
    HlmSwitchImports,
    AdminNavComponent,
  ],
  templateUrl: './admin-flag-form.page.html',
})
export class AdminFlagFormPage {
  private readonly api = inject(AdminApi);
  private readonly router = inject(Router);
  private readonly transloco = inject(TranslocoService);
  private readonly toasts = inject(ToastService);

  /** See admin-users.page.ts: `langChanges$` alone misses the first load. */
  private readonly translations = toSignal(
    merge(this.transloco.langChanges$, this.transloco.events$),
  );

  /**
   * Null on the create route. Read from the URL rather than from state, so a reload
   * lands on the same flag.
   */
  private readonly routeKey = inject(ActivatedRoute).snapshot.paramMap.get('key');
  protected readonly flagKey = this.routeKey === 'new' ? null : this.routeKey;
  protected readonly editing = this.flagKey !== null;

  private readonly existing = resource({
    params: () => this.flagKey,
    loader: ({ params }) =>
      params ? firstValueFrom(this.api.getFlag(params)) : Promise.resolve(null),
  });

  protected readonly loading = computed(() => this.existing.isLoading());
  protected readonly failed = computed(() => this.existing.error() !== undefined);
  protected readonly saving = signal(false);

  /**
   * `linkedSignal` rather than an effect writing into a plain signal: the model follows
   * the loaded flag until somebody types, and then it is theirs. An effect would race
   * the first keystroke and overwrite it.
   */
  protected readonly model = linkedSignal<FlagForm>(() => {
    if (!this.existing.hasValue()) return BLANK;
    const flag = this.existing.value();
    return flag
      ? {
          key: flag.key,
          description: flag.description ?? '',
          enabled: flag.enabled,
          rolloutPercent: flag.rolloutPercent,
        }
      : BLANK;
  });

  protected readonly flag = form(this.model, (path) => {
    required(path.key);
    maxLength(path.key, 100);
    // The same shape the contract enforces. A form that accepts more than the API does
    // refuses the work only after the user has done it.
    pattern(path.key, FLAG_KEY_PATTERN);
    maxLength(path.description, 500);
  });

  // ── The exceptions ────────────────────────────────────────────────────────────

  private readonly overridesResource = resource({
    params: () => this.flagKey,
    loader: ({ params }) =>
      params ? firstValueFrom(this.api.listFlagOverrides(params)) : Promise.resolve([]),
  });

  protected readonly overrides = computed<FeatureFlagOverride[]>(() =>
    this.overridesResource.hasValue() ? this.overridesResource.value() : [],
  );
  protected readonly overridesFailed = computed(() => this.overridesResource.error() !== undefined);

  protected readonly overrideModel = signal<OverrideForm>(BLANK_OVERRIDE);
  protected readonly overrideForm = form(this.overrideModel, (path) => {
    required(path.subjectId);
  });
  protected readonly addingOverride = signal(false);

  protected readonly subjectOptions = computed(() => {
    this.translations();
    return (['organization', 'user'] as const).map((subject) => ({
      value: subject,
      label: this.transloco.translate(`flags.subject.${subject}`),
    }));
  });

  /** How an override names its subject: the readable half, with the id as the fallback. */
  protected subjectLabel(override: FeatureFlagOverride): string {
    return (
      override.organizationName ??
      override.userEmail ??
      override.organizationId ??
      override.userId ??
      '—'
    );
  }

  /**
   * `(submit)` with an explicit preventDefault, not `(ngSubmit)`.
   *
   * `ngSubmit` is an output of NgForm, which only exists with FormsModule. With Signal
   * Forms there is no NgForm on the element, the binding attaches to nothing, and the
   * browser performs a native GET submit — putting every field in the query string.
   */
  protected async save(event: Event): Promise<void> {
    event.preventDefault();
    if (this.flag().invalid() || this.saving()) return;

    this.saving.set(true);
    const { key, description, enabled, rolloutPercent } = this.model();
    const trimmed = description.trim();

    try {
      if (this.flagKey) {
        await firstValueFrom(
          this.api.updateFlag(this.flagKey, {
            // Empty is not the same as unset: the contract takes null to clear it.
            description: trimmed || null,
            enabled,
            rolloutPercent,
          }),
        );
        this.toasts.success('flags.saved', { key: this.flagKey });
      } else {
        await firstValueFrom(
          this.api.createFlag({
            key: key.trim(),
            description: trimmed || null,
            enabled,
            rolloutPercent,
          }),
        );
        this.toasts.success('flags.created', { key: key.trim() });
      }
      await this.router.navigateByUrl('/admin/flags');
    } catch (error: unknown) {
      // Stay on the page: the work is in these fields and navigating away loses it.
      this.saving.set(false);
      this.toasts.error(error);
    }
  }

  protected async addOverride(event: Event): Promise<void> {
    event.preventDefault();
    const key = this.flagKey;
    if (!key || this.overrideForm().invalid() || this.addingOverride()) return;

    this.addingOverride.set(true);
    const { subject, subjectId, enabled } = this.overrideModel();
    const id = subjectId.trim();

    try {
      await firstValueFrom(
        this.api.setFlagOverride(key, {
          ...(subject === 'organization' ? { organizationId: id } : { userId: id }),
          enabled,
        }),
      );
      this.overrideModel.set(BLANK_OVERRIDE);
      /**
       * Clears touched and dirty as well as the value. Without it the emptied field is
       * still "touched", so `required` fires and a form that has just succeeded paints
       * its own label red — which reads as the save having failed.
       */
      this.overrideForm().reset();
      this.overridesResource.reload();
      this.existing.reload();
      this.toasts.success('flags.overrideSaved');
    } catch (error: unknown) {
      this.toasts.error(error);
    } finally {
      this.addingOverride.set(false);
    }
  }

  protected removeOverride(override: FeatureFlagOverride): void {
    const key = this.flagKey;
    if (!key) return;

    void (async () => {
      try {
        await firstValueFrom(this.api.deleteFlagOverride(key, override.id));
        this.overridesResource.reload();
        this.existing.reload();
        this.toasts.success('flags.overrideRemoved');
      } catch (error: unknown) {
        this.toasts.error(error);
      }
    })();
  }

  /** The switch is a control without a form field binding; it writes into the model. */
  protected setEnabled(value: boolean): void {
    this.model.update((current) => ({ ...current, enabled: value }));
  }

  protected setOverrideEnabled(value: boolean): void {
    this.overrideModel.update((current) => ({ ...current, enabled: value }));
  }
}
