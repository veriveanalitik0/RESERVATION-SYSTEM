/**
 * Tarih yardımcıları — süre modeli edge-case birim testleri.
 *
 * Kritik kurallar:
 *  - periodEndDate('1w') = start + 6 gün (bitiş DAHİL → toplam 7 gün)
 *  - periodEndDate('2w') = start + 13 gün (toplam 14 gün)
 *  - periodEndDate('1m') = addMonthsEndDate kuralı (ay taşması kıskaçlı)
 */
import { describe, expect, it } from 'vitest';
import { addDaysYmd, addMonthsEndDate, periodEndDate } from '../src/utils/dates';

describe('addDaysYmd', () => {
  it('gün ekler', () => {
    expect(addDaysYmd('2026-07-03', 6)).toBe('2026-07-09');
  });

  it('ay sınırını aşar', () => {
    expect(addDaysYmd('2026-07-28', 6)).toBe('2026-08-03');
  });

  it('yıl sınırını aşar', () => {
    expect(addDaysYmd('2026-12-29', 6)).toBe('2027-01-04');
  });

  it('artık yıl şubatını doğru işler', () => {
    // 2028 artık yıl — 29 Şubat var.
    expect(addDaysYmd('2028-02-26', 6)).toBe('2028-03-03');
    // 2026 artık yıl değil.
    expect(addDaysYmd('2026-02-26', 6)).toBe('2026-03-04');
  });
});

describe('periodEndDate', () => {
  it("'1w' → başlangıç + 6 gün (7 günlük dönem)", () => {
    expect(periodEndDate('2026-07-06', '1w')).toBe('2026-07-12');
  });

  it("'2w' → başlangıç + 13 gün (14 günlük dönem)", () => {
    expect(periodEndDate('2026-07-06', '2w')).toBe('2026-07-19');
  });

  it("'1m' → addMonthsEndDate ile birebir aynı", () => {
    expect(periodEndDate('2026-07-06', '1m')).toBe(addMonthsEndDate('2026-07-06', 1));
    expect(periodEndDate('2026-07-06', '1m')).toBe('2026-08-05');
  });

  it("'1m' ay sonu kıskacı: 31 Oca → 27 Şub (artık olmayan yıl)", () => {
    expect(periodEndDate('2026-01-31', '1m')).toBe('2026-02-27');
  });

  it("'1m' ay sonu kıskacı: 31 Oca 2028 (artık yıl) → 28 Şub", () => {
    expect(periodEndDate('2028-01-31', '1m')).toBe('2028-02-28');
  });

  it("'1w' yıl sonu geçişi", () => {
    expect(periodEndDate('2026-12-28', '1w')).toBe('2027-01-03');
  });

  it("'2w' ay geçişi", () => {
    expect(periodEndDate('2026-07-25', '2w')).toBe('2026-08-07');
  });
});
