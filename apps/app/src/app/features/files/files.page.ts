import { Component, inject, resource, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { TranslocoPipe } from '@jsverse/transloco';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { PERMISSIONS } from '@app/contracts/permissions';
import type { FileMetadata } from '@app/contracts';
import { AppError, CanDirective } from '@app/core';
import { FilesApi } from './files.api';

/**
 * The storage screen, and the one place the two-step upload is visible as a sequence:
 *
 *   ticket → PUT straight to storage → commit
 *
 * The middle step does not involve our API at all, which is the entire point. If the
 * tab is closed between steps two and three the row stays `pending`, stays invisible
 * here, and the janitor removes it the next night.
 */
@Component({
  selector: 'app-files-page',
  imports: [TranslocoPipe, HlmButtonImports, CanDirective],
  templateUrl: './files.page.html',
})
export class FilesPage {
  private readonly api = inject(FilesApi);

  protected readonly permissions = PERMISSIONS;
  protected readonly errorKey = signal<string | null>(null);
  protected readonly uploading = signal(false);

  protected readonly files = resource({
    loader: () => firstValueFrom(this.api.list({ size: 50, sort: 'createdAt', dir: 'desc' })),
  });

  protected async onFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    this.errorKey.set(null);
    this.uploading.set(true);

    try {
      const ticket = await firstValueFrom(this.api.requestTicket(file));
      await this.api.upload(ticket, file);
      await firstValueFrom(this.api.commit(ticket.file.id));
      this.files.reload();
    } catch (error: unknown) {
      this.errorKey.set(this.translationKeyFor(error));
    } finally {
      this.uploading.set(false);
      // Clears the selection so picking the same file again still fires a change event.
      input.value = '';
    }
  }

  protected async download(file: FileMetadata): Promise<void> {
    this.errorKey.set(null);

    /**
     * The tab is opened BEFORE the request, while the click is still on the stack.
     * A `window.open` issued after an `await` has lost the user gesture that
     * authorises it, and Safari and Firefox block it outright — a bug no unit test
     * sees, because in a test `open` is a spy that never refuses.
     */
    const tab = window.open('', '_blank', 'noopener');

    try {
      const { downloadUrl } = await firstValueFrom(this.api.downloadUrl(file.id));
      // Straight to storage. Never a proxy through the API — see CLAUDE.md.
      if (tab) tab.location.href = downloadUrl;
      else window.open(downloadUrl, '_blank', 'noopener');
    } catch (error: unknown) {
      tab?.close();
      this.errorKey.set(this.translationKeyFor(error));
    }
  }

  protected async remove(file: FileMetadata): Promise<void> {
    this.errorKey.set(null);
    try {
      await firstValueFrom(this.api.remove(file.id));
      this.files.reload();
    } catch (error: unknown) {
      this.errorKey.set(this.translationKeyFor(error));
    }
  }

  /** Human-readable size. Binary units, because that is what the object store reports. */
  protected humanSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    const units = ['KB', 'MB', 'GB'];
    let value = bytes / 1024;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit += 1;
    }
    return `${value.toFixed(1)} ${units[unit]}`;
  }

  private translationKeyFor(error: unknown): string {
    // The upload PUT goes to the object store, which answers with XML, not with our
    // envelope — so it arrives here as a generic failure rather than an AppError.
    return error instanceof AppError ? error.translationKey : 'errors.INTERNAL_ERROR';
  }
}
