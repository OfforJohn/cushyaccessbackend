import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { OrdersService } from './orders.service';

@Injectable()
export class AppInitService implements OnApplicationBootstrap {
  constructor(private readonly orderService: OrdersService) {}

  async onApplicationBootstrap() {
    console.log('initiating app level charge');
    await this.orderService.initAppLevelCharges();
  }
  //   configure(consumer: MiddlewareConsumer) {
  //     consumer.apply(LoggingMiddleware).forRoutes('*'); // Apply globally
  //   }
}
