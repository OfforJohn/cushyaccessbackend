import { CommonService } from '../../common/common.service';
import { StandardResponse } from '../../common/module/standard-response';
import { CartItemDto } from '../model/dto/cart-item.dto';
import { MenuItemService } from '../../stores/services/menu-item.service';
import { UsersService } from '../../users/services/users.service';
import { CartService } from '../services/cart.service';
import { OrdersMapper } from '../services/orders-mapper.service';
import { BadRequestException, Injectable } from '@nestjs/common';
import { StoreService } from '../../stores/services/stores.service';

@Injectable()
export class AddToCartUseCase {
  constructor(
    private readonly commonService: CommonService,
    private readonly userService: UsersService,
    private readonly menuItemService: MenuItemService,
    private readonly cartService: CartService,
    private readonly storeService: StoreService,
  ) {}

  async execute(itemData: CartItemDto): Promise<StandardResponse> {
    const authenticatedUser = await this.commonService.getLoggedInUser();
    const menuItem = await this.menuItemService.findMenuItemAttachStore(
      itemData.menuItemId,
    );
    const store = await this.storeService.assertStoreCanAcceptOrders(
      menuItem.storeId,
    );
    const resolvedOptions = await this.menuItemService.resolveSelectedOptions(
      menuItem,
      itemData.selectedOptions || [],
    );
    const finalPrice = this.menuItemService.getFinalMenuPrice(menuItem);
    if (finalPrice + resolvedOptions.optionPrice > 99999999.99) {
      throw new BadRequestException(
        new StandardResponse(true, 'CONFIGURED_MENU_ITEM_PRICE_TOO_LARGE'),
      );
    }
    const getUser = await this.userService.findById(authenticatedUser.id);
    const updatedCart = await this.cartService.addMenuItemAtomically({
      userId: authenticatedUser.id,
      userLocationId: getUser.locationId,
      itemData,
      menuItem,
      store,
      finalPrice,
      resolvedOptions,
    });
    return new StandardResponse(
      false,
      'ADDED_TO_CART_SUCCESSFULLY',
      new OrdersMapper().mapCartResponse(updatedCart, store),
    );
  }
}
