
export class OrderCreatedEvent {
  constructor(
    public readonly orderId: string,
    public readonly userId: string,
    public readonly timestamp: Date = new Date(),
  ) {}
}

export class OrderStatusChangedEvent {
  constructor(
    public readonly orderId: string,
    public readonly oldStatus: string,
    public readonly newStatus: string,
    public readonly userId: string,
    public readonly timestamp: Date = new Date(),
  ) {}
}

export class OrderAcceptedEvent {
  constructor(
    public readonly orderId: string,
    public readonly riderId: string,
    public readonly userId: string,
    public readonly timestamp: Date = new Date(),
  ) {}
}

export class OrderPickedUpEvent {
  constructor(
    public readonly orderId: string,
    public readonly riderId: string,
    public readonly userId: string,
    public readonly timestamp: Date = new Date(),
  ) {}
}

export class OrderInTransitEvent {
  constructor(
    public readonly orderId: string,
    public readonly riderId: string,
    public readonly userId: string,
    public readonly timestamp: Date = new Date(),
  ) {}
}

export class OrderDeliveredEvent {
  constructor(
    public readonly orderId: string,
    public readonly riderId: string,
    public readonly userId: string,
    public readonly deliveryData?: {
      deliveryPhoto?: string;
      signature?: string;
      deliveryTime?: number;
    },
    public readonly timestamp: Date = new Date(),
  ) {}
}

export class OrderCancelledEvent {
  constructor(
    public readonly orderId: string,
    public readonly userId: string,
    public readonly reason?: string,
    public readonly timestamp: Date = new Date(),
  ) {}
}

export class OrderRejectedEvent {
  constructor(
    public readonly orderId: string,
    public readonly riderId: string,
    public readonly userId: string,
    public readonly reason: string,
    public readonly timestamp: Date = new Date(),
  ) {}
}

export class OrderAssignedEvent {
  constructor(
    public readonly orderId: string,
    public readonly riderId: string,
    public readonly assignedBy: string,
    public readonly timestamp: Date = new Date(),
  ) {}
}

export class OrderTrackingAddedEvent {
  constructor(
    public readonly orderId: string,
    public readonly status: string,
    public readonly description?: string,
    public readonly userId?: string,
    public readonly timestamp: Date = new Date(),
  ) {}
}

export class RiderRegisteredEvent {
  constructor(
    public readonly riderId: string,
    public readonly userId: string,
    public readonly timestamp: Date = new Date(),
  ) {}
}

export class RiderStatusChangedEvent {
  constructor(
    public readonly riderId: string,
    public readonly oldStatus: string,
    public readonly newStatus: string,
    public readonly updatedBy?: string,
    public readonly reason?: string,
    public readonly timestamp: Date = new Date(),
  ) {}
}

export class RiderOnlineStatusChangedEvent {
  constructor(
    public readonly riderId: string,
    public readonly isOnline: boolean,
    public readonly timestamp: Date = new Date(),
  ) {}
}

export class RiderLocationUpdatedEvent {
  constructor(
    public readonly riderId: string,
    public readonly latitude: number,
    public readonly longitude: number,
    public readonly accuracy?: number,
    public readonly altitude?: number,
    public readonly speed?: number,
    public readonly heading?: number,
    public readonly timestamp: Date = new Date(),
    public readonly batteryLevel?: number,
  ) {}
}

export class RiderAvailabilityChangedEvent {
  constructor(
    public readonly riderId: string,
    public readonly isAvailable: boolean,
    public readonly timestamp: Date = new Date(),
  ) {}
}

export class RiderEarningsUpdatedEvent {
  constructor(
    public readonly riderId: string,
    public readonly amount: number,
    public readonly orderId?: string,
    public readonly type?: 'delivery' | 'bonus' | 'tip' | 'adjustment',
    public readonly timestamp: Date = new Date(),
  ) {}
}

export class RiderDocumentVerifiedEvent {
  constructor(
    public readonly riderId: string,
    public readonly documentId: string,
    public readonly documentType: string,
    public readonly status: string,
    public readonly verifiedBy?: string,
    public readonly timestamp: Date = new Date(),
  ) {}
}

export class RiderTrainingCompletedEvent {
  constructor(
    public readonly riderId: string,
    public readonly completedAt: Date = new Date(),
  ) {}
}

export class RiderBackgroundCheckCompletedEvent {
  constructor(
    public readonly riderId: string,
    public readonly status: 'approved' | 'rejected',
    public readonly notes?: string,
    public readonly timestamp: Date = new Date(),
  ) {}
}


