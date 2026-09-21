import { Component, computed, inject, linkedSignal, resource, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { form, FormField, maxLength, required } from '@angular/forms/signals';
import { firstValueFrom, merge } from 'rxjs';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { PROJECT_STATUSES, type ProjectStatus } from '@app/contracts';
import { SelectInputComponent, TextInputComponent, TextareaInputComponent } from '@app/ui/input';
import { ToastService } from '@app/core';
import { ProjectsApi } from './projects.api';

/** What the form edits. Kept flat and free of nulls: an input binds to a value. */
interface ProjectForm {
  name: string;
  description: string;
  status: ProjectStatus;
}

const BLANK: ProjectForm = { name: '', description: '', status: 'active' };

/**
 * Creating and editing a project — one page, not a modal, and not a form living inside
 * the list.
 *
 * A page because that is the rule in CLAUDE.md, and the rule earns its keep here: the
 * address bar names what you are editing, the back button does what it looks like it
 * does, and a half-filled form survives a refresh being a real navigation rather than
 * a piece of state on top of another screen.
 *
 * One component for both jobs, because they differ only in where the first value comes
 * from and which call saves it. Two components would be two places to add the next
 * field to, and one of them would eventually be forgotten.
 */
@Component({
  selector: 'app-project-form-page',
  imports: [
    TranslocoPipe,
    RouterLink,
    FormField,
    TextInputComponent,
    TextareaInputComponent,
    SelectInputComponent,
    HlmButtonImports,
    HlmCardImports,
  ],
  templateUrl: './project-form.page.html',
})
export class ProjectFormPage {
  private readonly api = inject(ProjectsApi);
  private readonly router = inject(Router);
  private readonly transloco = inject(TranslocoService);
  private readonly toasts = inject(ToastService);

  /** See admin-users.page.ts: `langChanges$` alone misses the first load. */
  private readonly translations = toSignal(
    merge(this.transloco.langChanges$, this.transloco.events$),
  );

  /** Null on the create route. From the URL, so a reload lands on the same project. */
  protected readonly projectId = inject(ActivatedRoute).snapshot.paramMap.get('id');

  private readonly existing = resource({
    params: () => this.projectId,
    loader: ({ params }) =>
      params ? firstValueFrom(this.api.getById(params)) : Promise.resolve(null),
  });

  protected readonly loading = computed(() => this.existing.isLoading());
  protected readonly failed = computed(() => this.existing.error() !== undefined);
  protected readonly editing = computed(() => this.projectId !== null);
  protected readonly saving = signal(false);

  /**
   * `linkedSignal` rather than an effect that writes into a plain signal: the model
   * follows the loaded project until somebody types, and then it is theirs. An effect
   * would race the first keystroke and overwrite it.
   */
  protected readonly model = linkedSignal<ProjectForm>(() => {
    if (!this.existing.hasValue()) return BLANK;
    const project = this.existing.value();
    return project
      ? { name: project.name, description: project.description ?? '', status: project.status }
      : BLANK;
  });

  protected readonly project = form(this.model, (path) => {
    required(path.name);
    // The same ceilings the contract declares. A form that accepts more than the API
    // does refuses the work only after the user has done it.
    maxLength(path.name, 120);
    maxLength(path.description, 2000);
  });

  protected readonly statusOptions = computed(() => {
    this.translations();
    return PROJECT_STATUSES.map((status) => ({
      value: status,
      label: this.transloco.translate(`projects.status.${status}`),
    }));
  });

  /**
   * `(submit)` with an explicit preventDefault, not `(ngSubmit)`.
   *
   * `ngSubmit` is an output of NgForm, which only exists with FormsModule. With Signal
   * Forms there is no NgForm on the element, so the binding attaches to nothing and the
   * browser performs a native GET submit — putting every field in the query string.
   */
  protected async save(event: Event): Promise<void> {
    event.preventDefault();
    if (this.project().invalid() || this.saving()) return;

    this.saving.set(true);
    const { name, description, status } = this.model();
    const payload = {
      name: name.trim(),
      // Empty is not the same as unset: the contract takes null to clear it.
      description: description.trim() || null,
      status,
    };

    try {
      const id = this.projectId;
      if (id) {
        await firstValueFrom(this.api.update(id, payload));
        this.toasts.success('projects.saved', { name: payload.name });
      } else {
        await firstValueFrom(this.api.create(payload));
        this.toasts.success('projects.created', { name: payload.name });
      }
      await this.router.navigateByUrl('/projects');
    } catch (error: unknown) {
      // Stay on the page: the work is in these fields and navigating away loses it.
      this.saving.set(false);
      this.toasts.error(error);
    }
  }
}
