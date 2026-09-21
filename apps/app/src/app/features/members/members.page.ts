import { Component, computed, inject, resource, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { email as emailRule, form, FormField, required } from '@angular/forms/signals';
import { firstValueFrom, merge } from 'rxjs';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { provideIcons } from '@ng-icons/core';
import { lucideUserRoundCog, lucideUserRoundX, lucideX } from '@ng-icons/lucide';
import { HlmButtonImports } from '@spartan-ng/helm/button';
// Deep import: the barrel re-exports Zod schemas the bundler cannot tree-shake.
// `outranksOrEquals` comes from here rather than being restated — a second copy of a
// rule the server enforces is a rule that drifts.
import { ORG_ROLES, outranksOrEquals, PERMISSIONS, type OrgRole } from '@app/contracts/permissions';
import type { Invitation, Member } from '@app/contracts';
import { TextInputComponent } from '@app/ui/input';
import { TableComponent } from '@app/ui/table';
import { TemplateDirective } from '@app/ui/mix';
import type { TableAction, TableColumn } from '@app/ui/mix';
import { AuthService, CanDirective, PermissionsService, ToastService } from '@app/core';
import { MembersApi } from './members.api';

/**
 * Members and pending invitations on one screen, because they are one question:
 * who is in this organization, and who is on the way in.
 *
 * The controls here are filtered by what the *viewer* may do — both by permission and
 * by rank. That mirrors the server exactly, which matters more than usual on this
 * screen: an admin shown a "remove" button next to the owner would be clicking it and
 * getting a 403 every time.
 */
@Component({
  selector: 'app-members-page',
  imports: [
    TranslocoPipe,
    HlmButtonImports,
    CanDirective,
    TextInputComponent,
    FormField,
    TableComponent,
    TemplateDirective,
  ],
  providers: [provideIcons({ lucideUserRoundCog, lucideUserRoundX, lucideX })],
  templateUrl: './members.page.html',
})
export class MembersPage {
  private readonly api = inject(MembersApi);
  private readonly auth = inject(AuthService);
  private readonly permissions = inject(PermissionsService);
  private readonly toasts = inject(ToastService);
  private readonly transloco = inject(TranslocoService);

  /** See admin-users.page.ts: `langChanges$` alone misses the first load. */
  private readonly translations = toSignal(
    merge(this.transloco.langChanges$, this.transloco.events$),
  );

  protected readonly permissionCatalogue = PERMISSIONS;
  protected readonly roles = ORG_ROLES;
  protected readonly inviting = signal(false);

  protected readonly members = resource({
    loader: () => firstValueFrom(this.api.list({ size: 100, sort: 'name', dir: 'asc' })),
  });

  protected readonly invitations = resource({
    loader: () => firstValueFrom(this.api.listInvitations()),
  });

  /** The viewer's own role, which is what the rank rules are measured against. */
  private readonly myRole = computed<OrgRole | null>(
    () => this.permissions.role() as OrgRole | null,
  );

  private readonly model = signal<{ email: string; role: OrgRole }>({
    email: '',
    role: 'member',
  });

  protected readonly invitation = form(this.model, (path) => {
    required(path.email);
    emailRule(path.email);
  });

  private translate(key: string, params?: Record<string, unknown>): string {
    this.translations();
    return this.transloco.translate(key, params);
  }

  protected readonly memberColumns = computed<TableColumn[]>(() => {
    const t = (key: string) => this.translate(`members.columns.${key}`);
    return [
      { field: 'name', header: t('name'), sortable: false },
      { field: 'email', header: t('email'), sortable: false },
      { field: 'role', header: t('role'), sortable: false },
    ];
  });

  protected readonly invitationColumns = computed<TableColumn[]>(() => {
    const t = (key: string) => this.translate(`members.columns.${key}`);
    return [
      { field: 'email', header: t('email'), sortable: false },
      { field: 'role', header: t('role'), sortable: false },
    ];
  });

  /**
   * One entry per role instead of a select, the way the admin screen does it: a menu
   * holds buttons. Only the roles this viewer may grant, and never the one the member
   * already has — an entry that would do nothing only makes the menu longer.
   */
  protected readonly memberActions = computed<TableAction<Member>[]>(() => {
    const roleEntries: TableAction<Member>[] = this.grantableRoles().map((role) => ({
      icon: 'lucideUserRoundCog',
      group: this.translate('members.role'),
      label: this.translate(`members.roles.${role}`),
      visible: (row: Member) =>
        this.permissions.anyOf(PERMISSIONS.MEMBERS_MANAGE) &&
        this.canActOn(row) &&
        row.role !== role,
      command: (row: Member) => this.setRole(row.id, role),
    }));

    return [
      ...roleEntries,
      {
        icon: 'lucideUserRoundX',
        severity: 'destructive',
        label: this.translate('members.remove'),
        visible: (row) =>
          this.permissions.anyOf(PERMISSIONS.MEMBERS_REMOVE) &&
          this.canActOn(row) &&
          !this.isSelf(row),
        command: (row) => this.remove(row),
      },
    ];
  });

  protected readonly invitationActions = computed<TableAction<Invitation>[]>(() => [
    {
      icon: 'lucideX',
      severity: 'destructive',
      label: this.translate('members.cancelInvitation'),
      visible: () => this.permissions.anyOf(PERMISSIONS.MEMBERS_INVITE),
      command: (row) => this.cancelInvitation(row.id),
    },
  ]);

  protected asMember(value: unknown): Member {
    return value as Member;
  }

  /** Roles the viewer may hand out: their own and anything below it. */
  protected readonly grantableRoles = computed(() => {
    const mine = this.myRole();
    if (!mine) return [];
    return ORG_ROLES.filter((role) => outranksOrEquals(mine, role));
  });

  protected isSelf(member: Member): boolean {
    return member.user.id === this.auth.user()?.id;
  }

  /** Mirrors the server's rank rule, so no button promises what the API will refuse. */
  protected canActOn(member: Member): boolean {
    const mine = this.myRole();
    return mine !== null && outranksOrEquals(mine, member.role);
  }

  protected setRole(memberId: string, role: string): void {
    void this.run(async () => {
      await firstValueFrom(this.api.updateRole(memberId, role as OrgRole));
      this.members.reload();
    });
  }

  protected remove(member: Member): void {
    void this.run(async () => {
      await firstValueFrom(this.api.remove(member.id));
      this.members.reload();
    });
  }

  protected cancelInvitation(id: string): void {
    void this.run(async () => {
      await firstValueFrom(this.api.cancelInvitation(id));
      this.invitations.reload();
    });
  }

  protected async invite(event: Event): Promise<void> {
    event.preventDefault();
    if (this.invitation().invalid() || this.inviting()) return;

    this.inviting.set(true);
    await this.run(async () => {
      const email = this.model().email;
      await firstValueFrom(this.api.invite(this.model()));
      this.model.set({ email: '', role: 'member' });
      this.invitations.reload();
      this.toasts.success('members.invitationSent', { email });
    });
    this.inviting.set(false);
  }

  /** One place to report a refusal, since every action here can be refused. */
  private async run(action: () => Promise<void>): Promise<void> {
    try {
      await action();
    } catch (error: unknown) {
      this.toasts.error(error);
    }
  }
}
