import { Component, computed, DOCUMENT, inject, resource, signal } from '@angular/core';
import { firstValueFrom, merge, type Observable } from 'rxjs';
import { toSignal } from '@angular/core/rxjs-interop';
import { form, FormField, maxLength } from '@angular/forms/signals';
import { DatePipe } from '@angular/common';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { provideIcons } from '@ng-icons/core';
import { lucideDownload } from '@ng-icons/lucide';
import { CONSENT_REGISTRY } from '@app/contracts/consent';
import { PERMISSIONS } from '@app/contracts/permissions';
import type { DeletionRequest, GdprExportRequest } from '@app/contracts';
import { CanDirective, ConsentService, GdprApi, PermissionsService, ToastService } from '@app/core';
import { ConfirmService } from '@app/ui/confirm';
import { TextareaInputComponent } from '@app/ui/input';
import { TableComponent } from '@app/ui/table';
import { TemplateDirective, type TableAction, type TableColumn } from '@app/ui/mix';

/**
 * Privacy and data: the two rights the product has machinery for, plus the cookie
 * choice, on one page.
 *
 * One page rather than three, because they are the same question asked three ways —
 * "what do you have on me, and can I take it back". Somebody looking for any of them
 * looks here, and a product that scatters them across settings tabs is one that hopes
 * they give up.
 *
 * Erasure sits at the bottom, behind a confirmation, and says the date. The thirty
 * days are the feature: an account deleted on a misclick is the one mistake here that
 * cannot be undone.
 */
@Component({
  selector: 'app-privacy-page',
  imports: [
    DatePipe,
    TranslocoPipe,
    HlmButtonImports,
    HlmCardImports,
    TableComponent,
    TemplateDirective,
    TextareaInputComponent,
    FormField,
    CanDirective,
  ],
  providers: [provideIcons({ lucideDownload })],
  templateUrl: './privacy.page.html',
})
export class PrivacyPage {
  private readonly api = inject(GdprApi);
  private readonly permissions = inject(PermissionsService);
  private readonly consent = inject(ConsentService);
  private readonly confirm = inject(ConfirmService);
  private readonly toasts = inject(ToastService);
  private readonly transloco = inject(TranslocoService);
  private readonly document = inject(DOCUMENT);

  protected readonly permissionKeys = PERMISSIONS;

  /** See projects.page.ts: `langChanges$` alone misses the first load. */
  private readonly translations = toSignal(
    merge(this.transloco.langChanges$, this.transloco.events$),
  );

  private readonly exportsResource = resource({
    loader: () => firstValueFrom(this.api.listExports()),
  });

  private readonly deletionsResource = resource({
    loader: () => firstValueFrom(this.api.listDeletionRequests()),
  });

  /** `hasValue()` rather than `value() ?? []`: a resource in error throws from value(). */
  protected readonly exports = computed(() =>
    this.exportsResource.hasValue() ? this.exportsResource.value() : [],
  );
  protected readonly exportsLoading = computed(
    () => this.exportsResource.isLoading() && !this.exportsResource.hasValue(),
  );
  protected readonly exportsFailed = computed(() => this.exportsResource.error() !== undefined);

  protected readonly deletions = computed(() =>
    this.deletionsResource.hasValue() ? this.deletionsResource.value() : [],
  );

  protected readonly accountDeletion = computed(() =>
    this.deletions().find((request) => request.subjectType === 'user'),
  );
  protected readonly organizationDeletion = computed(() =>
    this.deletions().find((request) => request.subjectType === 'organization'),
  );

  /** The organization blocks are pointless in a personal product — see profile.page.ts. */
  protected readonly showsOrganization = computed(() => !this.permissions.personalBilling());

  protected readonly consentDecidedAt = this.consent.decidedAt;
  protected readonly consentSummary = computed(() =>
    CONSENT_REGISTRY.filter((category) => this.consent.allows(category.id)).map(
      (category) => category.labelKey,
    ),
  );

  /**
   * "Why are you leaving", asked once and optional.
   *
   * A Signal Form even for one field, because `reset()` is what clears `touched` along
   * with the value: setting the model back to empty would leave the field dirty and
   * paint the page red at the exact moment the request succeeded. That has already
   * happened twice in this repository.
   */
  private readonly reasonModel = signal({ reason: '' });
  protected readonly reasonForm = form(this.reasonModel, (path) => {
    maxLength(path.reason, 500);
  });

