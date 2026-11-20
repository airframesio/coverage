import {
  connect,
  credsAuthenticator,
  type ConnectionOptions,
  type NatsConnection,
  type Subscription,
} from '@nats-io/transport-node';
import { config } from '../config.js';
import { parseAircraftMessage, parseAircraftMessageCreated } from './parsers/aircraft.js';
import { MarineCorrelator, type MarineReception } from './marine-correlator.js';
import { parseRawForPosition } from './parsers/raw-decoder.js';
import type { CoverageEvent, StationMeta } from '../types/events.js';

/** All NATS subjects we subscribe to and their parser functions */
const SUBSCRIPTIONS: Array<{
  subject: string;
  parser: (data: any) => CoverageEvent | null;
}> = [
  // Aircraft messages (all sources: acarsdec, dumpvdl2, dumphfdl, jaero, etc.)
  // A message that also has a station report is counted from its report event below.
  { subject: 'v1.aircraft.ingest.*.message.*.created', parser: parseAircraftMessageCreated },
  // Aircraft message reports (VDL/HFDL detailed reports)
  { subject: 'v1.aircraft.ingest.*.message.*.report.*.created', parser: parseAircraftMessage },
];

/**
 * Marine subjects. They carry no `station` object, so the station (on the AIS
 * message) and the vessel position (on the voyage position) are joined by the
 * MarineCorrelator instead of being parsed one event at a time.
 */
const MARINE_AIS_MESSAGE_SUBJECT = 'v1.marine.ais_message.created';
const MARINE_VOYAGE_POSITION_SUBJECT = 'v1.marine.voyage-position.created';

/** Raw subjects for extracting positions from decoder output */
const RAW_SUBSCRIPTIONS = [
  'v1.aircraft.ingest.dumpvdl2-tcp.raw',
  'v1.aircraft.ingest.dumpvdl2-udp.raw',
  'v1.aircraft.ingest.dumphfdl-tcp.raw',
  'v1.aircraft.ingest.dumphfdl-zmq.raw',
];

export class NatsSubscriber {
  private nc: NatsConnection | null = null;
  private subscriptions: Subscription[] = [];
  private onEvent: (event: CoverageEvent) => void;
  /** Station UUID→ID lookup for raw message processing */
  private stationMap: Map<number, StationMeta> | null = null;
  private uuidToId: Map<string, number> = new Map();

  // Metrics
  public messagesReceived = 0;
  public messagesParsed = 0;
  public parseErrors = 0;
  public rawPositionsFound = 0;
  public marineUnknownStation = 0;

