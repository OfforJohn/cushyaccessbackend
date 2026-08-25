import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import { Users } from 'src/users/model/users.entity';
import { v4 as uuidv4 } from 'uuid';
import { Cart } from '../model/cart.entity';
import { CartItem } from '../model/cart-items.entity';
import { CartItemDto } from '../model/dto/cart-item.dto';
import { OrdersService } from './orders.service';
import { CreateCartDto } from '../model/dto/create-cart.dto';
import { StandardResponse } from 'src/common/module/standard-response';
import { CommonService } from 'src/common/common.service';
import { UsersService } from 'src/users/services/users.service';
import { Stores } from 'src/stores/model/stores.entity';
import { MenuItem } from 'src/stores/model/menu-item.entity';
import { OrdersMapper } from './orders-mapper.service';
import { MenuItemService } from 'src/stores/services/menu-item.service';
import { PromoCodeService } from 'src/promo-code/service/promo-code.service';
import { StoreService } from 'src/stores/services/stores.service';
import { Coupon, CouponType } from 'src/promo-code/model/coupon.entity';
import { ResolvedMenuOptions } from '../../stores/model/menu-option-selection';

@Injectable()
export class CartService {
  constructor(
    @InjectRepository(Cart) private cartRepository: Repository<Cart>,
    @InjectRepository(CartItem)
    private cartItemRepository: Repository<CartItem>,
    @InjectRepository(Users) private userRepository: Repository<Users>,
    @InjectRepository(Stores) private storeRepository: Repository<Stores>,
    @InjectRepository(MenuItem)
    private menuItemRepository: Repository<MenuItem>,
    private orderService: OrdersService,
    private commonService: CommonService,
    private userService: UsersService,
    private menuItemService: MenuItemService,
    private promoCodeService: PromoCodeService,
    private storeService: StoreService,
  ) {}

  async addMenuItemAtomically({
    userId,
    userLocationId,
    itemData,
    menuItem,
    store,
    finalPrice,
    resolvedOptions,
  }: {
    userId: string;
    userLocationId: string;
    itemData: CartItemDto;
    menuItem: MenuItem;
    store: Stores;
    finalPrice: number;
    resolvedOptions: ResolvedMenuOptions;
  }): Promise<Cart> {
    return this.withUserCartLock(userId, async (manager) => {
      const cartRepository = manager.getRepository(Cart);
      const cartItemRepository = manager.getRepository(CartItem);
      let cart = await cartRepository.findOne({
        where: { userId },
        relations: ['cartItems'],
      });

      if (!cart) {
        cart = cartRepository.create({
          userId,
          cartItems: [],
          totalAmount: 0,
          noteForRider: itemData.noteForRider,
          noteForVendor: itemData.noteForVendor,
          pickUpLocationId: store.addressId,
          dropOffLocationId: userLocationId,
          storeId: store.id,
        });
        cart = await cartRepository.save(cart);
      } else if (cart.storeId && cart.storeId !== store.id) {
        throw new BadRequestException(
          new StandardResponse(true, 'CANNOUT_ADD_ITEMS_FROM_DIFFERENT_STORES'),
        );
      }

      const quantity = itemData.quantity || 1;
      const existingItem = cart.cartItems.find(
        (item) =>
          item.menuItemId === menuItem.id &&
          (item.configurationKey || '') === resolvedOptions.configurationKey,
      );

      if (existingItem) {
        if (existingItem.quantity + quantity > 100) {
          throw new BadRequestException(
            new StandardResponse(true, 'INVALID_CART_QUANTITY'),
          );
        }
        existingItem.quantity += quantity;
        await cartItemRepository.save(existingItem);
      } else {
        const newItem = cartItemRepository.create({
          cart,
          storeId: menuItem.storeId,
          menuItemId: menuItem.id,
          name: menuItem.name,
          price: finalPrice + resolvedOptions.optionPrice,
          quantity,
          image: menuItem.images?.[0] || null,
          selectedOptions: resolvedOptions.selectedOptions,
          optionPrice: resolvedOptions.optionPrice,
          configurationKey: resolvedOptions.configurationKey,
        });
        await cartItemRepository.save(newItem);
        cart.cartItems.push(newItem);
      }

      cart.storeId = store.id;
      cart.pickUpLocationId = store.addressId;
      cart.dropOffLocationId = userLocationId;
      cart.noteForRider = itemData.noteForRider ?? cart.noteForRider;
      cart.noteForVendor = itemData.noteForVendor ?? cart.noteForVendor;
      const updatedCart = await this.calculateCartAmounts(cart, manager);
      updatedCart.store = store;
      return updatedCart;
    });
  }

