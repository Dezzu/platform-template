import { Component, computed, input, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';

/** One point of a daily series. Declared here: libs/ui may not import the contracts' shapes. */
export interface TrendPoint {
  /** `YYYY-MM-DD`. Formatted by the caller for display — this component only plots. */
  date: string;
  value: number;
}

/** The plotted geometry, computed once per data change. */
interface Plot {
  line: string;
  area: string;
  dots: { x: number; y: number; point: TrendPoint }[];
  max: number;
}

/**
 * Coordinate space of the SVG. Not pixels — the element is `width: 100%` and the
 * viewBox scales, which is what makes it responsive without a resize observer.
 */
const VIEW_W = 600;
const VIEW_H = 160;
const PAD_Y = 12;

/**
 * A single series over time: area, line, and a crosshair on hover.
 *
 * Hand-drawn SVG rather than a charting library, and that is a deliberate deviation
 * from the plan's `ngx-echarts`. ECharts is roughly a megabyte for one back-office
 * screen that almost nobody opens — the area of the product this repository is most
 * careful about weighing. What that megabyte buys is zoom, axis autoscaling and a
 * dozen chart types; what this screen needs is one line with a tooltip.
 *
 * **One series, so no legend** — the heading names it. A legend box for a single line
 * is a key to a lock with one key.
 *
 * The series colour comes in as a CSS custom property from the design system
 * (`--chart-1` and friends), which already ships a *chosen* dark palette rather than a
 * flipped one, so dark mode needs nothing here. Text never wears the series colour:
 * values and labels stay on the text tokens and the coloured mark carries identity.
 *
 * A screen-reader table sits behind the chart. It is not decoration — it is the only
 * way the numbers are reachable without seeing them, and it costs one `<table>`.
 */
@Component({
  selector: 'dui-trend-chart',
  imports: [DecimalPipe],
  host: { class: 'block' },
  template: `
    <figure class="relative m-0">
      <svg
        [attr.viewBox]="viewBox"
        class="h-40 w-full overflow-visible"
        preserveAspectRatio="none"
        role="img"
        [attr.aria-label]="label()"
        (pointermove)="track($event)"
        (pointerleave)="hovered.set(null)"
      >
        <!--
          Recessive: the baseline is there to sit the area on, not to be read. A grid
          of five lines behind a thirty-point series is more ink than the data.
        -->
        <line
          [attr.x1]="0"
          [attr.x2]="viewW"
          [attr.y1]="viewH - padY"
          [attr.y2]="viewH - padY"
          class="stroke-border"
          stroke-width="1"
          vector-effect="non-scaling-stroke"
        />

        @if (plot(); as p) {
          <path [attr.d]="p.area" [attr.fill]="color()" fill-opacity="0.12" stroke="none" />
          <!--
            "non-scaling-stroke" is what lets the viewBox stretch horizontally without
            the line getting fatter: without it a wide container draws a 2px stroke as
            a smear.
          -->
          <path
            [attr.d]="p.line"
            fill="none"
            [attr.stroke]="color()"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            vector-effect="non-scaling-stroke"
          />

          @if (active(); as a) {
            <line
              [attr.x1]="a.x"
              [attr.x2]="a.x"
              [attr.y1]="padY"
              [attr.y2]="viewH - padY"
              class="stroke-muted-foreground"
              stroke-width="1"
              stroke-dasharray="3 3"
              vector-effect="non-scaling-stroke"
            />
            <!--
              A ring in the surface colour separates the marker from the line under it.
              9px across, over the 8px floor a pointer can actually hit.
            -->
            <circle
              [attr.cx]="a.x"
              [attr.cy]="a.y"
              r="4.5"
              [attr.fill]="color()"
              class="stroke-background"
              stroke-width="2"
              vector-effect="non-scaling-stroke"
            />
          }
        }
      </svg>

      @if (active(); as a) {
        <!--
          Positioned in percent of the container, so it follows the point through every
          container width without measuring anything.
        -->
        <div
          class="bg-popover text-popover-foreground pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-md border px-2 py-1 text-xs shadow-md"
          [style.left.%]="(a.x / viewW) * 100"
        >
          <span class="text-muted-foreground block">{{ a.point.date }}</span>
          <span class="font-semibold tabular-nums">{{ a.point.value | number }}</span>
          <span class="text-muted-foreground"> {{ unit() }}</span>
        </div>
      }

      <figcaption class="sr-only">
        <table>
          <caption>
            {{
              label()
            }}
          </caption>
          <tbody>
            @for (point of points(); track point.date) {
              <tr>
                <th scope="row">{{ point.date }}</th>
                <td>{{ point.value }}</td>
              </tr>
            }
          </tbody>
        </table>
      </figcaption>
    </figure>
  `,
})
export class TrendChartComponent {
  readonly points = input.required<readonly TrendPoint[]>();
  /** Names the series. Used for the accessible label and the table caption. */
  readonly label = input.required<string>();
  /** What the numbers are, appended in the tooltip. Already translated. */
  readonly unit = input<string>('');
  /** A CSS colour, normally a design-system token like `var(--chart-1)`. */
  readonly color = input<string>('var(--chart-1)');

  protected readonly viewW = VIEW_W;
  protected readonly viewH = VIEW_H;
  protected readonly padY = PAD_Y;
  protected readonly viewBox = `0 0 ${VIEW_W} ${VIEW_H}`;

  protected readonly hovered = signal<number | null>(null);

  protected readonly plot = computed<Plot | null>(() => {
    const data = this.points();
    if (data.length === 0) return null;

    /**
     * The scale starts at zero and never at the minimum.
     *
     * A y-axis cropped to the data turns a flat week into a mountain range, which is
     * the most common way a truthful chart tells a lie. `max` of at least 1 keeps an
     * all-zero series on the baseline instead of dividing by nothing.
     */
    const max = Math.max(1, ...data.map((p) => p.value));
    const usable = VIEW_H - PAD_Y * 2;
    const step = data.length > 1 ? VIEW_W / (data.length - 1) : 0;

    const dots = data.map((point, index) => ({
      x: data.length > 1 ? index * step : VIEW_W / 2,
      y: VIEW_H - PAD_Y - (point.value / max) * usable,
      point,
    }));

    const line = dots.map((d, i) => `${i === 0 ? 'M' : 'L'}${d.x} ${d.y}`).join(' ');
    const first = dots[0];
    const last = dots[dots.length - 1];
    const base = VIEW_H - PAD_Y;
    const area = first && last ? `${line} L${last.x} ${base} L${first.x} ${base} Z` : '';

    return { line, area, dots, max };
  });

  protected readonly active = computed(() => {
    const index = this.hovered();
    if (index === null) return null;
    return this.plot()?.dots[index] ?? null;
  });

  /**
   * Nearest point to the pointer, not the one directly under it.
   *
   * With thirty points across a wide container the gap between them is a few pixels;
   * requiring a hit on the mark itself would make the tooltip something you catch by
   * luck. The whole plot area is the hit target and the closest point wins.
   */
  protected track(event: PointerEvent): void {
    const data = this.points();
    if (data.length === 0) return;

    const target = event.currentTarget as SVGSVGElement;
    const rect = target.getBoundingClientRect();
    if (rect.width === 0) return;

    const ratio = (event.clientX - rect.left) / rect.width;
    const index = Math.round(ratio * (data.length - 1));

    this.hovered.set(Math.min(data.length - 1, Math.max(0, index)));
  }
}