  readonly marine = new MarineCorrelator((reception) => this.onMarineReception(reception));
  private marineTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    onEvent: (event: CoverageEvent) => void,
    stationMap?: Map<number, StationMeta>,
  ) {
    this.onEvent = onEvent;
    this.stationMap = stationMap ?? null;
  }

  /** Rebuild UUID→ID index from station map */
  refreshUuidIndex(): void {
    if (!this.stationMap) return;
    this.uuidToId.clear();
    for (const [id, meta] of this.stationMap) {
      if (meta.uuid) this.uuidToId.set(meta.uuid, id);
    }
  }

  async connect(): Promise<void> {
    const opts: ConnectionOptions = {
      servers: config.natsUrl,
      name: 'coverage-service',
      maxReconnectAttempts: -1,
      reconnectTimeWait: 2000,
    };

    if (config.natsJwt && config.natsNkeySeed) {
      const creds = new TextEncoder().encode(
        `-----BEGIN NATS USER JWT-----\n${config.natsJwt}\n------END NATS USER JWT------\n\n-----BEGIN USER NKEY SEED-----\n${config.natsNkeySeed}\n------END USER NKEY SEED------\n`
      );
      opts.authenticator = credsAuthenticator(creds);
    }

    this.nc = await connect(opts);
    console.log(`[NATS] Connected to ${config.natsUrl}`);

    // Subscribe to processed subjects
    for (const { subject, parser } of SUBSCRIPTIONS) {
      const sub = this.nc.subscribe(subject);
      this.subscriptions.push(sub);
      this.processSubscription(sub, parser);
    }

    // Subscribe to raw subjects for position extraction
    for (const subject of RAW_SUBSCRIPTIONS) {
      const sub = this.nc.subscribe(subject);
      this.subscriptions.push(sub);
      this.processRawSubscription(sub);
    }

    this.refreshUuidIndex();

    if (config.marineCoverageEnabled) {
      const aisSub = this.nc.subscribe(MARINE_AIS_MESSAGE_SUBJECT);
      const positionSub = this.nc.subscribe(MARINE_VOYAGE_POSITION_SUBJECT);
      this.subscriptions.push(aisSub, positionSub);
      this.processMarineSubscription(aisSub, (payload) => this.marine.onAisMessage(payload));
      this.processMarineSubscription(positionSub, (payload) => this.marine.onVoyagePosition(payload));
      this.marineTimer = setInterval(() => this.marine.flush(), 1000);
    }

    console.log(
      `[NATS] Subscribed to ${SUBSCRIPTIONS.length} processed + ${RAW_SUBSCRIPTIONS.length} raw subject patterns` +
      (config.marineCoverageEnabled ? ' + 2 marine subjects' : ' (marine coverage disabled)'),
    );
  }

  private async processMarineSubscription(sub: Subscription, handle: (payload: any) => void): Promise<void> {
    for await (const msg of sub) {
      this.messagesReceived++;
      try {
        handle(JSON.parse(msg.string()));
      } catch {
        this.parseErrors++;
      }
    }
  }

  /** One AIS message received by a station, with the vessel position when known */
  private onMarineReception(reception: MarineReception): void {
    const stationId = this.uuidToId.get(reception.stationUuid);
    if (!stationId) {
      this.marineUnknownStation++;
      return;
    }
    const hasTarget = reception.lat !== null && reception.lon !== null;
    this.messagesParsed++;
    this.onEvent({
      stationId,
      stationUuid: reception.stationUuid,
      targetLat: reception.lat,
      targetLon: reception.lon,
      targetAlt: null,
      transportType: 'marine',
      sourceType: 'ais',
      source: reception.source,
      frequency: null, // AIS is always on 161.975 / 162.025 MHz
      signalLevel: null,
      errorCount: null,
      timestamp: new Date(),
      hasTargetPosition: hasTarget,
    });
  }

  private async processSubscription(
    sub: Subscription,
    parser: (data: any) => CoverageEvent | null,
  ): Promise<void> {
    for await (const msg of sub) {
      this.messagesReceived++;
      try {
        const payload = JSON.parse(msg.string());
        const event = parser(payload);
        if (event) {
          this.messagesParsed++;
          this.onEvent(event);
        }
      } catch {
        this.parseErrors++;
      }
    }
  }

  /** Process raw decoder messages to extract positions not available in processed events */
  private async processRawSubscription(sub: Subscription): Promise<void> {
    for await (const msg of sub) {
      try {
        const payload = JSON.parse(msg.string());
        const event = parseRawForPosition(payload);
        if (event && event.hasTargetPosition) {
          // Resolve station UUID to ID
          if (event.stationId === 0 && event.stationUuid) {
            const id = this.uuidToId.get(event.stationUuid);
            if (id) {
              event.stationId = id;
            } else {
              continue; // Can't process without station ID
            }
          }
          this.rawPositionsFound++;
          this.messagesParsed++;
          this.onEvent(event);
        }
      } catch {
        // Raw messages may not always be valid JSON
      }
    }
  }

  async disconnect(): Promise<void> {
    if (this.marineTimer) {
      clearInterval(this.marineTimer);
      this.marineTimer = null;
    }
    for (const sub of this.subscriptions) {
      sub.unsubscribe();
    }
    if (this.nc) {
      await this.nc.drain();
      this.nc = null;
    }
    console.log('[NATS] Disconnected');
  }

  isConnected(): boolean {
    return this.nc !== null && !this.nc.isClosed();
  }
}
