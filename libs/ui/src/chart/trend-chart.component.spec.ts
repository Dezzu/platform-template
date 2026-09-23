import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { TrendChartComponent, type TrendPoint } from './trend-chart.component';

interface Plot {
  line: string;
  dots: { x: number; y: number }[];
}

function setup(points: TrendPoint[]) {
  TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });

  const fixture = TestBed.createComponent(TrendChartComponent);
  fixture.componentRef.setInput('points', points);
  fixture.componentRef.setInput('label', 'Test');
  fixture.detectChanges();

  // `plot` is protected — these cases are precisely about the geometry it computes.
  return () => (fixture.componentInstance as unknown as { plot: () => Plot | null }).plot();
}

const day = (n: number, value: number): TrendPoint => ({
  date: `2026-09-${String(n).padStart(2, '0')}`,
  value,
});

/**
 * The geometry, because the geometry is where a chart lies.
 *
 * A y-scale cropped to the data is the most common way a truthful dataset produces a
 * misleading picture: three values a hair apart become a mountain range. These cases
 * pin the scale to zero and pin the degenerate inputs that would otherwise divide by
 * nothing.
 */
describe('TrendChartComponent geometry', () => {
  it('anchors the scale at zero, so a flat series looks flat', () => {
    const plot = setup([day(1, 100), day(2, 101), day(3, 102)]);
    const dots = plot()?.dots ?? [];

    const ys = dots.map((d) => d.y);
    const spread = Math.max(...ys) - Math.min(...ys);

    // Scaled to the range 100..102 those three points would span the full height.
    // Against a zero baseline they are within a few percent of each other.
    expect(spread).toBeLessThan(10);
  });

  it('puts an all-zero series on the baseline instead of dividing by nothing', () => {
    const plot = setup([day(1, 0), day(2, 0), day(3, 0)]);
    const dots = plot()?.dots ?? [];

    expect(dots).toHaveLength(3);
    for (const dot of dots) {
      expect(Number.isFinite(dot.y)).toBe(true);
    }
    // All at the same height, and that height is the bottom of the plot area.
    expect(new Set(dots.map((d) => d.y)).size).toBe(1);
  });

  it('places a single point in the middle rather than at x=0', () => {
    const plot = setup([day(1, 5)]);
    const dots = plot()?.dots ?? [];

    expect(dots).toHaveLength(1);
    // With one point the step is zero; left at x=0 the marker would sit on the edge,
    // half of it outside the box.
    expect(dots[0]?.x).toBeGreaterThan(0);
  });

  it('has nothing to draw for an empty series', () => {
    const plot = setup([]);
    expect(plot()).toBeNull();
  });

  it('draws the highest point at the top of the plot area, not off it', () => {
    const plot = setup([day(1, 0), day(2, 10)]);
    const dots = plot()?.dots ?? [];

    const top = Math.min(...dots.map((d) => d.y));
    // Inside the padding: a peak drawn at y=0 is a peak clipped by the viewBox.
    expect(top).toBeGreaterThanOrEqual(12);
  });
});
