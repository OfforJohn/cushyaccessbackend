import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger, UseGuards } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { WsJwtGuard } from '../../auth/service/ws-jwt.guard';

@WebSocketGateway({
  namespace: 'monitoring',
  cors: {
    origin: [
      'https://cagconsole.cushyaccess.com',
      'http://localhost:5173',
      'http://localhost:3000',
    ],
    credentials: true,
  },
})
@UseGuards(WsJwtGuard)
export class MonitoringGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(MonitoringGateway.name);
  private connectedClients = new Map<string, Set<string>>();

  constructor(private jwtService: JwtService) {}

  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth.token || client.handshake.headers.authorization?.replace('Bearer ', '');
      
      if (!token) {
        this.logger.warn(`Connection rejected: No token provided for client ${client.id}`);
        client.disconnect();
        return;
      }

      const payload = this.jwtService.verify(token);
      const userId = payload.sub;
      const userRole = payload.role;

      // Join appropriate rooms based on role
      if (userRole === 'ADMIN' || userRole === 'SUPER_ADMIN') {
        client.join('admin');
        client.join('operations');
        client.join('alerts');
      } else if (userRole === 'OPS_MANAGER') {
        client.join('operations');
        client.join('alerts');
      } else if (userRole === 'RIDER') {
        client.join('riders');
      } else if (userRole === 'VENDOR') {
        client.join('vendors');
      }

      // Track client connection
      if (!this.connectedClients.has(userId)) {
        this.connectedClients.set(userId, new Set());
      }
      this.connectedClients.get(userId)!.add(client.id);

      this.logger.log(`Client connected: ${client.id} (User: ${userId}, Role: ${userRole})`);
      
      // Send welcome message
      client.emit('connected', {
        message: 'Connected to monitoring gateway',
        rooms: Array.from(client.rooms),
      });
    } catch (error) {
      this.logger.error(`Connection error for client ${client.id}:`, error);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    // Remove client from tracking
    for (const [userId, clients] of this.connectedClients.entries()) {
      if (clients.has(client.id)) {
        clients.delete(client.id);
        if (clients.size === 0) {
          this.connectedClients.delete(userId);
        }
        break;
      }
    }

    this.logger.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('join-room')
  handleJoinRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { room: string },
  ) {
    client.join(data.room);
    this.logger.log(`Client ${client.id} joined room: ${data.room}`);
    client.emit('joined-room', { room: data.room });
  }

  @SubscribeMessage('leave-room')
  handleLeaveRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { room: string },
  ) {
    client.leave(data.room);
    this.logger.log(`Client ${client.id} left room: ${data.room}`);
    client.emit('left-room', { room: data.room });
  }

  // Methods to broadcast updates to specific rooms
  broadcastToRoom(room: string, event: string, data: any) {
    this.server.to(room).emit(event, data);
    this.logger.debug(`Broadcasted to room ${room}: ${event}`);
  }

  broadcastToAdmin(event: string, data: any) {
    this.server.to('admin').emit(event, data);
  }

  broadcastToOperations(event: string, data: any) {
    this.server.to('operations').emit(event, data);
  }

  broadcastToAlerts(event: string, data: any) {
    this.server.to('alerts').emit(event, data);
  }

  broadcastToRiders(event: string, data: any) {
    this.server.to('riders').emit(event, data);
  }

  broadcastToVendors(event: string, data: any) {
    this.server.to('vendors').emit(event, data);
  }

  // Specific update methods
  broadcastOperationsUpdate(data: any) {
    this.broadcastToOperations('operations-update', data);
  }

  broadcastAlert(alert: any) {
    this.broadcastToAlerts('new-alert', alert);
  }

  broadcastAlertUpdate(alert: any) {
    this.broadcastToAlerts('alert-updated', alert);
  }

  broadcastIncident(incident: any) {
    this.broadcastToAdmin('new-incident', incident);
  }

  broadcastIncidentUpdate(incident: any) {
    this.broadcastToAdmin('incident-updated', incident);
  }

  broadcastSystemHealth(data: any) {
    this.broadcastToAdmin('system-health-update', data);
  }

  broadcastLiveMapUpdate(data: any) {
    this.broadcastToOperations('live-map-update', data);
  }
}