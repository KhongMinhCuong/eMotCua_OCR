/**
 * Normalize columns recognized on the same visual line.
 * Long runs of spaces and all tab variants become a single tab, preserving rows.
 */
export function fixLayout(rawText: string): string {
  return rawText
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim().replace(/[\t\v\f ]{2,}/g, '\t'))
    .filter(Boolean)
    .join('\n');
}

export function assertLayoutService(): void {
  const input = 'Số thửa đất    125\tSố tờ bản đồ   12';
  const expected = 'Số thửa đất\t125\tSố tờ bản đồ\t12';

  if (fixLayout(input) !== expected) {
    throw new Error('Layout normalization self-check failed');
  }
}