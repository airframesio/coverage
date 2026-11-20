/**
 * Last outcome of the periodic jobs, written by the jobs themselves and read
 * by GET /metrics. Timestamps are Unix seconds; 0 means "not yet succeeded
 * since this process started".
 */
export const jobStatus = {
  stationSyncLastSuccess: 0,
  snapshotLastSuccess: 0,
  snapshotDurationSeconds: 0,
};
