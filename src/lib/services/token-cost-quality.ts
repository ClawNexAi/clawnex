export type CostQualityStatus = 'known' | 'unknown' | 'invalid' | 'mixed';

export function costStatusFromSource(source?: string | null): Exclude<CostQualityStatus, 'mixed' | 'invalid'> {
  if (source === 'openclaw' || source === 'litellm' || source === 'actual' || source === 'estimated') {
    return 'known';
  }
  return 'unknown';
}

export function unknownRowsForStatus(status: CostQualityStatus, requests: number): number {
  return status === 'unknown' || status === 'mixed' ? requests : 0;
}

export function classifyProxyCostStatus(row: {
  invalidCostRows?: number | null;
  unpricedRows?: number | null;
}): Exclude<CostQualityStatus, 'mixed'> {
  if ((row.invalidCostRows ?? 0) > 0) return 'invalid';
  if ((row.unpricedRows ?? 0) > 0) return 'unknown';
  return 'known';
}

export function mergeCostStatus(left: CostQualityStatus | undefined, right: CostQualityStatus): CostQualityStatus {
  if (!left) return right;
  if (left === right) return left;
  if (left === 'invalid' || right === 'invalid') return 'invalid';
  if (left === 'mixed' || right === 'mixed') return 'mixed';
  return 'mixed';
}

export function summarizeLegacyCostQuality(rows: Array<{
  invalidCostRows?: number | null;
  unpricedRows?: number | null;
}>): {
  status: Exclude<CostQualityStatus, 'mixed'>;
  invalidCostRows: number;
  unpricedRows: number;
} {
  const invalidCostRows = rows.reduce((sum, row) => sum + (row.invalidCostRows ?? 0), 0);
  const unpricedRows = rows.reduce((sum, row) => sum + (row.unpricedRows ?? 0), 0);
  return {
    status: invalidCostRows > 0 ? 'invalid' : unpricedRows > 0 ? 'unknown' : 'known',
    invalidCostRows,
    unpricedRows,
  };
}
