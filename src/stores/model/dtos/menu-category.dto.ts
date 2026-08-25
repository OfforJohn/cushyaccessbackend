export class MenuCategoryDto {
  constructor(
    private readonly id: string,
    private readonly userId: string,
    private readonly storeId: string,
    private readonly name: string,
    private readonly isPublished: string,
  ) {}
}