  //controller use
  async getCartDetails(): Promise<StandardResponse> {
    const authenticatedUser = await this.commonService.getLoggedInUser();
    const userId = authenticatedUser.id;

    // Find the user in the database
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException(new StandardResponse(true, 'USER_NOT_FOUND'));
    }
    const userWithLocation = await this.userRepository.findOne({
      where: { id: userId },
      relations: ['location'], // This loads the location
    });

    // Find the cart associated with the user
    const cart = await this.cartRepository.findOne({
      where: { user: { id: userId } },
      relations: ['cartItems', 'store'], // Ensure store relation is loaded
    });

    // If no cart exists for the user, create a new one
    if (!cart) {
      return new StandardResponse(false, 'CART_RETRIEVED_SUCCESSFULLY', null);
    }

    const getStore = cart.storeId
      ? await this.storeService.getStoreById(cart.storeId)
      : null;

    // Return the found or newly created cart
    return new StandardResponse(
      false,
      'CART_RETRIEVED_SUCCESSFULLY',
      new OrdersMapper().mapCartResponse(
        cart,
        getStore,
        userWithLocation.location?.id,
      ),
    );
  }

  async calculateCartAmounts(
    cart: Cart,
    manager?: EntityManager,
    revalidateOptions = false,
  ): Promise<Cart> {
    const subtotal = await this.calculateCurrentSubtotal(
      cart.cartItems,
      manager,
      revalidateOptions,
    );
    cart.subtotalBeforeDiscount = subtotal;

    let discountAmount = 0;
    if (cart.appliedCouponCode) {
      try {
        const coupon = await this.promoCodeService.validateCoupon(
          cart.appliedCouponCode,
          cart.storeId,
          cart.userId,
        );
        discountAmount = this.calculateCouponDiscount(coupon, subtotal);
      } catch (error) {
        if (
          error instanceof BadRequestException ||
          error instanceof NotFoundException
        ) {
          cart.appliedCouponCode = null;
        } else {
          throw error;
        }
      }
    }

    cart.discountAmount = discountAmount;
    cart.totalAmount = Math.max(0, subtotal - discountAmount);
    return (manager?.getRepository(Cart) || this.cartRepository).save(cart);
  }

  async removeFromCart(
    itemIdentifier: string,
    removeCompletely: boolean = false,
  ): Promise<StandardResponse> {
    const authenticatedUser = await this.commonService.getLoggedInUser();
    return this.withUserCartLock(authenticatedUser.id, async (manager) => {
      const cartRepository = manager.getRepository(Cart);
      const cartItemRepository = manager.getRepository(CartItem);
      const cart = await cartRepository.findOne({
        where: { userId: authenticatedUser.id },
        relations: ['cartItems', 'store'],
      });
      if (!cart) {
        throw new NotFoundException(
          new StandardResponse(true, 'CART_NOT_FOUND'),
        );
      }

      const item =
        cart.cartItems.find((candidate) => candidate.id === itemIdentifier) ||
        cart.cartItems.find(
          (candidate) => candidate.menuItemId === itemIdentifier,
        );
      if (!item) {
        throw new NotFoundException(
          new StandardResponse(true, 'CART_ITEM_NOT_FOUND'),
        );
      }

      if (removeCompletely || item.quantity === 1) {
        await cartItemRepository.remove(item);
        cart.cartItems = cart.cartItems.filter(
          (candidate) => candidate.id !== item.id,
        );
      } else {
        item.quantity -= 1;
        await cartItemRepository.save(item);
      }

      if (cart.cartItems.length) {
        await this.calculateCartAmounts(cart, manager);
      } else {
        cart.totalAmount = 0;
        cart.subtotalBeforeDiscount = 0;
        cart.discountAmount = 0;
        await cartRepository.delete(cart.id);
      }
      return new StandardResponse(
        false,
        'CART_REMOVED_SUCCESSFULLY',
        new OrdersMapper().mapCartResponse(cart, cart.store),
      );
    });
  }
  async deleteCart() {
    const authenticatedUser = await this.commonService.getLoggedInUser();
    return this.withUserCartLock(authenticatedUser.id, async (manager) => {
      const repository = manager.getRepository(Cart);
      const cart = await repository.findOne({
        where: { userId: authenticatedUser.id },
      });
      if (!cart) {
        throw new NotFoundException(
          new StandardResponse(true, 'CART_NOT_FOUND'),
        );
      }

      // Cart items are removed by the database cascade.
      await repository.delete(cart.id);
      return new StandardResponse(false, 'CART_ITEMS_CLEARED_SUCCESSFULLY');
    });
  }
  async createCart(userId: string, payload: CreateCartDto) {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user)
      throw new NotFoundException(new StandardResponse(true, 'USER_NOT_FOUND'));
    return this.withUserCartLock(userId, async (manager) => {
      const repository = manager.getRepository(Cart);
      const existingCart = await repository.findOne({ where: { userId } });
      if (existingCart) {
        throw new BadRequestException(
          new StandardResponse(true, 'CART_EXIST_ALREADY'),
        );
      }

      const cart = repository.create({
        id: `cart_${uuidv4()}`,
        user,
        cartItems: [],
        totalAmount: 0,
        noteForRider: payload.noteForRider,
        noteForVendor: payload.noteForVendor,
      });
      return repository.save(cart);
    });
  }
  async updateCartItemQuantity(
    quantity: number,
    itemIdentifier: string,
  ): Promise<StandardResponse> {
    if (!Number.isInteger(Number(quantity)) || quantity < 1 || quantity > 100) {
      throw new BadRequestException(
        new StandardResponse(true, 'INVALID_CART_QUANTITY'),
      );
    }
    quantity = Number(quantity);
    const authenticatedUser = await this.commonService.getLoggedInUser();
    return this.withUserCartLock(authenticatedUser.id, async (manager) => {
      const cartRepository = manager.getRepository(Cart);
      const cartItemRepository = manager.getRepository(CartItem);
      const userCart = await cartRepository.findOne({
        where: { userId: authenticatedUser.id },
        relations: ['cartItems', 'store'],
      });
      if (!userCart) {
        throw new NotFoundException(
          new StandardResponse(true, 'CART_NOT_FOUND'),
        );
      }

      const item =
        userCart.cartItems.find(
          (candidate) => candidate.id === itemIdentifier,
        ) ||
        userCart.cartItems.find(
          (candidate) => candidate.menuItemId === itemIdentifier,
        );
      if (!item) {
        throw new NotFoundException(
          new StandardResponse(true, 'CART_ITEM_NOT_FOUND'),
        );
      }

      item.quantity = quantity;
      await cartItemRepository.save(item);
      const updatedCart = await this.calculateCartAmounts(userCart, manager);
      updatedCart.store = userCart.store;

      return new StandardResponse(
        false,
        'CART_QUANTITY_UPDATED_SUCCESSFULLY',
        new OrdersMapper().mapCartResponse(updatedCart, updatedCart.store),
      );
    });
  }

  async getCart(userId: string) {
    return await this.cartRepository.findOne({
      where: { userId },
      relations: ['cartItems'],
    });
  }

  async applyCouponToCart(code: string): Promise<StandardResponse> {
    const authUser = await this.commonService.getLoggedInUser();
    const normalizedCode = code?.trim().toUpperCase();
    if (!normalizedCode) {
      throw new BadRequestException(
        new StandardResponse(true, 'COUPON_CODE_IS_REQUIRED'),
      );
    }

    return this.withUserCartLock(authUser.id, async (manager) => {
      const repository = manager.getRepository(Cart);
      const cart = await repository.findOne({
        where: { userId: authUser.id },
        relations: ['cartItems', 'store'],
      });
      if (!cart) {
        throw new BadRequestException(
          new StandardResponse(true, 'CART_NOT_FOUND'),
        );
      }
      if (!cart.storeId) {
        throw new BadRequestException(
          new StandardResponse(true, 'CART_HAS_NO_STORE'),
        );
      }

      const coupon = await this.promoCodeService.validateCoupon(
        normalizedCode,
        cart.storeId,
        authUser.id,
      );
      const subtotal = await this.calculateCurrentSubtotal(
        cart.cartItems,
        manager,
      );
      cart.subtotalBeforeDiscount = subtotal;
      cart.discountAmount = this.calculateCouponDiscount(coupon, subtotal);
      cart.appliedCouponCode = normalizedCode;
      cart.totalAmount = Math.max(0, subtotal - cart.discountAmount);
      await repository.save(cart);

      return new StandardResponse(
        false,
        'COUPON_APPLIED_SUCCESSFULLY',
        new OrdersMapper().mapCartResponse(cart, cart.store),
      );
    });
  }

  private async calculateCurrentSubtotal(
    cartItems: CartItem[],
    manager?: EntityManager,
    revalidateOptions = false,
  ) {
    if (!cartItems.length) return 0;

    const menuItemIds = [...new Set(cartItems.map((item) => item.menuItemId))];
    const menuItems = await (
      manager?.getRepository(MenuItem) || this.menuItemRepository
    ).findBy({
      id: In(menuItemIds),
    });
    const menuItemsById = new Map(menuItems.map((item) => [item.id, item]));
    const optionGroupsByItem = revalidateOptions
      ? await this.menuItemService.getPublishedOptionGroupsForItems(menuItems)
      : {};

    let subtotal = 0;
    for (const cartItem of cartItems) {
      const menuItem = menuItemsById.get(cartItem.menuItemId);
      if (!menuItem) {
        throw new BadRequestException(
          `MENU_ITEM_NOT_FOUND: ${cartItem.menuItemId}`,
        );
      }

      if (revalidateOptions) {
        const resolvedOptions =
          await this.menuItemService.resolveSelectedOptions(
            menuItem,
            (cartItem.selectedOptions || []).map((group) => ({
              groupId: group.groupId,
              choiceIds: group.choices.map((choice) => choice.id),
            })),
            optionGroupsByItem[menuItem.id] || [],
          );
        cartItem.selectedOptions = resolvedOptions.selectedOptions;
        cartItem.optionPrice = resolvedOptions.optionPrice;
        cartItem.configurationKey = resolvedOptions.configurationKey;
      }

      const finalPrice = Number(
        this.menuItemService.getFinalMenuPrice(menuItem),
      );
      const configuredPrice = finalPrice + Number(cartItem.optionPrice || 0);
      cartItem.price = configuredPrice;
      subtotal += configuredPrice * cartItem.quantity;
    }

    if (subtotal > 99999999.99) {
      throw new BadRequestException(
        new StandardResponse(true, 'CART_TOTAL_TOO_LARGE'),
      );
    }
    return subtotal;
  }

  private calculateCouponDiscount(coupon: Coupon, subtotal: number) {
    const value = Number(coupon.value);
    const discount =
      coupon.type === CouponType.PERCENT ? (value / 100) * subtotal : value;
    return Math.max(0, Math.min(discount, subtotal));
  }

  private async withUserCartLock<T>(
    userId: string,
    work: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    return this.cartRepository.manager.transaction(async (manager) => {
      // PostgreSQL transaction-scoped locks are automatically released on
      // commit/rollback and work across app instances without extra storage.
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `cart:${userId}`,
      ]);
      return work(manager);
    });
  }
}
