import { describe, it, expect } from 'vitest';
import { drugCatalog, findDrug, SCHEDULE_H_WARNING } from '../../lib/clinical/drug-catalog';

describe('drugCatalog — DCGI-approved formulations only', () => {
  it('contains semaglutide SC (Obeda / Sematrinity — DCGI generics)', () => {
    const d = findDrug('semaglutide-sc');
    expect(d).toBeDefined();
    expect(d?.brands.map((b) => b.brandName)).toEqual(
      expect.arrayContaining(['Obeda', 'Sematrinity'])
    );
  });

  it('contains tirzepatide (Mounjaro — Eli Lilly only, no generics yet)', () => {
    const d = findDrug('tirzepatide-sc');
    expect(d).toBeDefined();
    expect(d?.brands).toHaveLength(1);
    expect(d?.brands[0]?.brandName).toBe('Mounjaro');
    expect(d?.brands[0]?.manufacturer).toBe('Eli Lilly and Company');
  });

  it('contains oral semaglutide (Rybelsus)', () => {
    const d = findDrug('semaglutide-oral');
    expect(d).toBeDefined();
    expect(d?.brands[0]?.brandName).toBe('Rybelsus');
  });

  it('contains liraglutide (Victoza)', () => {
    const d = findDrug('liraglutide-sc');
    expect(d).toBeDefined();
    expect(d?.brands[0]?.brandName).toBe('Victoza');
  });

  it('all GLP-1 entries are flagged Schedule H', () => {
    const glp1s = drugCatalog.filter((d) => d.drugClass === 'glp1_agonist');
    expect(glp1s.length).toBeGreaterThan(0);
    for (const d of glp1s) {
      expect(d.scheduleH).toBe(true);
    }
  });

  it('NEVER contains compounded GLP-1s (legal firewall, ADR-001)', () => {
    const offenders = drugCatalog.filter((d) =>
      /compound/i.test(d.brands.map((b) => b.brandName).join(' ')) ||
      /compound/i.test(d.brands.map((b) => b.manufacturer).join(' '))
    );
    expect(offenders).toEqual([]);
  });

  it('every drug has at least one brand (no orphan generic)', () => {
    for (const d of drugCatalog) {
      expect(d.brands.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('semaglutide titration ladder matches Indian protocol', () => {
    const d = findDrug('semaglutide-sc');
    expect(d?.titration?.map((s) => s.value)).toEqual([0.25, 0.5, 1.0, 1.7, 2.4]);
  });

  it('tirzepatide titration ladder is 2.5 → 5 → 7.5 → 10 → 12.5 → 15', () => {
    const d = findDrug('tirzepatide-sc');
    expect(d?.titration?.map((s) => s.value)).toEqual([2.5, 5, 7.5, 10, 12.5, 15]);
  });

  it('Schedule H warning text is correct (CDSCO mandatory wording)', () => {
    expect(SCHEDULE_H_WARNING.text).toContain('Schedule H');
    expect(SCHEDULE_H_WARNING.text).toContain('Registered Medical Practitioner');
    expect(SCHEDULE_H_WARNING.symbol).toBe('℞');
  });
});
