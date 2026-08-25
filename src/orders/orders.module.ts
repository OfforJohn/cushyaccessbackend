import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Orders } from './model/order.entity';
import { OrderItems } from './model/order-items.entity';
import { OrderTracking } from './model/order-tracking.entity';
import { OrderUser } from './model/order-user.entity';
import { ChargeNode } from './model/charges/charge-node.entity';
import { OrderCharges } from './model/charges/order-charges.entity';
import { AppLevelCharges } from './model/app-level/app-level-charges.entity';
import { Charges } from './model/app-level/charge-entity';
import { MenuCategory } from '../stores/model/menu-category.entity';
import { MenuPack } from '../stores/model/menu-pack.entity';
import { OrdersService } from './services/orders.service';
import { CalculateDeliveryUseCase } from './usecases/calculate-delivery-charges.usecase';
import { CreateDeliveryOrderUseCase } from './usecases/create-delivery-order.usecase';
import { QCommerceOrderUseCase } from './usecases/q-commerce-order.usecase';
import { GetOrderTrackingUseCase } from './usecases/get-order-tracking.usecase';
import { GetOrdersUseCase } from './usecases/get-order.usecase';
import { CommonModule } from '../common/common.module';
import { StoresModule } from '../stores/stores.module';
import { WalletModule } from '../wallet/wallet.module';
import { UsersModule } from '../users/users.module';
import { OrdersController } from './orders.controller';
import { CartService } from './services/cart.service';
import { Cart } from './model/cart.entity';
import { CartItem } from './model/cart-items.entity';
import { Users } from 'src/users/model/users.entity';
import { Stores } from 'src/stores/model/stores.entity';
import { MenuItem } from 'src/stores/model/menu-item.entity';
import { AddToCartUseCase } from './usecases/add-to-cart.usecase';
import { MailSenderService } from 'src/user-otp/mail-sender.service';
import { AppInitService } from './services/app-init.service';
import { PromoCodeModule } from '../promo-code/promo-code.module';
import { CalculateLogisticDeliveryUseCase } from './usecases/calculate-logistic-delivery-charges.usecase';
import { UpdateOrderTrackingUseCase } from './usecases/update-order-tracking.usecase';
import { ThirdPartyOrderController } from './third-party-order.controller';
import { UserLocationsService } from 'src/users/services/user-locations.service';
import { UserLocations } from 'src/users/model/user-locations.entity';
import { GoogleMapsService } from 'src/utils/google-maps.service';
import { VendorAcceptRejectOrderUseCase } from './usecases/vendor-accept-reject-order.usecase';
import { Wallets } from 'src/wallet/model/wallet.entity';
import { UserCancelOrderUseCase } from './usecases/user-cancel-order.usecase';
import { MobileSenderService } from 'src/user-otp/mobile-sender.service';
import { CqrsModule } from '@nestjs/cqrs';
import { AnalyticsService } from 'src/analytics/analytics.service';
import { UserActivity } from 'src/analytics/entities/user-activity.entity';
import { Analytics } from 'src/analytics/entities/analytics.entity';
import { AICalculateDeliveryUseCase } from './usecases/calculate-ai-delivery-charges.usecase';
import { AIQCommerceOrderUseCase } from './usecases/ai-q-commerce-order.usecase';
import { ValidateOrderCodeUseCase } from './usecases/validate-order-code.usecase';
import { GetActiveDeliveryUseCase } from './usecases/get-active-delivery.usecase';
import { Rider } from 'src/riders/model/rider.entity';
import { RiderService } from 'src/riders/services/riders.service';
import { RiderDocument } from 'src/riders/model/rider-document.entity';
import { S3Service } from 'src/utils/s3-bucket.service';
import { RidersModule } from 'src/riders/riders.module';
import { RedisCacheModule } from 'src/redis-cache/redis-cache.module';
import { RiderOrderDispatchService } from './services/rider-order-dispatch.service';
import { OrderStatusChangedHandler } from './handlers/order-status-changed.handler';

@Module({
  imports: [
    CommonModule,
    StoresModule,
    WalletModule,
    UsersModule,
    PromoCodeModule,
    CqrsModule,
    forwardRef(() => RidersModule),
    RedisCacheModule,
    TypeOrmModule.forFeature([
      Orders,
      OrderItems,
      OrderTracking,
      OrderUser,
      ChargeNode,
      OrderCharges,
      AppLevelCharges,
      Charges,

      // extrernal
      MenuCategory,
      MenuItem,
      MenuPack,
      Cart,
      CartItem,
      Users,
      Stores,
      UserLocations,
      Wallets,
      UserActivity,
      Analytics,
      Rider,
      RiderDocument,
    ]),
  ],
  providers: [
    OrdersService,
    CalculateDeliveryUseCase,
    CalculateLogisticDeliveryUseCase,
    CreateDeliveryOrderUseCase,
    QCommerceOrderUseCase,
    GetOrderTrackingUseCase,
    GetOrdersUseCase,
    CartService,
    AddToCartUseCase,
    MailSenderService,
    AppInitService,
    UpdateOrderTrackingUseCase,
    UserLocationsService,
    GoogleMapsService,
    VendorAcceptRejectOrderUseCase,
    UserCancelOrderUseCase,
    MobileSenderService,
    AnalyticsService,
    AICalculateDeliveryUseCase,
    AIQCommerceOrderUseCase,
    RiderService,
    S3Service,
    ValidateOrderCodeUseCase,
    GetActiveDeliveryUseCase,
    RiderOrderDispatchService,
    OrderStatusChangedHandler,
  ],
  exports: [
    OrdersService,
    CartService,
    CalculateDeliveryUseCase,
    ValidateOrderCodeUseCase,
    GetActiveDeliveryUseCase,
  ],
  controllers: [OrdersController, ThirdPartyOrderController],
})
export class OrderModule {}
