// src/doctor/gateways/consultation.gateway.ts

import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger, Optional } from '@nestjs/common';
import { ConsultationGatewayService } from './consultation-gateway.service';
import { DoctorViewConsultationRequestUseCase } from '../usecases/doctor-view-consultation-request.usecase';
import { JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';
import { Users } from '../../users/model/users.entity';
import { UserRoles } from '../../users/model/user-roles.enum';

const consultationGatewayLogger = new Logger('ConsultationGateway');

type AuthenticatedSocketUser = {
  id: string;
  role: UserRoles;
  email?: string;
  mobile?: string;
  sessionVersion: number;
};

@WebSocketGateway({
  cors: { origin: '*' },
  namespace: '/api/v1/consultations',
})
export class ConsultationGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly doctorSockets = new Map<string, Set<string>>();

  constructor(
    @Optional()
    private readonly gatewayService: ConsultationGatewayService,

    private readonly doctorViewUseCase: DoctorViewConsultationRequestUseCase,

    private readonly jwtService: JwtService,

    private readonly dataSource: DataSource,
  ) {
    this.handleConnection = this.handleConnection.bind(this);
    this.handleDisconnect = this.handleDisconnect.bind(this);
    this.handleRegisterDoctor = this.handleRegisterDoctor.bind(this);
    this.handleRegisterPatient = this.handleRegisterPatient.bind(this);
    this.handleAcceptConsultation = this.handleAcceptConsultation.bind(this);
    this.handleRejectConsultation = this.handleRejectConsultation.bind(this);

    consultationGatewayLogger.log(
      `[DEBUG] GatewayService injected = ${!!this.gatewayService}`,
    );
  }

  afterInit(server: Server) {
    consultationGatewayLogger.log(
      `[DEBUG] afterInit triggered. Service available: ${!!this.gatewayService}`,
    );

    if (!this.gatewayService) {
      consultationGatewayLogger.error(
        'ConsultationGatewayService was not injected; consultation websocket emits will be disabled.',
      );
      return;
    }

    this.gatewayService.setServer(server);
    consultationGatewayLogger.log(
      '✅ ConsultationGateway initialized successfully',
    );
  }

  async handleConnection(client: Socket) {
    const authentication = this.authenticateClient(client);
    client.data.authenticationPromise = authentication;
    try {
      await authentication;
      consultationGatewayLogger.log(`Client authenticated: ${client.id}`);
    } catch (error) {
      consultationGatewayLogger.warn(
        `Rejected consultation socket ${client.id}: ${
          error instanceof Error ? error.message : 'Authentication failed'
        }`,
      );
      client.emit('auth:error', { message: 'Unauthorized' });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) {
    for (const [doctorId, sockets] of this.doctorSockets.entries()) {
      if (sockets.has(client.id)) {
        sockets.delete(client.id);
        if (sockets.size === 0) this.doctorSockets.delete(doctorId);
        consultationGatewayLogger.log(
          `Doctor ${doctorId} socket ${client.id} removed`,
        );
      }
    }
    consultationGatewayLogger.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('register_doctor')
  async handleRegisterDoctor(
    @MessageBody() data: { doctorId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const { doctorId } = data;
    let authenticatedUser: AuthenticatedSocketUser;
    try {
      authenticatedUser = await this.requireLiveAuthentication(client);
    } catch {
      return { event: 'error', data: { message: 'Unauthorized' } };
    }
    if (
      authenticatedUser.id !== doctorId ||
      authenticatedUser.role !== UserRoles.DOCTOR
    ) {
      return { event: 'error', data: { message: 'Unauthorized' } };
    }

    if (!this.doctorSockets.has(doctorId)) {
      this.doctorSockets.set(doctorId, new Set());
    }
    this.doctorSockets.get(doctorId)!.add(client.id);
    client.join(`doctor:${doctorId}`);

    consultationGatewayLogger.log(
      `Doctor ${doctorId} registered with socket ${client.id}`,
    );
    return { event: 'registered', data: { doctorId, socketId: client.id } };
  }

  @SubscribeMessage('register_patient')
  async handleRegisterPatient(
    @MessageBody() data: { patientId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const { patientId } = data;
    let authenticatedUser: AuthenticatedSocketUser;
    try {
      authenticatedUser = await this.requireLiveAuthentication(client);
    } catch {
      return { event: 'error', data: { message: 'Unauthorized' } };
    }
    if (
      authenticatedUser.id !== patientId ||
      authenticatedUser.role !== UserRoles.CUSTOMER
    ) {
      return { event: 'error', data: { message: 'Unauthorized' } };
    }
    client.join(`patient:${patientId}`);
    consultationGatewayLogger.log(
      `Patient ${patientId} registered with socket ${client.id}`,
    );
    return { event: 'registered', data: { patientId, socketId: client.id } };
  }

  private extractToken(client: Socket): string | undefined {
    const authToken = client.handshake.auth?.token;
    if (typeof authToken === 'string' && authToken) return authToken;

    const authHeader =
      client.handshake.headers['cushy-access-key'] ||
      client.handshake.headers.authorization;
    if (typeof authHeader !== 'string') return undefined;
    const [type, token] = authHeader.split(' ');
    return type === 'Bearer' ? token : authHeader;
  }

  private async authenticateClient(client: Socket): Promise<void> {
    const token = this.extractToken(client);
    if (!token) throw new Error('Authentication token is required');

    const payload = this.jwtService.verify(token) as {
      userId?: string;
      sub?: string;
      role?: string;
      sessionVersion?: number;
    };
    const userId = payload.userId || payload.sub;
    if (!userId) throw new Error('Invalid authentication token');

    const user = await this.dataSource.getRepository(Users).findOne({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        mobile: true,
        userRole: true,
        sessionVersion: true,
      },
    });
    if (
      !user ||
      String(user.userRole).toUpperCase() !==
        String(payload.role || '').toUpperCase() ||
      (payload.sessionVersion ?? 0) !== (user.sessionVersion ?? 0)
    ) {
      throw new Error('Account is missing or session has been revoked');
    }

    client.data.user = {
      id: user.id,
      role: user.userRole,
      email: user.email,
      mobile: user.mobile,
      sessionVersion: user.sessionVersion ?? 0,
    } satisfies AuthenticatedSocketUser;
  }

  private async requireLiveAuthentication(
    client: Socket,
  ): Promise<AuthenticatedSocketUser> {
    const authentication = client.data.authenticationPromise as
      | Promise<void>
      | undefined;
    if (authentication) await authentication;

    const authenticatedUser = client.data.user as
      | AuthenticatedSocketUser
      | undefined;
    if (!authenticatedUser?.id) throw new Error('Unauthorized');

    const liveUser = await this.dataSource.getRepository(Users).findOne({
      where: { id: authenticatedUser.id },
      select: { id: true, userRole: true, sessionVersion: true },
    });
    if (
      !liveUser ||
      liveUser.userRole !== authenticatedUser.role ||
      (liveUser.sessionVersion ?? 0) !== authenticatedUser.sessionVersion
    ) {
      client.disconnect(true);
      throw new Error('Account is missing or session has been revoked');
    }
    return authenticatedUser;
  }

  // Handle doctor accepting the consultation
  @SubscribeMessage('consultation:accept')
  async handleAcceptConsultation(
    @MessageBody() data: { appointmentId: string },
    @ConnectedSocket() client: Socket,
  ) {
    consultationGatewayLogger.log(
      `Doctor accepting consultation: ${data.appointmentId}`,
    );

    try {
      const authenticatedUser = await this.requireLiveAuthentication(client);
      if (authenticatedUser.role !== UserRoles.DOCTOR) {
        return { event: 'error', data: { message: 'Unauthorized' } };
      }

      // Find which doctor this socket belongs to
      let doctorId: string | null = null;
      for (const [id, sockets] of this.doctorSockets.entries()) {
        if (sockets.has(client.id)) {
          doctorId = id;
          break;
        }
      }

      if (!doctorId) {
        consultationGatewayLogger.error(
          `Doctor not found for socket ${client.id}`,
        );
        return {
          event: 'error',
          data: { message: 'Doctor not registered' },
        };
      }
      if (doctorId !== authenticatedUser.id) {
        return { event: 'error', data: { message: 'Unauthorized' } };
      }

      if (!this.doctorViewUseCase) {
        return {
          event: 'error',
          data: { message: 'Consultation response service unavailable' },
        };
      }

      const response = await this.doctorViewUseCase.respondToRequestForDoctor(
        data.appointmentId,
        'accept',
        doctorId,
      );
      const meetingDetails = response.toJSON().data;

      consultationGatewayLogger.log(
        `Appointment ${data.appointmentId} accepted by doctor ${doctorId}`,
      );

      // Confirm to the doctor that acceptance was processed
      // This will also trigger the meeting to start on doctor's app
      return {
        event: 'consultation_accepted',
        data: {
          ...meetingDetails,
          message: 'Consultation accepted successfully',
        },
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      consultationGatewayLogger.error(
        `Error accepting consultation: ${errorMessage}`,
      );
      return {
        event: 'error',
        data: { message: errorMessage },
      };
    }
  }

  // Optional: Handle doctor rejecting the consultation
  @SubscribeMessage('consultation:reject')
  async handleRejectConsultation(
    @MessageBody() data: { appointmentId: string },
    @ConnectedSocket() client: Socket,
  ) {
    consultationGatewayLogger.log(
      `Doctor rejecting consultation: ${data.appointmentId}`,
    );

    try {
      const authenticatedUser = await this.requireLiveAuthentication(client);
      if (authenticatedUser.role !== UserRoles.DOCTOR) {
        return { event: 'error', data: { message: 'Unauthorized' } };
      }

      let doctorId: string | null = null;
      for (const [id, sockets] of this.doctorSockets.entries()) {
        if (sockets.has(client.id)) {
          doctorId = id;
          break;
        }
      }

      if (!doctorId) {
        return { event: 'error', data: { message: 'Doctor not registered' } };
      }
      if (doctorId !== authenticatedUser.id) {
        return { event: 'error', data: { message: 'Unauthorized' } };
      }

      if (!this.doctorViewUseCase) {
        return {
          event: 'error',
          data: { message: 'Consultation response service unavailable' },
        };
      }

      const response = await this.doctorViewUseCase.respondToRequestForDoctor(
        data.appointmentId,
        'reject',
        doctorId,
      );

      return { event: 'consultation_rejected', data: response.toJSON().data };
    } catch (error) {
      consultationGatewayLogger.error(`Error rejecting consultation: ${error}`);
      return { event: 'error', data: { message: error } };
    }
  }
}
