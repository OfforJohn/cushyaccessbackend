import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Incident } from '../entities/incident.entity';
import { IncidentStatus } from '../enums/incident-status.enum';
import { IncidentPriority } from '../enums/incident-priority.enum';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class IncidentService {
  private readonly logger = new Logger(IncidentService.name);

  constructor(
    @InjectRepository(Incident)
    private incidentRepository: Repository<Incident>,
    private eventEmitter: EventEmitter2,
  ) {}

  async createIncident(incidentData: {
    title: string;
    description?: string;
    priority?: IncidentPriority;
    detectedBy?: string;
    detectingSystem?: string;
    affectedServices?: string[];
    relatedAlertIds?: string[];
    tags?: string[];
  }) {
    const incident = this.incidentRepository.create({
      ...incidentData,
      status: IncidentStatus.DETECTED,
      priority: incidentData.priority || IncidentPriority.MEDIUM,
      timeline: [{
        timestamp: new Date(),
        action: 'incident_detected',
        performedBy: incidentData.detectedBy || 'system',
        notes: 'Incident detected and created',
      }],
    });

    const savedIncident = await this.incidentRepository.save(incident);
    this.eventEmitter.emit('incident.created', savedIncident);
    
    this.logger.log(`Incident created: ${savedIncident.id} - ${savedIncident.title}`);
    return savedIncident;
  }

  async assignIncident(incidentId: string, assignedTo: string, assignedBy: string) {
    const incident = await this.incidentRepository.findOne({ where: { id: incidentId } });
    
    if (!incident) {
      throw new Error('Incident not found');
    }

    incident.status = IncidentStatus.ASSIGNED;
    incident.assignedTo = assignedTo;
    incident.assignedAt = new Date();
    incident.timeline.push({
      timestamp: new Date(),
      action: 'incident_assigned',
      performedBy: assignedBy,
      notes: `Assigned to ${assignedTo}`,
    });

    const updatedIncident = await this.incidentRepository.save(incident);
    this.eventEmitter.emit('incident.assigned', updatedIncident);
    
    return updatedIncident;
  }

  async updateIncidentStatus(
    incidentId: string,
    status: IncidentStatus,
    updatedBy: string,
    notes?: string,
  ) {
    const incident = await this.incidentRepository.findOne({ where: { id: incidentId } });
    
    if (!incident) {
      throw new Error('Incident not found');
    }

    incident.status = status;
    incident.timeline.push({
      timestamp: new Date(),
      action: `status_changed_to_${status}`,
      performedBy: updatedBy,
      notes,
    });

    if (status === IncidentStatus.RESOLVED) {
      incident.resolvedBy = updatedBy;
      incident.resolvedAt = new Date();
      incident.actualResolutionTime = new Date();
    }

    const updatedIncident = await this.incidentRepository.save(incident);
    this.eventEmitter.emit('incident.updated', updatedIncident);
    
    return updatedIncident;
  }

  async resolveIncident(
    incidentId: string,
    resolvedBy: string,
    resolution: string,
    rootCause?: Record<string, any>,
  ) {
    const incident = await this.incidentRepository.findOne({ where: { id: incidentId } });
    
    if (!incident) {
      throw new Error('Incident not found');
    }

    incident.status = IncidentStatus.RESOLVED;
    incident.resolvedBy = resolvedBy;
    incident.resolvedAt = new Date();
    incident.actualResolutionTime = new Date();
    incident.resolution = resolution;
    incident.rootCause = rootCause;
    incident.timeline.push({
      timestamp: new Date(),
      action: 'incident_resolved',
      performedBy: resolvedBy,
      notes: resolution,
    });

    const updatedIncident = await this.incidentRepository.save(incident);
    this.eventEmitter.emit('incident.resolved', updatedIncident);
    
    this.logger.log(`Incident resolved: ${incidentId} by ${resolvedBy}`);
    return updatedIncident;
  }

  async addPostMortem(incidentId: string, postMortemNotes: string, addedBy: string) {
    const incident = await this.incidentRepository.findOne({ where: { id: incidentId } });
    
    if (!incident) {
      throw new Error('Incident not found');
    }

    incident.status = IncidentStatus.POST_MORTEM;
    incident.postMortemNotes = postMortemNotes;
    incident.timeline.push({
      timestamp: new Date(),
      action: 'post_mortem_added',
      performedBy: addedBy,
      notes: 'Post-mortem analysis completed',
    });

    const updatedIncident = await this.incidentRepository.save(incident);
    this.eventEmitter.emit('incident.post_mortem', updatedIncident);
    
    return updatedIncident;
  }

  async closeIncident(incidentId: string, closedBy: string) {
    const incident = await this.incidentRepository.findOne({ where: { id: incidentId } });
    
    if (!incident) {
      throw new Error('Incident not found');
    }

    incident.status = IncidentStatus.CLOSED;
    incident.timeline.push({
      timestamp: new Date(),
      action: 'incident_closed',
      performedBy: closedBy,
      notes: 'Incident closed',
    });

    const updatedIncident = await this.incidentRepository.save(incident);
    this.eventEmitter.emit('incident.closed', updatedIncident);
    
    this.logger.log(`Incident closed: ${incidentId}`);
    return updatedIncident;
  }

  async getIncidentById(incidentId: string) {
    return this.incidentRepository.findOne({ where: { id: incidentId } });
  }

  async getIncidents(filters?: {
    status?: IncidentStatus;
    priority?: IncidentPriority;
    assignedTo?: string;
    limit?: number;
    offset?: number;
  }) {
    const queryBuilder = this.incidentRepository.createQueryBuilder('incident');
    
    if (filters?.status) {
      queryBuilder.andWhere('incident.status = :status', { status: filters.status });
    }
    
    if (filters?.priority) {
      queryBuilder.andWhere('incident.priority = :priority', { priority: filters.priority });
    }
    
    if (filters?.assignedTo) {
      queryBuilder.andWhere('incident.assignedTo = :assignedTo', { assignedTo: filters.assignedTo });
    }
    
    queryBuilder.orderBy('incident.createdAt', 'DESC');
    
    if (filters?.limit) {
      queryBuilder.take(filters.limit);
    }
    
    if (filters?.offset) {
      queryBuilder.skip(filters.offset);
    }
    
    return queryBuilder.getMany();
  }

  async getActiveIncidents() {
    return this.incidentRepository.find({
      where: [
        { status: IncidentStatus.DETECTED },
        { status: IncidentStatus.ASSIGNED },
        { status: IncidentStatus.IN_PROGRESS },
      ],
      order: { priority: 'DESC', createdAt: 'DESC' },
    });
  }

  async getIncidentStats() {
    const total = await this.incidentRepository.count();
    const active = await this.incidentRepository.count({
      where: [
        { status: IncidentStatus.DETECTED },
        { status: IncidentStatus.ASSIGNED },
        { status: IncidentStatus.IN_PROGRESS },
      ],
    });
    const resolved = await this.incidentRepository.count({
      where: { status: IncidentStatus.RESOLVED },
    });
    const closed = await this.incidentRepository.count({
      where: { status: IncidentStatus.CLOSED },
    });

    return { total, active, resolved, closed };
  }
}