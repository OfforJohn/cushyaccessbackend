export class MenuItemListDto {
  constructor(
    public readonly id: string,
    public readonly menuCategoryId: string,
    public readonly name: string,
    public readonly description: string,
    public readonly image: string,
    public readonly price: number,
    public readonly isAvailable: boolean,
    public readonly isDiscountActive: boolean,
    public readonly discountPrice: number,
    public readonly discountPercentage: number,
    public readonly discountStart: Date,
    public readonly discountEnd: Date,
    public readonly optionGroupIds: string[] = [],
  ) {}
}
