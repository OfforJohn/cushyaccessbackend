export class MenuItemDto {
  constructor(
    public readonly id: string,
    public readonly name: string,
    public readonly description: string,
    public readonly images: string[],
    public readonly price: number,
    public readonly isAvailable: boolean,
    public readonly menuCategoryId: string,
    public readonly isDiscountActive: boolean,
    public readonly discountPrice: number,
    public readonly discountPercentage: number,
    public readonly discountStart: Date,
    public readonly discountEnd: Date,
    public readonly storeId: string,
    public readonly createdAt: string,
    public readonly updatedAt: string,
    public readonly optionGroupIds: string[] = [],
  ) {}
}
