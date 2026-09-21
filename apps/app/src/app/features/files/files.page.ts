import { Component, DOCUMENT, inject, resource, signal } from '@angular/core';
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
  private readonly document = inject(DOCUMENT);

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

  /**
   * Downloads through the presigned URL, without opening a window.
   *
   * An earlier version opened a tab up front and pointed it at the URL once it
   * arrived, to dodge the popup blocker. It could not work: `window.open` with
   * `noopener` returns null *by specification* — refusing the handle is what noopener
   * means — so the blank tab stayed blank and the fallback call, now after an `await`,
   * was the blocked one. The unit test agreed with the code because its stub returned
   * a window object the real API never returns.
   *
   * None of that is needed. The presigned GET carries `Content-Disposition:
   * attachment`, so pointing the current document at it starts a download and leaves
   * the page exactly where it was.
   *
   * `DOCUMENT` rather than the global `window`: it is the injectable seam this
   * repository already uses, it survives server-side rendering, and it lets a test
   * assert where the browser was sent instead of stubbing a global.
   */
  protected async download(file: FileMetadata): Promise<void> {
    this.errorKey.set(null);

    try {
      const { downloadUrl } = await firstValueFrom(this.api.downloadUrl(file.id));
      // Straight to storage. Never a proxy through the API — see CLAUDE.md.
      this.document.location.href = downloadUrl;
    } catch (error: unknown) {
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
