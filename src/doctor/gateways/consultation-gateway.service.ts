import { Injectable } from '@nestjs/common';
import { Server } from 'socket.io';

@Injectable()
export class ConsultationGatewayService {
  private server: Server | null = null;

  setServer(server: Server) {
    this.server = server;
  }

  getServer(): Server | null {
    return this.server;
  }

  emitToPatient(patientId: string, event: string, payload: any) {
    this.server?.to(`patient:${patientId}`).emit(event, payload);
  }

  emitToDoctor(doctorId: string, event: string, payload: any) {
    this.server?.to(`doctor:${doctorId}`).emit(event, payload);
  }
}
