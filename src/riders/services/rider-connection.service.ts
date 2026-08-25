import { Injectable, Logger } from '@nestjs/common';

export interface ConnectedUser {
  userId: string;
  socketId: string;
  role: string;
  connectedAt: Date;
}

export interface RiderLocation {
  latitude: number;
  longitude: number;
  heading?: number;
  speed?: number;
  accuracy?: number;
  batteryLevel?: number;
  orderId?: string;
  updatedAt?: Date;
}

@Injectable()
export class RiderConnectionService {
  private readonly logger = new Logger(RiderConnectionService.name);

  // Module-level state using maps to avoid Proxy context issues entirely
  private readonly connectedUsers = new Map<string, ConnectedUser>(); // socketId -> ConnectedUser
  private readonly usersById = new Map<string, string>(); // userId or riderId -> socketId
  private readonly riderLocations = new Map<string, RiderLocation>(); // userId or riderId -> Location
  private readonly userToRiderMap = new Map<string, string>(); // userId <-> riderId
  private readonly riderToUserMap = new Map<string, string>(); // riderId <-> userId

  linkUserAndRider(userId: string, riderId: string) {
    if (userId && riderId) {
      this.userToRiderMap.set(userId, riderId);
      this.riderToUserMap.set(riderId, userId);
      const socketId =
        this.usersById.get(userId) || this.usersById.get(riderId);
      if (socketId) {
        this.usersById.set(userId, socketId);
        this.usersById.set(riderId, socketId);
      }
      const loc =
        this.riderLocations.get(userId) || this.riderLocations.get(riderId);
      if (loc) {
        this.riderLocations.set(userId, loc);
        this.riderLocations.set(riderId, loc);
      }
    }
  }

  addConnection(
    socketId: string,
    userId: string,
    role: string = 'RIDER',
    riderId?: string,
  ) {
    this.connectedUsers.set(socketId, {
      userId,
      socketId,
      role,
      connectedAt: new Date(),
    });
    this.usersById.set(userId, socketId);
    if (riderId) {
      this.usersById.set(riderId, socketId);
      this.linkUserAndRider(userId, riderId);
    }
    this.logger.debug(
      `User ${userId} (riderId: ${riderId || 'N/A'}, ${role}) connected with socket ${socketId}`,
    );
  }

  removeConnection(socketId: string) {
    const user = this.connectedUsers.get(socketId);
    if (user) {
      if (this.usersById.get(user.userId) === socketId) {
        this.usersById.delete(user.userId);
      }
      const altId =
        this.userToRiderMap.get(user.userId) ||
        this.riderToUserMap.get(user.userId);
      if (altId && this.usersById.get(altId) === socketId) {
        this.usersById.delete(altId);
      }
      this.connectedUsers.delete(socketId);
      this.logger.debug(
        `User ${user.userId} disconnected (socket ${socketId})`,
      );
    }
  }

  getSocketIdByUserId(userId: string): string | undefined {
    let socketId = this.usersById.get(userId);
    if (!socketId) {
      const altId =
        this.userToRiderMap.get(userId) || this.riderToUserMap.get(userId);
      if (altId) socketId = this.usersById.get(altId);
    }
    return socketId;
  }

  getUserIdBySocketId(socketId: string): string | undefined {
    const user = this.connectedUsers.get(socketId);
    return user?.userId;
  }

  getRoleBySocketId(socketId: string): string | undefined {
    return this.connectedUsers.get(socketId)?.role;
  }

  getRiderIdBySocketId(socketId: string): string | undefined {
    const userId = this.getUserIdBySocketId(socketId);
    return userId ? this.userToRiderMap.get(userId) : undefined;
  }

  updateLocation(id: string, location: Partial<RiderLocation>) {
    const altId = this.userToRiderMap.get(id) || this.riderToUserMap.get(id);
    const existing = this.riderLocations.get(id) ||
      (altId ? this.riderLocations.get(altId) : null) || {
        latitude: 0,
        longitude: 0,
      };
    const updated = {
      ...existing,
      ...location,
      updatedAt: new Date(),
    };
    this.riderLocations.set(id, updated);
    if (altId) {
      this.riderLocations.set(altId, updated);
    }
  }

  getLocation(id: string): RiderLocation | undefined {
    let loc = this.riderLocations.get(id);
    if (!loc) {
      const altId = this.userToRiderMap.get(id) || this.riderToUserMap.get(id);
      if (altId) loc = this.riderLocations.get(altId);
    }
    return loc;
  }

  getConnectedCount(): number {
    return this.connectedUsers.size;
  }

  isRiderOnline(id: string): boolean {
    if (this.usersById.has(id)) return true;
    const altId = this.userToRiderMap.get(id) || this.riderToUserMap.get(id);
    return altId ? this.usersById.has(altId) : false;
  }
}
