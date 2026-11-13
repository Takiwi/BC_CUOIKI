import { calculateContributionAllocation } from './funds.service';

describe('calculateContributionAllocation', () => {
  it('allocates 20% to reserve and 80% to main when reserve has plenty of capacity', () => {
    const result = calculateContributionAllocation('1000000', '0', '5000000');
    expect(result.reserveAllocated).toBe('200000');
    expect(result.mainAllocated).toBe('800000');
  });

  it('caps reserve allocation when reaching reserve threshold', () => {
    // Reserve already has 4,900,000. Threshold is 5,000,000. Needed is only 100,000.
    // 20% of 1,000,000 is 200,000, but only 100,000 should go to reserve.
    const result = calculateContributionAllocation(
      '1000000',
      '4900000',
      '5000000',
    );
    expect(result.reserveAllocated).toBe('100000');
    expect(result.mainAllocated).toBe('900000');
  });

  it('allocates 100% to main fund when reserve is already at or above threshold', () => {
    const result = calculateContributionAllocation(
      '1000000',
      '5000000',
      '5000000',
    );
    expect(result.reserveAllocated).toBe('0');
    expect(result.mainAllocated).toBe('1000000');
  });

  it('handles decimal values accurately without floating point drift', () => {
    const result = calculateContributionAllocation(
      '150.50',
      '100.25',
      '200.00',
    );
    // 20% of 150.50 = 30.10. Needed = 99.75.
    // reserve: 30.10, main: 120.40
    expect(result.reserveAllocated).toBe('30.10');
    expect(result.mainAllocated).toBe('120.40');
  });
});
