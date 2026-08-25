import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

@Injectable()
export class RemoveNullFieldsInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      map((data) => removeNulls(data)), // reuse utility function above
    );
  }
}

function removeNulls(obj: any): any {
  if (Array.isArray(obj)) {
    return obj.map(removeNulls);
  }
  if (obj !== null && typeof obj === 'object') {
    return Object.entries(obj).reduce((acc, [key, value]) => {
      acc[key] =
        value === null || value === undefined
          ? '' // or {} / [] depending on needs
          : removeNulls(value);
      return acc;
    }, {} as any);
  }
  return obj;
}