  protected readonly busy = signal(false);

  protected readonly columns = computed<TableColumn[]>(() => {
    this.translations();
    const t = (key: string) => this.transloco.translate(`privacy.exports.columns.${key}`);
    return [
      { field: 'createdAt', header: t('requestedAt'), pipe: 'date', pipeArgs: ['medium'] },
      { field: 'scope', header: t('scope') },
      { field: 'status', header: t('status') },
      { field: 'expiresAt', header: t('expiresAt'), pipe: 'date', pipeArgs: ['medium'] },
    ];
  });

  protected readonly actions = computed<TableAction<GdprExportRequest>[]>(() => {
    this.translations();
    return [
      {
        icon: 'lucideDownload',
        label: this.transloco.translate('privacy.exports.download'),
        // Answered by the server (`downloadable`), not recomputed here: expiry is a
        // comparison against its clock, and a browser an hour off would offer a button
        // that answers 410.
        visible: (row) => row.downloadable,
        command: (row) => void this.download(row),
      },
    ];
  });

  protected asExport(row: unknown): GdprExportRequest {
    return row as GdprExportRequest;
  }

  protected async requestPersonalExport(): Promise<void> {
    await this.run(this.api.requestPersonalExport(), 'privacy.exports.requested', () =>
      this.exportsResource.reload(),
    );
  }

  protected async requestOrganizationExport(): Promise<void> {
    await this.run(this.api.requestOrganizationExport(), 'privacy.exports.requested', () =>
      this.exportsResource.reload(),
    );
  }

  /**
   * Straight to storage, like every other download here: the presigned GET carries
   * `Content-Disposition: attachment`, so pointing the document at it starts the
   * download and leaves the page where it was. See files.page.ts for why no window is
   * opened.
   */
  protected async download(row: GdprExportRequest): Promise<void> {
    try {
      const { url } = await firstValueFrom(this.api.download(row.id));
      this.document.location.href = url;
    } catch (error: unknown) {
      this.toasts.error(error);
      this.exportsResource.reload();
    }
  }

  protected async scheduleAccountDeletion(): Promise<void> {
    const ok = await this.confirm.ask({
      title: this.transloco.translate('privacy.deletion.confirmAccount.title'),
      message: this.transloco.translate('privacy.deletion.confirmAccount.message'),
      confirmLabel: this.transloco.translate('privacy.deletion.confirmAccount.action'),
      destructive: true,
    });
    if (!ok) return;

    await this.run(
      this.api.scheduleAccountDeletion(this.reasonModel().reason.trim() || undefined),
      'privacy.deletion.scheduled',
      () => {
        this.reasonForm().reset();
        this.deletionsResource.reload();
      },
    );
  }

  protected async scheduleOrganizationDeletion(): Promise<void> {
    const ok = await this.confirm.ask({
      title: this.transloco.translate('privacy.deletion.confirmOrganization.title', {
        name: this.permissions.organizationName() ?? '',
      }),
      message: this.transloco.translate('privacy.deletion.confirmOrganization.message'),
      confirmLabel: this.transloco.translate('privacy.deletion.confirmOrganization.action'),
      destructive: true,
    });
    if (!ok) return;

    await this.run(
      this.api.scheduleOrganizationDeletion(this.reasonModel().reason.trim() || undefined),
      'privacy.deletion.scheduled',
      () => {
        this.reasonForm().reset();
        this.deletionsResource.reload();
      },
    );
  }

  protected async cancelDeletion(request: DeletionRequest): Promise<void> {
    await this.run(this.api.cancelDeletion(request.id), 'privacy.deletion.cancelled', () =>
      this.deletionsResource.reload(),
    );
  }

  /** Brings the cookie banner back so the choice can be changed. */
  protected changeConsent(): void {
    this.consent.reopen();
  }

  /** One shape for every call here: busy, then a toast either way, then a reload. */
  private async run<T>(
    call: Observable<T>,
    successKey: string,
    onSuccess: () => void,
  ): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);

    try {
      await firstValueFrom(call);
      this.toasts.success(successKey);
      onSuccess();
    } catch (error: unknown) {
      this.toasts.error(error);
    } finally {
      this.busy.set(false);
    }
  }
}
