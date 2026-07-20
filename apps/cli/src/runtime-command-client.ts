import { randomBytes } from 'node:crypto';
import { connect, type Socket } from 'node:net';
import {
  DEFAULT_FEATURES,
  PROTOCOL_VERSION,
  computeClientProof,
  computeHmac,
  computeRuntimeProof,
  decodeFrames,
  encodeFrame,
  pipePathPortable,
  verifyHmac,
  type CommandCallerSurface,
  type CommandType,
  type Frame,
  type Hello,
  type HelloChallengePayload,
  type HelloProofPayload,
} from '@sync-think/protocol';

export interface RuntimeCommandClientOptions {
  installId: string;
  appVersion: string;
  helloSecret?: string;
  requestTimeoutMs?: number;
  callerSurface: CommandCallerSurface;
}

interface PendingRequest {
  resolve: (payload: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export interface RuntimeCommandRequestOptions {
  confirmationToken?: string;
}

export class RuntimeCommandError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'RuntimeCommandError';
  }
}

function isChallenge(value: unknown): value is HelloChallengePayload {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<HelloChallengePayload>;
  return (
    candidate.challenge === true &&
    typeof candidate.runtimeNonce === 'string' &&
    typeof candidate.runtimeToken === 'string'
  );
}

function isAccepted(value: unknown): value is { ok: true } {
  return Boolean(value && typeof value === 'object' && (value as { ok?: unknown }).ok === true);
}

export class RuntimeCommandClient {
  private socket: Socket | undefined;
  private pendingBytes: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  private readonly pending = new Map<string, PendingRequest>();

  constructor(private readonly options: RuntimeCommandClientOptions) {}

  async connect(): Promise<void> {
    if (this.socket && !this.socket.destroyed) return;
    const socket = connect(pipePathPortable(this.options.installId));
    this.socket = socket;
    socket.setNoDelay(true);
    socket.on('data', (chunk: Buffer) => this.onData(chunk));
    socket.on('close', () => this.onDisconnect(new Error('SYNC-THINK Runtime disconnected')));
    socket.on('error', (error) => this.onDisconnect(error));
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('error', reject);
    });

    const nonce = randomBytes(16).toString('hex');
    const hello: Hello = {
      protocolVersion: PROTOCOL_VERSION,
      appVersion: this.options.appVersion,
      installId: this.options.installId,
      nonce,
      features: [...DEFAULT_FEATURES],
    };
    if (this.options.helloSecret) {
      hello.token = computeHmac(this.options.helloSecret, nonce, this.options.installId);
    }
    const response = await this.send('__hello', hello);
    if (!this.options.helloSecret) {
      if (!isAccepted(response)) throw new Error('SYNC-THINK Runtime authentication failed');
      return;
    }
    if (!isChallenge(response)) throw new Error('SYNC-THINK Runtime authentication failed');
    const expectedRuntimeProof = computeRuntimeProof(
      this.options.helloSecret,
      nonce,
      response.runtimeNonce,
      this.options.installId,
    );
    if (!verifyHmac(expectedRuntimeProof, response.runtimeToken)) {
      throw new Error('SYNC-THINK Runtime authentication failed');
    }
    const proof: HelloProofPayload = {
      installId: this.options.installId,
      clientNonce: nonce,
      runtimeNonce: response.runtimeNonce,
      token: computeClientProof(
        this.options.helloSecret,
        nonce,
        response.runtimeNonce,
        this.options.installId,
      ),
    };
    if (!isAccepted(await this.send('__hello.proof', proof))) {
      throw new Error('SYNC-THINK Runtime authentication failed');
    }
  }

  async request<T = unknown>(
    type: CommandType,
    payload: unknown,
    options: RuntimeCommandRequestOptions = {},
  ): Promise<T> {
    await this.connect();
    return this.send(type, payload, options) as Promise<T>;
  }

  close(): void {
    const socket = this.socket;
    this.socket = undefined;
    if (socket && !socket.destroyed) socket.destroy();
    this.rejectPending(new Error('SYNC-THINK Runtime client closed'));
  }

  private send(
    type: string,
    payload: unknown,
    options: RuntimeCommandRequestOptions = {},
  ): Promise<unknown> {
    const socket = this.socket;
    if (!socket || socket.destroyed) {
      return Promise.reject(new Error('SYNC-THINK Runtime is not connected'));
    }
    const id = `external_${randomBytes(12).toString('hex')}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`SYNC-THINK Runtime request timed out: ${type}`));
      }, this.options.requestTimeoutMs ?? 10_000);
      this.pending.set(id, { resolve, reject, timer });
      socket.write(
        encodeFrame({
          id,
          kind: 'request',
          type,
          payload,
          meta: {
            callerSurface: this.options.callerSurface,
            ...(options.confirmationToken ? { confirmationToken: options.confirmationToken } : {}),
          },
        }),
      );
    });
  }

  private onData(chunk: Buffer): void {
    try {
      const decoded = decodeFrames(Buffer.concat([this.pendingBytes, chunk]));
      this.pendingBytes = decoded.remaining;
      for (const frame of decoded.frames) this.onFrame(frame);
    } catch {
      this.onDisconnect(new Error('SYNC-THINK Runtime protocol error'));
    }
  }

  private onFrame(frame: Frame): void {
    if (frame.kind !== 'response') return;
    const pending = this.pending.get(frame.id);
    if (!pending) return;
    this.pending.delete(frame.id);
    clearTimeout(pending.timer);
    if (frame.error) {
      pending.reject(new RuntimeCommandError(frame.error.code, frame.error.message));
      return;
    }
    pending.resolve(frame.payload);
  }

  private onDisconnect(error: Error): void {
    if (this.socket?.destroyed) this.socket = undefined;
    this.pendingBytes = Buffer.alloc(0);
    this.rejectPending(error);
  }

  private rejectPending(error: Error): void {
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.pending.clear();
  }
}