export class DeliveryStartedEvent {
  constructor(
    public readonly orderId: string,
    public readonly riderId: string,
    public readonly userId: string,
    public readonly timestamp: Date = new Date(),
  ) {}
}

export class DeliveryCompletedEvent {
  constructor(
    public readonly orderId: string,
    public readonly riderId: string,
    public readonly userId: string,
    public readonly deliveryData?: {
      deliveryPhoto?: string;
      signature?: string;
      deliveryTime?: number;
      distance?: number;
      rating?: number;
    },
    public readonly timestamp: Date = new Date(),
  ) {}
}

export class DeliveryFailedEvent {
  constructor(
    public readonly orderId: string,
    public readonly riderId: string,
    public readonly userId: string,
    public readonly reason: string,
    public readonly timestamp: Date = new Date(),
  ) {}
}


export class PaymentInitiatedEvent {
  constructor(
    public readonly orderId: string,
    public readonly userId: string,
    public readonly amount: number,
    public readonly method: string,
    public readonly reference: string,
    public readonly timestamp: Date = new Date(),
  ) {}
}

export class PaymentCompletedEvent {
  constructor(
    public readonly orderId: string,
    public readonly userId: string,
    public readonly amount: number,
    public readonly method: string,
    public readonly reference: string,
    public readonly transactionId: string,
    public readonly timestamp: Date = new Date(),
  ) {}
}

export class PaymentFailedEvent {
  constructor(
    public readonly orderId: string,
    public readonly userId: string,
    public readonly amount: number,
    public readonly method: string,
    public readonly reason: string,
    public readonly timestamp: Date = new Date(),
  ) {}
}

export class PaymentRefundedEvent {
  constructor(
    public readonly orderId: string,
    public readonly userId: string,
    public readonly amount: number,
    public readonly refundReference: string,
    public readonly reason?: string,
    public readonly timestamp: Date = new Date(),
  ) {}
}


export class OrderNotificationEvent {
  constructor(
    public readonly userId: string,
    public readonly orderId: string,
    public readonly type: 'order_created' | 'order_accepted' | 'order_picked_up' | 'order_in_transit' | 'order_delivered' | 'order_cancelled',
    public readonly title: string,
    public readonly message: string,
    public readonly data?: Record<string, any>,
    public readonly timestamp: Date = new Date(),
  ) {}
}

export class RiderNotificationEvent {
  constructor(
    public readonly riderId: string,
    public readonly type: 'new_order' | 'order_cancelled' | 'order_updated' | 'payout' | 'documents',
    public readonly title: string,
    public readonly message: string,
    public readonly data?: Record<string, any>,
    public readonly timestamp: Date = new Date(),
  ) {}
}

export class AdminNotificationEvent {
  constructor(
    public readonly adminId: string,
    public readonly type: 'rider_issue' | 'order_issue' | 'payment_issue' | 'system_alert',
    public readonly title: string,
    public readonly message: string,
    public readonly severity: 'low' | 'medium' | 'high' | 'critical',
    public readonly data?: Record<string, any>,
    public readonly timestamp: Date = new Date(),
  ) {}
}


export class SystemErrorEvent {
  constructor(
    public readonly error: Error,
    public readonly context: string,
    public readonly metadata?: Record<string, any>,
    public readonly timestamp: Date = new Date(),
  ) {}
}

export class SystemHealthCheckEvent {
  constructor(
    public readonly service: string,
    public readonly status: 'healthy' | 'unhealthy' | 'degraded',
    public readonly details?: Record<string, any>,
    public readonly timestamp: Date = new Date(),
  ) {}
}

export class AuditLogEvent {
  constructor(
    public readonly userId: string,
    public readonly action: string,
    public readonly resource: string,
    public readonly resourceId: string,
    public readonly changes: Record<string, any>,
    public readonly ipAddress?: string,
    public readonly userAgent?: string,
    public readonly timestamp: Date = new Date(),
  ) {}
}


export class StoreOrderReadyEvent {
  constructor(
    public readonly orderId: string,
    public readonly storeId: string,
    public readonly timestamp: Date = new Date(),
  ) {}
}

export class StoreOrderPickedUpEvent {
  constructor(
    public readonly orderId: string,
    public readonly storeId: string,
    public readonly riderId: string,
    public readonly timestamp: Date = new Date(),
  ) {}
}