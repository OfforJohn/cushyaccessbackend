import {
  IsNotEmpty,
  IsString,
  IsOptional,
  Matches,
  IsBoolean,
  IsEnum,
  ValidateIf,
  IsArray,
  ArrayMinSize,
  ValidateNested,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import moment from 'moment';
import { VehicleType } from '../enum/vechicle-type.enum';
import { SelectedMenuOptionDto } from './cart-item.dto';

export class CreateOrderDto {
  @IsNotEmpty()
  @IsString()
  pickUpLocationId: string;

  @IsNotEmpty()
  @IsString()
  dropOffLocationId: string;

  @IsOptional()
  @IsString()
  noteForRider?: string;

  @IsOptional()
  @IsString()
  noteForVendor?: string;

  @IsOptional()
  @IsString()
  noteForStore?: string;

  @IsNotEmpty()
  @IsString()
  storeId: string;

  @IsOptional()
  @Transform(({ value }) => {
    const parsed = moment(value, 'DD/MM/YYYY', true);
    return parsed.isValid() ? parsed.toDate() : undefined;
  })
  scheduleDeliveryDate?: Date;

  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/, {
    message: 'Time must be in HH:MM:SS format (24-hour)',
  })
  scheduleDeliveryTime?: string;

  @IsBoolean()
  @IsOptional()
  scheduleDelivery?: boolean; // Assuming this is a string based on your previous code

  @IsBoolean()
  @IsOptional()
  buyForFriend?: boolean;

  @ValidateIf((order: CreateOrderDto) => order.buyForFriend === true)
  @IsNotEmpty()
  @IsString()
  friendName?: string;

  @ValidateIf((order: CreateOrderDto) => order.buyForFriend === true)
  @IsNotEmpty()
  @IsString()
  friendNumber?: string;

  @ValidateIf((order: CreateOrderDto) => order.buyForFriend === true)
  @IsNotEmpty()
  @IsString()
  friendDeliveryAddress?: string;

  @IsNotEmpty({ message: 'Full house address is required' })
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  fullHouseAddress: string;

  @IsOptional()
  @IsString()
  additionalPhoneNumber: string;

  @IsEnum(VehicleType)
  @IsNotEmpty()
  vechicleType: VehicleType;

  @IsOptional()
  promoCodeValue: string;
}
export class SelectedItemDto {
  @IsNotEmpty()
  @IsString()
  menuItemId: string; // UUID of the menu item

  @IsInt()
  @Min(1)
  @Max(99)
  quantity: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SelectedMenuOptionDto)
  selectedOptions?: SelectedMenuOptionDto[];
}
export class CreateAIOrderDto {
  @IsOptional()
  @IsString()
  noteForRider?: string;

  @IsOptional()
  @IsString()
  noteForVendor?: string;

  @IsOptional()
  @IsString()
  noteForStore?: string;

  @IsNotEmpty()
  @IsString()
  storeId: string;

  @IsOptional()
  @Transform(({ value }) => {
    const parsed = moment(value, 'DD/MM/YYYY', true);
    return parsed.isValid() ? parsed.toDate() : undefined;
  })
  scheduleDeliveryDate?: Date;

  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/, {
    message: 'Time must be in HH:MM:SS format (24-hour)',
  })
  scheduleDeliveryTime?: string;

  @IsBoolean()
  @IsOptional()
  scheduleDelivery?: boolean; // Assuming this is a string based on your previous code

  @IsBoolean()
  @IsOptional()
  buyForFriend?: boolean;

  @ValidateIf((order: CreateAIOrderDto) => order.buyForFriend === true)
  @IsNotEmpty()
  @IsString()
  friendName?: string;

  @ValidateIf((order: CreateAIOrderDto) => order.buyForFriend === true)
  @IsNotEmpty()
  @IsString()
  friendNumber?: string;

  @ValidateIf((order: CreateAIOrderDto) => order.buyForFriend === true)
  @IsNotEmpty()
  @IsString()
  friendDeliveryAddress?: string;

  @IsOptional()
  @IsString()
  additionalPhoneNumber: string;

  @IsEnum(VehicleType)
  @IsNotEmpty()
  vechicleType: VehicleType;

  @IsOptional()
  promoCodeValue: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'Selected items cannot be empty' })
  @ValidateNested({ each: true })
  @Type(() => SelectedItemDto)
  selectedItems: SelectedItemDto[];
}
