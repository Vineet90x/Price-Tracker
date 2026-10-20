import { percentile } from './latency.service';

describe('percentile', () => {
  const values = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100, already sorted

  it('p50 / p95 / p99 of 1..100', () => {
    expect(percentile(values, 0.5)).toBe(50);
    expect(percentile(values, 0.95)).toBe(95);
    expect(percentile(values, 0.99)).toBe(99);
  });

  it('one slow outlier barely moves p50 but shows up in p99 (why we never use averages)', () => {
    const withOutlier = [...values.slice(0, 99), 10_000];
    expect(percentile(withOutlier, 0.5)).toBe(50);
    expect(percentile(withOutlier, 1)).toBe(10_000);
    const average = withOutlier.reduce((a, b) => a + b, 0) / withOutlier.length;
    expect(average).toBeGreaterThan(140); // the average is misleading: no tick took ~150 ms
  });

  it('empty input gives NaN (no data yet)', () => {
    expect(percentile([], 0.5)).toBeNaN();
  });
});
