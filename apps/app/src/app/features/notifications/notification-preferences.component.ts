import { Component, computed, inject, resource, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { TranslocoPipe } from '@jsverse/transloco';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmSwitchImports } from '@spartan-ng/helm/switch';
import {
  NOTIFICATION_CHANNELS,
  type NotificationChannel,
  type NotificationPreference,
} from '@app/contracts';
import { NotificationsApi, ToastService } from '@app/core';

/** One row of the matrix: a type, with a switch per channel. */
interface PreferenceRow {
  type: string;
  group: string;
  cells: { channel: NotificationChannel; enabled: boolean; editable: boolean }[];
}

/**
 * Which notifications reach you, and where.
 *
 * A matrix of type against channel, sent one switch at a time: each click is a
 * complete statement ("this type, this channel, off") and the server answers with the
 * whole set, so the screen never has to guess what its own change implied.
 *
 * A switch the registry marks mandatory renders disabled rather than hidden. Hiding it
 * would make the email look like an oversight; showing it locked says the product
 * insists, and the row explains why.
 */
@Component({
  selector: 'app-notification-preferences',
  imports: [TranslocoPipe, HlmCardImports, HlmSwitchImports],
  templateUrl: './notification-preferences.component.html',
})
export class NotificationPreferencesComponent {
  private readonly api = inject(NotificationsApi);
  private readonly toasts = inject(ToastService);

  protected readonly channels = NOTIFICATION_CHANNELS;
  protected readonly saving = signal(false);

  private readonly preferences = resource({
    loader: () => firstValueFrom(this.api.preferences()),
  });

  protected readonly loading = computed(
    () => this.preferences.isLoading() && !this.preferences.hasValue(),
  );
  protected readonly failed = computed(() => this.preferences.error() !== undefined);

  /** Grouped into rows, because a flat list of type-channel pairs reads as noise. */
  protected readonly rows = computed<PreferenceRow[]>(() => {
    const all: NotificationPreference[] = this.preferences.hasValue()
      ? this.preferences.value()
      : [];

    const byType = new Map<string, PreferenceRow>();
    for (const item of all) {
      const row = byType.get(item.type) ?? { type: item.type, group: item.group, cells: [] };
      row.cells.push({ channel: item.channel, enabled: item.enabled, editable: item.editable });
      byType.set(item.type, row);
    }

    return [...byType.values()];
  });

  protected cellFor(row: PreferenceRow, channel: NotificationChannel) {
    return row.cells.find((cell) => cell.channel === channel);
  }

  protected async toggle(
    row: PreferenceRow,
    channel: NotificationChannel,
    enabled: boolean,
  ): Promise<void> {
    if (this.saving()) return;
    this.saving.set(true);

    try {
      // The server answers with the whole set, applied wholesale: it knows about
      // defaults and mandatory channels, and this screen should not re-derive either.
      const updated = await firstValueFrom(
        this.api.setPreference({
          type: row.type as NotificationPreference['type'],
          channel,
          enabled,
        }),
      );
      this.preferences.set(updated);
    } catch (error: unknown) {
      // Reload rather than trust the switch: it has already moved on screen, and the
      // server may have refused.
      this.preferences.reload();
      this.toasts.error(error);
    } finally {
      this.saving.set(false);
    }
  }
}
