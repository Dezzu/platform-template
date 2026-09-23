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
import { TextInputComponent, TextareaInputComponent } from '@app/ui/input';
import { ToastService } from '@app/core';
import { AdminApi } from './admin.api';
import { AdminNavComponent } from './admin-nav.component';

/** What the form edits. Flat and free of nulls: an input binds to a value. */
interface FlagForm {
  key: string;
  description: string;
  enabled: boolean;
}

const BLANK: FlagForm = { key: '', description: '', enabled: false };

/**
 * Declaring and configuring one flag — a page, not a modal, like every other form here.
 *
 * The key is editable only while creating. Renaming a flag would leave every
 * `@RequireFeature('old.name')` and every menu entry pointing at a key that no longer
 * exists, and since an unknown key resolves to *off*, the feature would quietly
 * disappear for everyone rather than fail loudly. Delete and recreate instead.
 *
 * There is nothing else to configure. The rollout percentage and the per-customer
 * exceptions that used to live here are gone — a flag is one switch, and what it means
 * is "this feature is released" or "this feature is not".
 */
@Component({
  selector: 'app-admin-flag-form-page',
  imports: [
    TranslocoPipe,
    RouterLink,
    FormField,
    TextInputComponent,
    TextareaInputComponent,
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
        }
      : BLANK;
  });

  protected readonly flag = form(this.model, (path) => {
    /**
     * The key is validated only while creating, because that is the only time it can
     * be typed — and validating a field nobody can reach is how a form ends up
     * permanently invalid with nothing on screen to explain it.
     *
     * That is not hypothetical: `notifications.inApp` failed the old lowercase-only
     * pattern, so its edit page refused to save and the button simply did nothing. The
     * pattern has been corrected too, but the structure is what makes it impossible to
     * happen again for the next key that predates a rule.
     */
    if (!this.editing) {
      required(path.key);
      maxLength(path.key, 100);
      // The same shape the contract enforces. A form that accepts more than the API
      // does refuses the work only after the user has done it.
      pattern(path.key, FLAG_KEY_PATTERN);
    }

    maxLength(path.description, 500);
  });

  protected async save(event: Event): Promise<void> {
    event.preventDefault();
    if (this.flag().invalid() || this.saving()) return;

    this.saving.set(true);
    const { key, description, enabled } = this.model();
    const trimmed = description.trim();

    try {
      if (this.flagKey) {
        await firstValueFrom(
          this.api.updateFlag(this.flagKey, {
            // Empty is not the same as unset: the contract takes null to clear it.
            description: trimmed || null,
            enabled,
          }),
        );
        this.toasts.success('flags.saved', { key: this.flagKey });
      } else {
        await firstValueFrom(
          this.api.createFlag({
            key: key.trim(),
            description: trimmed || null,
            enabled,
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

  protected setEnabled(value: boolean): void {
    this.model.update((current) => ({ ...current, enabled: value }));
  }
}
