export const TIME_WINDOWS = [
  { key: '1m',  label: '1m',      seconds: 60,      index: 0 },
  { key: '5m',  label: '5m',      seconds: 300,     index: 1 },
  { key: '30m', label: '30m',     seconds: 1800,    index: 2 },
  { key: '1h',  label: '1h',      seconds: 3600,    index: 3 },
  { key: '6h',  label: '6h',      seconds: 21600,   index: 4 },
  { key: '12h', label: '12h',     seconds: 43200,   index: 5 },
  { key: '24h', label: '24h',     seconds: 86400,   index: 6 },
  { key: '1w',  label: '1 week',  seconds: 604800,  index: 7 },
  { key: '1M',  label: '1 month', seconds: 2592000, index: 8 },
] as const;

export type TimeWindowKey = typeof TIME_WINDOWS[number]['key'];

export const DEFAULT_TIME_WINDOW: TimeWindowKey = '1h';
