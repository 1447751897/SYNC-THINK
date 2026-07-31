export interface ProjectTerminalReservation<TCommand> {
  readonly senderId: number;
  readonly terminalId: string;
  readonly controller: AbortController;
  command?: TCommand;
}

function reservationKey(senderId: number, terminalId: string): string {
  return `${senderId}:${terminalId}`;
}

export class ProjectTerminalRegistry<TCommand extends { commandId: string }> {
  private readonly reservations = new Map<string, ProjectTerminalReservation<TCommand>>();

  reserve(senderId: number, terminalId: string): ProjectTerminalReservation<TCommand> | undefined {
    const key = reservationKey(senderId, terminalId);
    if (this.reservations.has(key)) return undefined;
    const reservation: ProjectTerminalReservation<TCommand> = {
      senderId,
      terminalId,
      controller: new AbortController(),
    };
    this.reservations.set(key, reservation);
    return reservation;
  }

  activate(
    reservation: ProjectTerminalReservation<TCommand>,
    command: TCommand,
  ): boolean {
    if (
      reservation.controller.signal.aborted ||
      this.reservations.get(reservationKey(reservation.senderId, reservation.terminalId)) !==
        reservation
    ) {
      return false;
    }
    reservation.command = command;
    return true;
  }

  cancel(senderId: number, terminalId: string, commandId: string): boolean {
    const reservation = this.reservations.get(reservationKey(senderId, terminalId));
    if (!reservation?.command || reservation.command.commandId !== commandId) return false;
    reservation.controller.abort();
    return true;
  }

  abortForSender(senderId: number): void {
    for (const reservation of this.reservations.values()) {
      if (reservation.senderId === senderId) reservation.controller.abort();
    }
  }

  abortAll(): void {
    for (const reservation of this.reservations.values()) reservation.controller.abort();
  }

  release(reservation: ProjectTerminalReservation<TCommand>): void {
    const key = reservationKey(reservation.senderId, reservation.terminalId);
    if (this.reservations.get(key) === reservation) this.reservations.delete(key);
  }

  has(senderId: number, terminalId: string): boolean {
    return this.reservations.has(reservationKey(senderId, terminalId));
  }
}
