import { CONFIDENCE_LEVELS, meetsThreshold } from '../../src/types';

describe('CONFIDENCE_LEVELS', () => {
  it('has 5 levels in ascending order', () => {
    expect(CONFIDENCE_LEVELS).toEqual(['none', 'low', 'medium', 'high', 'absolute']);
  });
});

describe('meetsThreshold', () => {
  it('returns true when level equals threshold', () => {
    expect(meetsThreshold('high', 'high')).toBe(true);
    expect(meetsThreshold('none', 'none')).toBe(true);
    expect(meetsThreshold('absolute', 'absolute')).toBe(true);
  });

  it('returns true when level exceeds threshold', () => {
    expect(meetsThreshold('absolute', 'high')).toBe(true);
    expect(meetsThreshold('high', 'medium')).toBe(true);
    expect(meetsThreshold('absolute', 'none')).toBe(true);
  });

  it('returns false when level is below threshold', () => {
    expect(meetsThreshold('none', 'low')).toBe(false);
    expect(meetsThreshold('medium', 'high')).toBe(false);
    expect(meetsThreshold('low', 'absolute')).toBe(false);
  });
});
