export class StoreList {
  id: string;
  userId: string;
  name: string;
  coverImage: string;
  location: string;
  reviewCount: number;
  rating: number;
  estimateDeliveryFee: number;
  category: string;
  walletBalance: number;
  ordersCount: number;
  isVisible: boolean;
  isFeatured: boolean;
  featuredAt?: Date | null;
  isOpen: boolean;
  isOrderable: boolean;
  availabilityStatus: string;
  availabilityLabel: string;
  nextOpeningLabel?: string;
  orderDisabledReason?: string;
}
