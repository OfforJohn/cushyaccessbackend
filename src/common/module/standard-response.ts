import { PaginationResponse } from './pagination-request';

export class StandardResponse {
  constructor(
    private readonly error: boolean,
    private readonly message: string,
    private readonly data?: object | undefined,
    private readonly pagination?: PaginationResponse | undefined,
  ) {}
  toJSON() {
    return {
      error: this.error,
      message: this.message,
      data: this.data,
      pagination: this.pagination,
    };
  }
  static withPagination(
    message: string,
    data: object | undefined,
    paginationRequest: { page: number; size: number },
    total: number,
  ): StandardResponse {
    const pagination = new PaginationResponse(
      paginationRequest.page,
      Array.isArray(data) ? data.length : 0,
      total,
      Math.ceil(total / paginationRequest.size) ?? 1,
    );
    return new StandardResponse(false, message, data, pagination);
  }
}
