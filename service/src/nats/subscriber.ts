import { connect, type NatsConnection, type Subscription, StringCodec, credsAuthenticator } from 'nats';
import { config } from '../config.js';
import { parseAircraftMessage, parseAircraftFlight } from './parsers/aircraft.js';
import { parseVoyagePosition, parseVoyage, parseAisMessage } from './parsers/marine.js';
import type { CoverageEvent } from '../types/events.js';

const sc = StringCodec();

/** All NATS subjects we subscribe to and their parser functions */
const SUBSCRIPTIONS: Array<{
  subject: string;
  parser: (data: any) => CoverageEvent | null;
}> = [
  // Aircraft messages (all sources: acarsdec, dumpvdl2, dumphfdl, jaero, etc.)
  { subject: 'v1.aircraft.ingest.*.message.*.created', parser: parseAircraftMessage },
  // Aircraft message reports (VDL/HFDL detailed reports)
  { subject: 'v1.aircraft.ingest.*.message.*.report.*.created', parser: parseAircraftMessage },
  // Aircraft flight updates (enriched position data)
  { subject: 'v1.aircraft.ingest.*.flight.*.updated', parser: parseAircraftFlight },
  { subject: 'v1.aircraft.ingest.*.flight.*.created', parser: parseAircraftFlight },
  // Marine voyage positions (AIS position reports)
  { subject: 'v1.marine.voyage-position.created', parser: parseVoyagePosition },
  // Marine voyage updates
  { subject: 'v1.marine.voyage.created', parser: parseVoyage },
  { subject: 'v1.marine.voyage.updated', parser: parseVoyage },
  // Marine AIS messages (proves reception even without position)
  { subject: 'v1.marine.ais_message.created', parser: parseAisMessage },
];

export class NatsSubscriber {
  private nc: NatsConnection | null = null;
  private subscriptions: Subscription[] = [];
  private onEvent: (event: CoverageEvent) => void;

  // Metrics
  public messagesReceived = 0;
  public messagesParsed = 0;
  public parseErrors = 0;

  constructor(onEvent: (event: CoverageEvent) => void) {
    this.onEvent = onEvent;
  }

  async connect(): Promise<void> {
    const opts: Record<string, any> = {
      servers: config.natsUrl,
      name: 'coverage-service',
      maxReconnectAttempts: -1,
      reconnectTimeWait: 2000,
    };

    // Use JWT + NKEY auth if configured
    if (config.natsJwt && config.natsNkeySeed) {
      const creds = new TextEncoder().encode(
        `-----BEGIN NATS USER JWT-----\n${config.natsJwt}\n------END NATS USER JWT------\n\n-----BEGIN USER NKEY SEED-----\n${config.natsNkeySeed}\n------END USER NKEY SEED------\n`
      );
      opts.authenticator = credsAuthenticator(creds);
    }

    this.nc = await connect(opts);
    console.log(`[NATS] Connected to ${config.natsUrl}`);

    // Subscribe to all subjects
    for (const { subject, parser } of SUBSCRIPTIONS) {
      const sub = this.nc.subscribe(subject);
      this.subscriptions.push(sub);
      this.processSubscription(sub, parser, subject);
    }

    console.log(`[NATS] Subscribed to ${SUBSCRIPTIONS.length} subject patterns`);
  }

  private async processSubscription(
    sub: Subscription,
    parser: (data: any) => CoverageEvent | null,
    subject: string,
  ): Promise<void> {
    for await (const msg of sub) {
      this.messagesReceived++;
      try {
        const payload = JSON.parse(sc.decode(msg.data));
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

  async disconnect(): Promise<void> {
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
