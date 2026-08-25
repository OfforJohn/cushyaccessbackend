import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { EventBus } from '@nestjs/cqrs';
import { DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { CommonService } from '../../common/common.service';
import { StandardResponse } from '../../common/module/standard-response';
import { OrderCreateEvent } from '../../user-otp/events/order-create.event';
import { UserLocations } from '../../users/model/user-locations.entity';
import { formatDeliveryDate } from '../../utility/function';
import { GoogleMapsService } from '../../utils/google-maps.service';
import { TransactionRequest } from '../../wallet/model/dto/transaction.request';
import { TransactionCategory } from '../../wallet/model/transaction-category.enum';
import { TransactionStatus } from '../../wallet/model/transaction-status.enum';
import { Wallets } from '../../wallet/model/wallet.entity';
import { TransactionService } from '../../wallet/services/transaction.service';
import { OrderCharges } from '../model/charges/order-charges.entity';
import { ChargeNode } from '../model/charges/charge-node.entity';
import { DeliveryOrderRequest } from '../model/dto/order-request.dto';
import { OrderStatus } from '../model/enum/order-status.enum';
import { OrderTracking } from '../model/order-tracking.entity';
import { OrderUser } from '../model/order-user.entity';
import { Orders } from '../model/order.entity';
import { OrdersMapper } from '../services/orders-mapper.service';
import { OrdersService } from '../services/orders.service';
import { RiderOrderDispatchService } from '../services/rider-order-dispatch.service';

type ResolvedLocation = Awaited<
  ReturnType<GoogleMapsService['geocodeAddress']>
>;

@Injectable()
export class CreateDeliveryOrderUseCase {
  private readonly logger = new Logger(CreateDeliveryOrderUseCase.name);

  constructor(
    private readonly commonService: CommonService,
    private readonly orderService: OrdersService,
    private readonly transactionService: TransactionService,
    private readonly eventBus: EventBus,
    private readonly dataSource: DataSource,
    private readonly googleMapsService: GoogleMapsService,
    private readonly riderOrderDispatchService: RiderOrderDispatchService,
  ) {}

  async execute(deliveryOrderRequestDto: DeliveryOrderRequest) {
    const { pickUpLocation, dropOffLocation, vehicleType, items, totalItems } =
      deliveryOrderRequestDto;
    const authenticatedUser = await this.commonService.getLoggedInUser();

    // Network-bound calculations are independent and happen before any row is
    // locked, keeping the wallet transaction short under load.
    const [calculation, resolvedPickup, resolvedDropoff] = await Promise.all([
      this.orderService.computeLogisticsCalculation(
        pickUpLocation,
        dropOffLocation,
        vehicleType,
      ),
      this.googleMapsService.geocodeAddress(pickUpLocation),
      this.googleMapsService.geocodeAddress(dropOffLocation),
    ]);
    this.assertCompleteLocation(resolvedPickup);
    this.assertCompleteLocation(resolvedDropoff);

    const { duration, totalCharges, chargeNodes, deliveryFee } = calculation;
    const order = await this.dataSource.transaction(async (manager) => {
      const wallet = await manager.findOne(Wallets, {
        where: { userId: authenticatedUser.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!wallet) {
        throw new BadRequestException(
          new StandardResponse(true, 'WALLET_NOT_INITIALIZED'),
        );
      }
      if (totalCharges > Number(wallet.walletBalance)) {
        throw new BadRequestException(
          new StandardResponse(true, 'INSUFFICIENT_FUND'),
        );
      }

      const locations = await manager.save(UserLocations, [
        this.toLocation(resolvedPickup, authenticatedUser.id),
        this.toLocation(resolvedDropoff, authenticatedUser.id),
      ]);
      const createdOrder = OrdersMapper.mapOrderRequestToOrder(
        deliveryOrderRequestDto,
        authenticatedUser.id,
        duration,
      );
      const orderUsers = await manager.save(OrderUser, [
        createdOrder.recipientInfo,
        createdOrder.senderInfo,
      ]);

      createdOrder.recipientInfo = orderUsers[0];
      createdOrder.senderInfo = orderUsers[1];
      createdOrder.pickUpLocation = locations[0];
      createdOrder.pickUpLocationId = locations[0].id;
      createdOrder.pickUpLocationAddress = locations[0].address;
      createdOrder.dropOffLocation = locations[1];
      createdOrder.dropOffLocationId = locations[1].id;
      createdOrder.dropOffLocationAddress = locations[1].address;
      createdOrder.totalAmount = totalCharges;
      // Logistics has no merchant acknowledgement step. Its tracking state is
      // immediately acknowledged while the unassigned order itself remains
      // pending until one rider wins the atomic acceptance race.
      createdOrder.status = OrderStatus.pending;
      await manager.save(Orders, createdOrder);

      const orderCharges = await manager.save(
        OrderCharges,
        manager.create(OrderCharges, { orderId: createdOrder.id }),
      );
      chargeNodes.forEach((node) => {
        node.orderChargesId = orderCharges.id;
      });
      orderCharges.chargeNodes = await manager.save(ChargeNode, chargeNodes);
      createdOrder.orderCharges = orderCharges;

      wallet.walletBalance = Number(wallet.walletBalance) - totalCharges;
      await manager.save(Wallets, wallet);

      const transaction = new TransactionRequest();
      transaction.userId = authenticatedUser.id;
      transaction.walletId = wallet.id;
      transaction.amount = totalCharges;
      transaction.transactionReference = `CATX-${uuidv4()}`;
      transaction.description = 'LOGISTICS_FEE';
      transaction.category = TransactionCategory.LOGISTICS;
      transaction.status = TransactionStatus.COMPLETED;
      transaction.orderId = createdOrder.id;
      await this.transactionService.createTransaction(transaction, manager);

      await manager.save(
        OrderTracking,
        manager.create(OrderTracking, {
          orderId: createdOrder.id,
          orderStatus: OrderStatus.acknoledged,
          description: 'Package delivery is ready for rider assignment',
        }),
      );
      return createdOrder;
    });

    try {
      await this.riderOrderDispatchService.dispatch(order);
    } catch (error) {
      // The committed order remains discoverable through the proximity socket
      // query, so a transient notification failure must not roll it back.
      this.logger.error(
        `Package order ${order.id} was committed but initial dispatch failed.`,
        error instanceof Error ? error.stack : String(error),
      );
    }

    this.eventBus.publish(
      new OrderCreateEvent(
        deliveryOrderRequestDto.recipientInfo.emailAddress,
        `CAD-${order.id}`,
        deliveryFee.toString(),
        duration,
        formatDeliveryDate(order.createdAt),
        order.dropOffLocationAddress,
        items?.join(', ') || `${totalItems || 0} item(s)`,
      ),
    );
    return new StandardResponse(false, 'ORDER_CREATED_SUCCESSFULLY', order);
  }

  private assertCompleteLocation(location: ResolvedLocation) {
    if (!location.country || !location.state) {
      throw new BadRequestException(
        new StandardResponse(true, 'UNABLE_TO_RESOLVE_LOCATION'),
      );
    }
  }

  private toLocation(
    location: ResolvedLocation,
    userId: string,
  ): UserLocations {
    const entity = new UserLocations();
    entity.address = location.address;
    entity.country = location.country!;
    entity.state = location.state!;
    entity.city = location.city?.trim().toLowerCase();
    entity.latitude = location.latitude;
    entity.longitude = location.longitude;
    entity.placeId = location.placeId;
    entity.addedBy = userId;
    entity.isSupported = true;
    return entity;
  }
}
